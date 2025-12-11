import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol, PMTiles } from 'pmtiles';
import Papa from 'papaparse';

// 国土数値情報の行政区域データ（PMTiles形式）
const PMTILES_URL = './japan_municipalities.pmtiles';

// デフォルトのスプレッドシートURL
const DEFAULT_CSV_URL = '';

// CSVで指定された市区町村のセット
let specifiedCities = new Set();

// PMTilesプロトコルを登録（Firefox対応）
const protocol = new Protocol();

// PMTilesインスタンスを作成してプロトコルに追加
const pmtilesUrl = new URL(PMTILES_URL, window.location.href).href;
const pmtiles = new PMTiles(pmtilesUrl);
protocol.add(pmtiles);

maplibregl.addProtocol('pmtiles', protocol.tile);

// マップの初期化
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            // OpenStreetMap背景
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors'
            }
        },
        layers: [
            {
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }
        ]
    },
    center: [139.75, 35.68],
    zoom: 10
});

// ナビゲーションコントロール追加
map.addControl(new maplibregl.NavigationControl());

// スプレッドシートURLをCSV出力URLに変換
function convertToCSVUrl(url) {
    // すでにCSV出力形式の場合はそのまま返す
    if (url.includes('output=csv') || url.includes('export?format=csv')) {
        return url;
    }
    
    // 公開URL形式: /d/e/XXXXX/pubhtml → /d/e/XXXXX/pub?output=csv
    if (url.includes('/pubhtml')) {
        return url.replace('/pubhtml', '/pub?output=csv');
    }
    
    // 編集URL形式: /d/XXXXX/edit → /d/XXXXX/export?format=csv
    const editMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (editMatch) {
        const spreadsheetId = editMatch[1];
        // gidがあれば抽出
        const gidMatch = url.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    }
    
    return url;
}

// CSVを読み込んで市区町村リストを取得
async function loadCSV(csvUrl) {
    const response = await fetch(csvUrl);
    if (!response.ok) {
        throw new Error(`CSV読み込みエラー: ${response.status}`);
    }
    const csvText = await response.text();
    
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: true,
            complete: (results) => {
                specifiedCities.clear(); // 前のデータをクリア
                results.data.forEach(row => {
                    // カラム名「市区町村」または「city_name」に対応
                    const cityName = row['市区町村'] || row.city_name;
                    if (cityName && cityName.trim()) {
                        specifiedCities.add(cityName.trim());
                    }
                });
                resolve();
            },
            error: (error) => {
                reject(error);
            }
        });
    });
}

// スプレッドシートを読み込んでマップを更新
async function loadSpreadsheet(url) {
    const loadBtn = document.getElementById('load-btn');
    const cityCountEl = document.getElementById('city-count');
    
    try {
        loadBtn.disabled = true;
        loadBtn.textContent = '読み込み中...';
        updateStatus('スプレッドシートを読み込み中...', '#007bff');
        
        const csvUrl = convertToCSVUrl(url);
        console.log('CSV URL:', csvUrl);
        
        await loadCSV(csvUrl);
        console.log('CSVで指定された市区町村:', Array.from(specifiedCities));
        
        // レイヤーを更新
        updateMunicipalityLayer();
        
        // 選択された市区町村にズーム
        fitToSelectedCities();
        
        updateStatus('読み込み完了', '#28a745');
        cityCountEl.textContent = `${specifiedCities.size} 市区町村を選択中`;
        
        // URLをローカルストレージに保存
        localStorage.setItem('spreadsheetUrl', url);
        
    } catch (error) {
        console.error('読み込みエラー:', error);
        updateStatus('エラー: ' + error.message, '#dc3545');
        cityCountEl.textContent = '';
    } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = '読み込み';
    }
}

// レイヤーの色を更新
function updateMunicipalityLayer() {
    const colorExpression = buildColorExpression();
    
    if (map.getLayer('municipality-fill')) {
        map.setPaintProperty('municipality-fill', 'fill-color', colorExpression);
    }
}

// メイン処理
async function init() {
    // UI要素を取得
    const urlInput = document.getElementById('spreadsheet-url');
    const loadBtn = document.getElementById('load-btn');
    
    // 保存されたURLがあれば復元
    const savedUrl = localStorage.getItem('spreadsheetUrl') || DEFAULT_CSV_URL;
    urlInput.value = savedUrl;
    
    // 読み込みボタンのイベント
    loadBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
            loadSpreadsheet(url);
        }
    });
    
    // Enterキーでも読み込み
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const url = urlInput.value.trim();
            if (url) {
                loadSpreadsheet(url);
            }
        }
    });
    
    // マップの読み込み完了を待つ
    map.on('load', () => {
        addMunicipalityLayer();
        // 初期URLでスプレッドシートを読み込み
        loadSpreadsheet(savedUrl);
    });

    map.on('error', (error) => {
        console.error('Error:', error);
        updateStatus('エラーが発生しました: ' + error.message, '#dc3545');
    });
}

// 色分け表現を構築
function buildColorExpression() {
    // CSVで指定された市区町村は青色、それ以外はグレー
    const cityList = Array.from(specifiedCities);
    
    if (cityList.length === 0) {
        return '#cccccc'; // CSVが空の場合は全てグレー
    }
    
    // match式を使用: 指定された市区町村に一致すれば青、それ以外はグレー
    return [
        'case',
        ['in', ['get', 'N03_004'], ['literal', cityList]],
        '#4a90d9',  // CSVで指定された市区町村（青）
        '#cccccc'   // それ以外（グレー）
    ];
}

// 市区町村レイヤーを追加
function addMunicipalityLayer() {
    // PMTilesソースを追加（絶対URLを使用してFirefoxでの問題を回避）
    map.addSource('municipalities', {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`
    });

    const colorExpression = buildColorExpression();
    console.log('色分け表現:', colorExpression);

    // 塗りつぶしレイヤー
    map.addLayer({
        id: 'municipality-fill',
        type: 'fill',
        source: 'municipalities',
        'source-layer': 'municipalities',
        paint: {
            'fill-color': colorExpression,
            'fill-opacity': 0.6
        }
    });

    // 境界線レイヤー
    map.addLayer({
        id: 'municipality-line',
        type: 'line',
        source: 'municipalities',
        'source-layer': 'municipalities',
        paint: {
            'line-color': '#ffffff',
            'line-width': 1
        }
    });

    // ホバー時のポップアップ
    setupPopup();
}

// ポップアップ設定
function setupPopup() {
    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false
    });

    map.on('mousemove', 'municipality-fill', (e) => {
        if (e.features.length > 0) {
            const feature = e.features[0];
            const cityName = feature.properties.N03_004 || feature.properties.name || '不明';
            const prefName = feature.properties.N03_001 || '';
            
            popup
                .setLngLat(e.lngLat)
                .setHTML(`<strong>${prefName} ${cityName}</strong>`)
                .addTo(map);
            
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('mouseleave', 'municipality-fill', () => {
        popup.remove();
        map.getCanvas().style.cursor = '';
    });
}

// ステータス更新
function updateStatus(message, color) {
    const loadingEl = document.getElementById('loading');
    loadingEl.textContent = message;
    loadingEl.style.color = color;
}

// CSVで指定された市区町村の範囲にフィット
function fitToSelectedCities() {
    if (specifiedCities.size === 0) return;

    // ソースデータの読み込みを待つ
    map.once('idle', () => {
        // 画面全体のフィーチャーを取得
        const features = map.querySourceFeatures('municipalities', {
            sourceLayer: 'municipalities'
        });

        // CSVで指定された市区町村のフィーチャーをフィルタリング
        const targetFeatures = features.filter(f => 
            specifiedCities.has(f.properties.N03_004)
        );

        if (targetFeatures.length === 0) {
            console.log('CSVで指定された市区町村が見つかりません。再試行します...');
            // 少し待ってから再試行
            setTimeout(() => fitToSelectedCities(), 500);
            return;
        }

        // バウンディングボックスを計算
        const bounds = new maplibregl.LngLatBounds();
        
        targetFeatures.forEach(feature => {
            // ジオメトリの座標からバウンドを計算
            const addCoords = (coords) => {
                if (typeof coords[0] === 'number') {
                    bounds.extend(coords);
                } else {
                    coords.forEach(c => addCoords(c));
                }
            };
            
            if (feature.geometry && feature.geometry.coordinates) {
                addCoords(feature.geometry.coordinates);
            }
        });

        if (!bounds.isEmpty()) {
            console.log('選択された市区町村にズーム:', Array.from(specifiedCities));
            map.fitBounds(bounds, {
                padding: 50,
                maxZoom: 12
            });
        }
    });
}

// アプリ起動
init();
