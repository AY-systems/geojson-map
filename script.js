import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol, PMTiles } from 'pmtiles';
import Papa from 'papaparse';

import { ScreenShotControl } from './plugins/screenshot';

// 国土数値情報の行政区域データ（PMTiles形式）
const PMTILES_URL = 'https://r2-pmtiles.ay-sys.link/japan_municipalities.pmtiles';

// 検索用データのURL
const SEARCH_DATA_URL = './search-data.json';

// デフォルトのスプレッドシートURL
const DEFAULT_CSV_URL = '';

// CSVで指定された市区町村のセット
let specifiedCities = new Map();

// CSVのヘッダー名称
const CsvHeaderColors = new Map();

// 選択済み市区町村の色（後から変更可能）
// const SELECTED_COLOR_STORAGE_KEY = 'selectedMunicipalityColor';
// let selectedMunicipalityColor = localStorage.getItem(SELECTED_COLOR_STORAGE_KEY) || '#4a90d9';

function setSelectedMunicipalityColor(color) {
    if (!color || typeof color !== 'string') return;
    selectedMunicipalityColor = color;
    localStorage.setItem(SELECTED_COLOR_STORAGE_KEY, color);

    const mapPicker = document.getElementById('selected-color-map');
    if (mapPicker && mapPicker.value !== color) {
        mapPicker.value = color;
    }

    updateMunicipalityLayer();
}

// 検索用市区町村データ
let searchData = [];

// 現在ハイライト中の市区町村コード
let highlightedCode = null;

// PMTilesプロトコルを登録（Firefox対応）
const protocol = new Protocol();

// PMTilesインスタンスを作成してプロトコルに追加
const pmtilesUrl = new URL(PMTILES_URL, window.location.href).href;
const pmtiles = new PMTiles(pmtilesUrl);
protocol.add(pmtiles);

maplibregl.addProtocol('pmtiles', protocol.tile);


const japanBounds = [
    [120.0, 20.0], // Southwest coordinates (例: 東経120度, 北緯20度)
    [160.0, 48.0]  // Northeast coordinates (例: 東経160度, 北緯48度)
];

// マップの初期化
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [137.0, 35.0], // 初期表示中心座標
    zoom: 3,
    preserveDrawingBuffer: true,  // 画像エクスポート用
    maxBounds: japanBounds // 表示範囲の制限
});

// ナビゲーションコントロール追加
map.addControl(new maplibregl.NavigationControl());
map.addControl(new ScreenShotControl(), 'top-left');

// 地図上で選択色を変えるコントロール
class SelectedColorControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.style.display = 'grid';
        this._container.style.gap = '5px';
        this._container.style.gridTemplateColumns = '30px auto';
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

        this.updateControl();

        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    updateControl() {
        const container = this._container;

        // colorControlDiv.style.display = 'block';
        container.innerHTML = ''; // 既存の内容をクリア

        const keys = Array.from(specifiedCities.keys());
        keys.forEach((key, index) => {
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = CsvHeaderColors.get(key) || getDefaultColor(key);
            colorInput.style.width = '30px';
            colorInput.style.height = '30px';
            colorInput.style.cursor = 'pointer';

            colorInput.addEventListener('input', (e) => {
                // 色を更新 
                CsvHeaderColors.set(key, e.target.value);
                updateMunicipalityLayer();
            });

            container.appendChild(colorInput);

            // keyも表示する
            const keyLabel = document.createElement('span');
            keyLabel.textContent = key;
            keyLabel.style.fontSize = '12px';
            keyLabel.style.background = 'rgba(255, 255, 255, 0.8)';
            keyLabel.style.padding = '2px 4px';
            container.appendChild(keyLabel);
        });

    }


}

const selectedColorControl = new SelectedColorControl();
map.addControl(selectedColorControl, 'top-left');

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
                    Object.keys(row).forEach(key => {
                        
                        // 都道府県という文字が含まれるヘッダーの値をフィルターする
                        if (key.includes('都道府県')) {
                            return;
                        }

                        // CsvHeaderNames.add(key);
                        // console.log(row);

                        const list = specifiedCities.get(key) || new Set();
                        const cityName = row[key];
                        if (cityName && cityName.trim()) {
                            list.add(cityName.trim());
                            specifiedCities.set(key, list);
                        }
                    });
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

        // 色変更コントロールを更新
        selectedColorControl.updateControl();

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
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    // 検索用データを読み込み
    await loadSearchData();

    // 検索入力のイベント
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length >= 1) {
            showSearchResults(query);
        } else {
            searchResults.innerHTML = '';
            clearHighlight();
        }
    });

    // 検索フィールドからフォーカスが外れたら結果を閉じる（少し遅延）
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            searchResults.innerHTML = '';
        }, 200);
    });

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

    function hideLabelsFromBasemap() {
        const style = map.getStyle();
        if (!style?.layers) return;

        for (const layer of style.layers) {
            if (layer.type !== 'symbol') continue;

            // 「文字ラベル」があるsymbolだけ消す（アイコンだけのレイヤーは残す）
            const hasTextField = layer.layout && Object.prototype.hasOwnProperty.call(layer.layout, 'text-field');
            if (!hasTextField) continue;

            try {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
            } catch {
                // 既に消えてる/変更不可などは無視
            }
        }
    }

    // マップの読み込み完了を待つ
    map.on('load', () => {
        hideLabelsFromBasemap();

        addMunicipalityLayer();
        // 初期URLでスプレッドシートを読み込み
        loadSpreadsheet(savedUrl);
    });

    map.on('error', (error) => {
        console.error('Error:', error);
        updateStatus('エラーが発生しました: ' + error.message, '#dc3545');
    });
}

function getDefaultColor(headerName) {
    // ヘッダー名に基づいてデフォルトの色を返す
    const colors = [
        '#4a90d9', // 青
        '#50e3c2', // 水色
        '#f5a623', // オレンジ
        '#9013fe', // 紫
        '#b8e986', // 黄緑
        '#ff6b35', // 赤橙
        '#8b572a', // 茶色
        '#7ed321'  // 緑
    ];
    const index = Array.from(specifiedCities.keys()).indexOf(headerName);
    return colors[index % colors.length];
}

// 色分け表現を構築
function buildColorExpression() {
    const s = new Set();
    specifiedCities.forEach((citySet) => {
        citySet.forEach(city => s.add(city));
    });
    // CSVで指定された市区町村は青色、それ以外はグレー
    const cityList = Array.from(s);

    if (cityList.length === 0) {
        return '#cccccc'; // CSVが空の場合は全てグレー
    }

    // 各ヘッダーごとに条件を作成
    const conditions = [];

    specifiedCities.forEach((citySet, headerName) => {
        const cityList = Array.from(citySet);
        const color = CsvHeaderColors.get(headerName) || getDefaultColor(headerName);

        // N03_003（郡・政令市名）+ N03_004（市区町村名）を結合してマッチング
        // 例: "上益城郡" + "益城町" = "上益城郡益城町"
        conditions.push(
            ['in',
                ['concat',
                    ['coalesce', ['get', 'N03_003'], ''],
                    ['coalesce', ['get', 'N03_004'], '']
                ],
                ['literal', cityList]
            ],
            color
        );
    });

    // caseステートメントを構築
    return ['case', ...conditions, '#cccccc'];
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
            const prefName = feature.properties.N03_001 || '';
            const gunName = feature.properties.N03_003 || '';  // 郡・政令市名
            const cityName = feature.properties.N03_004 || feature.properties.name || '不明';
            const kuName = feature.properties.N03_005 || '';  // 区名（政令市の場合）
            const fullName = gunName + cityName + kuName;  // 結合名

            popup
                .setLngLat(e.lngLat)
                .setHTML(`<strong>${prefName} ${fullName}</strong>`)
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

// ==========================================
// 検索機能
// ==========================================

/**
 * 検索用データを読み込み
 */
async function loadSearchData() {
    try {
        const response = await fetch(SEARCH_DATA_URL);
        if (response.ok) {
            searchData = await response.json();
            console.log(`検索用データを読み込みました: ${searchData.length} 件`);
        }
    } catch (error) {
        console.warn('検索用データの読み込みに失敗しました:', error);
    }
}

/**
 * 検索結果を表示
 */
function showSearchResults(query) {
    const searchResults = document.getElementById('search-results');
    const normalizedQuery = query.toLowerCase();

    // 検索（都道府県名、市区町村名、フルネームで検索）
    const results = searchData.filter(m =>
        m.full.toLowerCase().includes(normalizedQuery) ||
        m.city.toLowerCase().includes(normalizedQuery) ||
        m.pref.toLowerCase().includes(normalizedQuery)
    ).slice(0, 10); // 最大10件

    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">該当する市区町村がありません</div>';
        return;
    }

    searchResults.innerHTML = results.map(m => `
        <div class="search-result-item" data-code="${m.code}" data-bounds='${JSON.stringify(m.bounds)}' data-full="${m.full}">
            <span class="city-name">${m.full}</span>
            <span class="pref-name">${m.pref}</span>
        </div>
    `).join('');

    // 結果クリックでその市区町村に移動
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('mousedown', () => {
            const code = item.dataset.code;
            const bounds = JSON.parse(item.dataset.bounds);
            const fullName = item.dataset.full;

            // 検索結果をクリア
            searchResults.innerHTML = '';
            document.getElementById('search-input').value = fullName;

            // 市区町村に移動してハイライト
            flyToMunicipality(bounds, code);
        });
    });
}

/**
 * 市区町村に移動してハイライト
 */
function flyToMunicipality(bounds, code) {
    // バウンドに移動
    map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 12,
        duration: 1000
    });

    // ハイライト表示
    highlightMunicipality(code);
}

/**
 * 市区町村をハイライト表示
 */
function highlightMunicipality(code) {
    highlightedCode = code;

    // ハイライトレイヤーがなければ追加
    if (!map.getLayer('municipality-highlight')) {
        map.addLayer({
            id: 'municipality-highlight',
            type: 'line',
            source: 'municipalities',
            'source-layer': 'municipalities',
            paint: {
                'line-color': '#ff6b35',
                'line-width': 4,
                'line-opacity': 0.9
            },
            filter: ['==', 'N03_007', '']
        });
    }

    // フィルターを更新
    map.setFilter('municipality-highlight', ['==', 'N03_007', code]);

    // 5秒後にハイライトを消す
    setTimeout(() => {
        if (highlightedCode === code) {
            clearHighlight();
        }
    }, 5000);
}

/**
 * ハイライトをクリア
 */
function clearHighlight() {
    highlightedCode = null;
    if (map.getLayer('municipality-highlight')) {
        map.setFilter('municipality-highlight', ['==', 'N03_007', '']);
    }
}
