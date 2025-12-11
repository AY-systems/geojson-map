import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import Papa from 'papaparse';

// 設定
const CSV_URL = './sample_data.csv';

// 国土数値情報の行政区域データ（PMTiles形式）
// ※以下は公開されているサンプルURLです。本番では自前でホスティングしてください
// const PMTILES_URL = 'https://tile.openstreetmap.jp/static/gsi_experimental_nnfcc_a.pmtiles';

// 代替: 自前でPMTilesを生成する場合のローカルURL
const PMTILES_URL = './japan_municipalities.pmtiles';

// PMTilesプロトコルを登録
const protocol = new Protocol();
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

// 色マップを保持
let colorMap = new Map();

// メイン処理
async function init() {
    try {
        // CSVを読み込み
        const csvData = await fetchCSV(CSV_URL);
        colorMap = processCSV(csvData);
        
        // マップの読み込み完了を待つ
        map.on('load', () => {
            addMunicipalityLayer();
            updateStatus('読み込み完了', '#28a745');
        });

    } catch (error) {
        console.error('Error:', error);
        updateStatus('エラーが発生しました: ' + error.message, '#dc3545');
    }
}

// CSV取得 & パース
async function fetchCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            complete: (results) => resolve(results.data),
            error: (error) => reject(error)
        });
    });
}

// CSVデータをMapに変換 (City Name -> Color)
function processCSV(data) {
    const map = new Map();
    data.forEach(row => {
        if (row.city_name && row.color) {
            map.set(row.city_name, row.color);
        }
    });
    console.log('CSV読み込み完了:', map.size, '件');
    return map;
}

// 市区町村レイヤーを追加
function addMunicipalityLayer() {
    // PMTilesソースを追加
    map.addSource('municipalities', {
        type: 'vector',
        url: `pmtiles://${PMTILES_URL}`
    });

    // CSVの色データからmatch式を構築
    const colorExpression = buildColorExpression();

    // 塗りつぶしレイヤー
    map.addLayer({
        id: 'municipality-fill',
        type: 'fill',
        source: 'municipalities',
        'source-layer': 'municipalities', // tippecanoe --layer=municipalities で指定した名前
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

// 色のmatch式を構築
function buildColorExpression() {
    if (colorMap.size === 0) {
        return '#cccccc';
    }

    // match式: ['match', ['get', 'property'], value1, color1, value2, color2, ..., defaultColor]
    const matchExpr = ['match', ['get', 'N03_004']];
    
    colorMap.forEach((color, cityName) => {
        matchExpr.push(cityName, color);
    });
    
    // デフォルト色
    matchExpr.push('#cccccc');
    
    return matchExpr;
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

// アプリ起動
init();
