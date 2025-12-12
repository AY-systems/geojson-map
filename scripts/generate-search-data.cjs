#!/usr/bin/env node

/**
 * 検索用データ生成スクリプト
 * GeoJSONから市区町村リストと中心座標を抽出します
 */

const fs = require('fs');
const path = require('path');

// 設定
const CONFIG = {
    geojsonPath: path.join(__dirname, '..', 'N03-20240101.geojson'),
    outputDir: path.join(__dirname, '..', 'public'),
};

// ユーティリティ関数
function log(message, type = 'info') {
    const prefix = {
        info: '📋',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        step: '🔄'
    };
    console.log(`${prefix[type] || '•'} ${message}`);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log(`ディレクトリを作成しました: ${dirPath}`, 'success');
    }
}

/**
 * ポリゴンの中心座標（重心）を計算
 */
function calculateCentroid(coordinates) {
    let totalX = 0;
    let totalY = 0;
    let count = 0;

    const processCoords = (coords) => {
        if (typeof coords[0] === 'number') {
            totalX += coords[0];
            totalY += coords[1];
            count++;
        } else {
            coords.forEach(c => processCoords(c));
        }
    };

    processCoords(coordinates);

    if (count === 0) return null;
    return [
        Math.round((totalX / count) * 10000) / 10000,  // 小数点4桁に丸める
        Math.round((totalY / count) * 10000) / 10000
    ];
}

/**
 * バウンディングボックスを計算
 */
function calculateBounds(coordinates) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    const processCoords = (coords) => {
        if (typeof coords[0] === 'number') {
            minX = Math.min(minX, coords[0]);
            maxX = Math.max(maxX, coords[0]);
            minY = Math.min(minY, coords[1]);
            maxY = Math.max(maxY, coords[1]);
        } else {
            coords.forEach(c => processCoords(c));
        }
    };

    processCoords(coordinates);

    if (minX === Infinity) return null;
    return [
        [Math.round(minX * 10000) / 10000, Math.round(minY * 10000) / 10000],
        [Math.round(maxX * 10000) / 10000, Math.round(maxY * 10000) / 10000]
    ];
}

/**
 * GeoJSONから市区町村データを抽出
 */
function extractMunicipalities() {
    log('市区町村データを抽出中...', 'step');
    
    if (!fs.existsSync(CONFIG.geojsonPath)) {
        throw new Error(`GeoJSONファイルが見つかりません: ${CONFIG.geojsonPath}`);
    }

    const geojsonContent = fs.readFileSync(CONFIG.geojsonPath, 'utf8');
    const geojson = JSON.parse(geojsonContent);
    
    // 市区町村コード別にデータを集約（複数ポリゴンをマージ）
    const municipalitiesMap = new Map();
    
    geojson.features.forEach(feature => {
        const props = feature.properties;
        const code = props.N03_007 || '';
        const prefName = props.N03_001 || '';
        const gunName = props.N03_003 || '';
        const cityName = props.N03_004 || '';
        
        if (!cityName || !code) return;
        
        const fullName = gunName + cityName;
        
        if (!municipalitiesMap.has(code)) {
            municipalitiesMap.set(code, {
                code,
                prefName,
                gunName,
                cityName,
                fullName,
                coordinates: [],
                bounds: null
            });
        }
        
        // 座標を追加
        if (feature.geometry && feature.geometry.coordinates) {
            municipalitiesMap.get(code).coordinates.push(feature.geometry.coordinates);
        }
    });
    
    // 各市区町村の中心座標とバウンドを計算
    const municipalities = [];
    
    municipalitiesMap.forEach((m) => {
        // 全座標をフラット化（スタックオーバーフロー回避のためイテレーティブに）
        let allCoords = [];
        const stack = [];
        for (let i = 0; i < m.coordinates.length; i++) {
            stack.push(m.coordinates[i]);
        }
        
        while (stack.length > 0) {
            const item = stack.pop();
            if (!Array.isArray(item)) continue;
            if (typeof item[0] === 'number' && typeof item[1] === 'number') {
                allCoords.push(item);
            } else {
                for (let i = 0; i < item.length; i++) {
                    stack.push(item[i]);
                }
            }
        }
        
        if (allCoords.length === 0) return;
        
        // 中心座標とバウンドを計算（スプレッド演算子を避ける）
        let sumX = 0, sumY = 0;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (let i = 0; i < allCoords.length; i++) {
            const x = allCoords[i][0];
            const y = allCoords[i][1];
            sumX += x;
            sumY += y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        
        const center = [
            Math.round((sumX / allCoords.length) * 10000) / 10000,
            Math.round((sumY / allCoords.length) * 10000) / 10000
        ];
        
        const bounds = [
            [Math.round(minX * 10000) / 10000, Math.round(minY * 10000) / 10000],
            [Math.round(maxX * 10000) / 10000, Math.round(maxY * 10000) / 10000]
        ];
        
        municipalities.push({
            code: m.code,
            pref: m.prefName,
            gun: m.gunName,
            city: m.cityName,
            full: m.fullName,
            center,
            bounds
        });
    });
    
    // コード順にソート
    municipalities.sort((a, b) => a.code.localeCompare(b.code));
    
    return municipalities;
}

/**
 * メイン処理
 */
async function main() {
    console.log('\n========================================');
    console.log('  検索用データ生成スクリプト');
    console.log('========================================\n');
    
    try {
        ensureDir(CONFIG.outputDir);
        
        const municipalities = extractMunicipalities();
        
        // 検索用JSONを保存（コンパクト形式）
        const searchDataPath = path.join(CONFIG.outputDir, 'search-data.json');
        fs.writeFileSync(searchDataPath, JSON.stringify(municipalities));
        
        const fileSizeKB = (fs.statSync(searchDataPath).size / 1024).toFixed(1);
        log(`検索用データを保存しました: ${searchDataPath} (${fileSizeKB} KB)`, 'success');
        log(`  合計: ${municipalities.length} 市区町村`, 'info');
        
        // 都道府県リストも生成
        const prefectures = [...new Set(municipalities.map(m => m.pref))].sort();
        const prefPath = path.join(CONFIG.outputDir, 'prefectures.json');
        fs.writeFileSync(prefPath, JSON.stringify(prefectures));
        log(`都道府県リストを保存しました: ${prefPath}`, 'success');
        
        // サンプル出力
        console.log('\nサンプルデータ（東京都の最初の5件）:');
        municipalities
            .filter(m => m.pref === '東京都')
            .slice(0, 5)
            .forEach(m => {
                console.log(`  ${m.code}: ${m.full} @ [${m.center.join(', ')}]`);
            });
        
        console.log('\n========================================');
        log('データ生成が完了しました！', 'success');
        console.log('========================================\n');
        
    } catch (error) {
        log(`エラーが発生しました: ${error.message}`, 'error');
        console.error(error.stack);
        process.exit(1);
    }
}

main();
