import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import Papa from 'papaparse';

// 国土数値情報の行政区域データ（PMTiles形式）
const PMTILES_URL = './japan_municipalities.pmtiles';
const CSV_URL = './sample_data.csv';

// CSVで指定された市区町村のセット
let specifiedCities = new Set();

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

// CSVを読み込んで市区町村リストを取得
async function loadCSV() {
    const response = await fetch(CSV_URL);
    const csvText = await response.text();
    
    return new Promise((resolve) => {
        Papa.parse(csvText, {
            header: true,
            complete: (results) => {
                results.data.forEach(row => {
                    if (row.city_name) {
                        specifiedCities.add(row.city_name);
                    }
                });
                resolve();
            }
        });
    });
}

// メイン処理
async function init() {
    try {
        // CSVを読み込む
        await loadCSV();
        console.log('CSVで指定された市区町村:', Array.from(specifiedCities));
        
        // マップの読み込み完了を待つ
        map.on('load', () => {
            addMunicipalityLayer();
            updateStatus('読み込み完了', '#28a745');
        });

        map.on('error', (error) => {
            console.error('Error:', error);
            updateStatus('エラーが発生しました: ' + error.message, '#dc3545');
        });
    } catch (error) {
        console.error('初期化エラー:', error);
        updateStatus('エラーが発生しました: ' + error.message, '#dc3545');
    }
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
    // PMTilesソースを追加
    map.addSource('municipalities', {
        type: 'vector',
        url: `pmtiles://${PMTILES_URL}`
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

// アプリ起動
init();
