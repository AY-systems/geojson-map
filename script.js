import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol, PMTiles } from 'pmtiles';
import Papa from 'papaparse';

// 国土数値情報の行政区域データ（PMTiles形式）
const PMTILES_URL = './japan_municipalities.pmtiles';

// 検索用データのURL
const SEARCH_DATA_URL = './search-data.json';

// デフォルトのスプレッドシートURL
const DEFAULT_CSV_URL = '';

// CSVで指定された市区町村のセット
let specifiedCities = new Set();

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
    zoom: 10,
    preserveDrawingBuffer: true  // 画像エクスポート用
});

// ナビゲーションコントロール追加
map.addControl(new maplibregl.NavigationControl());

// 独自エクスポートコントロール
class ExportControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        
        const button = document.createElement('button');
        button.type = 'button';
        button.title = '画像として保存';
        button.innerHTML = '📷';
        button.style.fontSize = '18px';
        button.style.cursor = 'pointer';
        
        button.addEventListener('click', () => this._exportMap());
        
        this._container.appendChild(button);
        return this._container;
    }
    
    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
    
    _exportMap() {
        const mapCanvas = this._map.getCanvas();
        
        // 新しいキャンバスを作成して権利表示を追加
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = mapCanvas.width;
        exportCanvas.height = mapCanvas.height;
        const ctx = exportCanvas.getContext('2d');
        
        // マップを描画
        ctx.drawImage(mapCanvas, 0, 0);
        
        // 権利表示を追加
        const attribution = '© OpenStreetMap contributors';
        const padding = 8;
        const fontSize = 12 * window.devicePixelRatio;
        
        ctx.font = `${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(attribution).width;
        
        // 背景を描画（右下）
        const bgX = exportCanvas.width - textWidth - padding * 3;
        const bgY = exportCanvas.height - fontSize - padding * 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(bgX, bgY, textWidth + padding * 2, fontSize + padding);
        
        // テキストを描画
        ctx.fillStyle = '#333';
        ctx.fillText(attribution, bgX + padding, exportCanvas.height - padding - 4);
        
        // ダウンロード
        const link = document.createElement('a');
        link.download = `map-${new Date().toISOString().slice(0,10)}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }
}

map.addControl(new ExportControl(), 'top-left');

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

    // N03_003（郡・政令市名）+ N03_004（市区町村名）を結合してマッチング
    // 例: "上益城郡" + "益城町" = "上益城郡益城町"
    return [
        'case',
        ['in',
            ['concat',
                ['coalesce', ['get', 'N03_003'], ''],
                ['coalesce', ['get', 'N03_004'], '']
            ],
            ['literal', cityList]
        ],
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
            const prefName = feature.properties.N03_001 || '';
            const gunName = feature.properties.N03_003 || '';  // 郡・政令市名
            const cityName = feature.properties.N03_004 || feature.properties.name || '不明';
            const fullName = gunName + cityName;  // 結合名

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
