// 設定
const GEOJSON_URL = './tokyo_sample.geojson'; // 本番では適切なURLに変更
const CSV_URL = './sample_data.csv'; // 本番ではGoogle Sheetsの公開CSV URLに変更

// 離島除外の閾値 (簡易面積計算)
// 緯度経度の差分ベース。実際の運用では調整が必要。
// 例: 0.0001 程度を閾値としてみる
const MIN_AREA_THRESHOLD = 0.00005; 

// マップの初期化
const map = L.map('map').setView([35.68, 139.75], 11);

// 背景地図 (OpenStreetMap)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// メイン処理
async function init() {
    try {
        const [geoJsonData, csvData] = await Promise.all([
            fetchGeoJSON(GEOJSON_URL),
            fetchCSV(CSV_URL)
        ]);

        const colorMap = processCSV(csvData);
        const filteredGeoJson = filterIslands(geoJsonData);
        
        renderMap(filteredGeoJson, colorMap);
        
        document.getElementById('loading').textContent = '読み込み完了';
        document.getElementById('loading').style.color = '#28a745';

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('loading').textContent = 'エラーが発生しました';
        document.getElementById('loading').style.color = '#dc3545';
    }
}

// GeoJSON取得
async function fetchGeoJSON(url) {
    const response = await fetch(url);
    return await response.json();
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
    return map;
}

// 離島（小さなポリゴン）の除外処理
function filterIslands(geoJson) {
    // ディープコピーを作成して元のデータを破壊しないようにする
    const newGeoJson = JSON.parse(JSON.stringify(geoJson));

    newGeoJson.features = newGeoJson.features.map(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            // MultiPolygonの場合、各ポリゴンの面積を計算し、小さいものを除去
            const polygons = feature.geometry.coordinates;
            
            // 各ポリゴンの簡易面積を計算
            const polygonsWithArea = polygons.map(poly => {
                // 外側のリング(0番目)を使って面積概算
                const outerRing = poly[0];
                const area = calculatePolygonArea(outerRing);
                return { poly, area };
            });

            // 最大のポリゴンを探す
            const maxArea = Math.max(...polygonsWithArea.map(p => p.area));
            
            // 閾値判定: 最大面積の10%未満、かつ絶対閾値未満なら削除、等のロジック
            // ここではシンプルに「絶対閾値未満」を削除します
            const filteredPolygons = polygonsWithArea
                .filter(p => p.area > MIN_AREA_THRESHOLD)
                .map(p => p.poly);

            if (filteredPolygons.length === 0) {
                // 全部消えてしまったらnullを返す（後で除去）
                return null; 
            }

            // 座標を更新
            feature.geometry.coordinates = filteredPolygons;
            
            // もしポリゴンが1つになったらTypeをPolygonに変える等の最適化も可能だが
            // Leafletは1つのMultiPolygonでも描画できるのでそのままにする
        }
        return feature;
    }).filter(f => f !== null); // nullになったfeatureを除去

    return newGeoJson;
}

// 簡易面積計算 (Shoelace formulaの簡易版)
function calculatePolygonArea(coords) {
    let area = 0;
    const n = coords.length;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[(i + 1) % n];
        area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area) / 2;
}

// 地図描画
function renderMap(geoJson, colorMap) {
    L.geoJSON(geoJson, {
        style: (feature) => {
            // プロパティ名はデータソースによる。
            // 国土数値情報などでは N03_004 が市区町村名
            const cityName = feature.properties.N03_004; 
            const color = colorMap.get(cityName) || '#cccccc'; // デフォルト色: グレー

            return {
                fillColor: color,
                weight: 1,
                opacity: 1,
                color: 'white',
                dashArray: '3',
                fillOpacity: 0.7
            };
        },
        onEachFeature: (feature, layer) => {
            const cityName = feature.properties.N03_004;
            if (cityName) {
                layer.bindTooltip(cityName);
            }
        }
    }).addTo(map);
}

// アプリ起動
init();