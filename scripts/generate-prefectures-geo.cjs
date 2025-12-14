#!/usr/bin/env node

/**
 * 都道府県GeoJSON生成スクリプト (mapshaper使用版)
 * N03-20240101.geojsonから都道府県ごとにフィーチャーを集約・軽量化してpublic/prefectures-geo.jsonを生成します
 * 
 * 依存: npx mapshaper
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 設定
const CONFIG = {
    geojsonPath: path.join(__dirname, '..', 'N03-20240101.geojson'),
    outputDir: path.join(__dirname, '..', 'public'),
    outputFile: 'prefectures-geo.json',
    simplifyPercentage: '0.5%', // 0.5%まで削減
};

function main() {
    console.log('\n========================================');
    console.log('  都道府県GeoJSON生成スクリプト (軽量化版)');
    console.log('========================================\n');

    // 入力ファイルの確認
    if (!fs.existsSync(CONFIG.geojsonPath)) {
        console.error(`❌ エラー: 入力ファイルが見つかりません: ${CONFIG.geojsonPath}`);
        process.exit(1);
    }

    // 出力ディレクトリの作成
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        console.log(`📁 ディレクトリを作成しました: ${CONFIG.outputDir}`);
    }

    const outputPath = path.join(CONFIG.outputDir, CONFIG.outputFile);

    // mapshaperコマンドの構築
    // 1. -dissolve N03_001: 都道府県コード/名称(N03_001)でポリゴンを結合
    // 2. -rename-fields name=N03_001: プロパティ名をnameに変更
    // 3. -simplify 0.5% keep-shapes: 頂点数を削減して軽量化 (keep-shapesで消滅を防ぐ)
    // 4. -o format=geojson: GeoJSON形式で出力
    const command = `npx mapshaper "${CONFIG.geojsonPath}" \
        -dissolve N03_001 \
        -rename-fields name=N03_001 \
        -simplify ${CONFIG.simplifyPercentage} keep-shapes \
        -o "${outputPath}" format=geojson`;

    console.log('🔄 mapshaperを実行してGeoJSONを生成・軽量化しています...');
    console.log(`   設定: simplify=${CONFIG.simplifyPercentage}, dissolve=N03_001`);
    
    try {
        // stdio: 'inherit' でmapshaperの出力を表示
        execSync(command, { stdio: 'inherit' });
        
        // 生成されたファイルのサイズを確認
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            
            console.log(`\n✅ 生成完了: ${outputPath}`);
            console.log(`📊 ファイルサイズ: ${sizeMB} MB`);
        } else {
            console.error('\n❌ エラー: 出力ファイルが生成されませんでした。');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ mapshaperの実行中にエラーが発生しました。');
        console.error('npx mapshaper が実行可能か確認してください。');
        console.error(error.message);
        process.exit(1);
    }
}

main();
