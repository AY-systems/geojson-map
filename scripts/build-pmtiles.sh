#!/bin/bash

# ==========================================
# PMTiles 一括作成スクリプト
# ==========================================
# 
# 使い方:
#   ./scripts/build-pmtiles.sh [入力GeoJSON] [出力PMTiles] [湖沼データ]
#
# 例:
#   ./scripts/build-pmtiles.sh N03-20240101.geojson japan_municipalities.pmtiles W09-05/W09-05_Lake.shp
#
# 湖沼データについて:
#   国土数値情報の湖沼データ（W09）をダウンロードして使用します
#   https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-W09-v2_2.html
#   Shapefile形式（.shp）またはGeoJSON形式に対応しています
#
# 必要なツール:
#   - mapshaper: npm install -g mapshaper
#   - tippecanoe: brew install tippecanoe
#
# ==========================================

set -e

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo -e "\n${BLUE}🔄 $1${NC}"
}

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# デフォルト値
INPUT_GEOJSON="${1:-$PROJECT_DIR/N03-20240101.geojson}"
OUTPUT_PMTILES="${2:-$PROJECT_DIR/japan_municipalities.pmtiles}"
LAKES_INPUT="${3:-$PROJECT_DIR/W09-05-g_Lake.shp}"  # 湖沼データ（.shp または .geojson、オプション）
TEMP_DIR="$PROJECT_DIR/.temp"
PROCESSED_GEOJSON="$TEMP_DIR/processed.geojson"
PROCESSED_LAKES_GEOJSON="$TEMP_DIR/processed_lakes.geojson"

echo ""
echo "=========================================="
echo "  PMTiles 一括作成スクリプト"
echo "=========================================="
echo ""

# ==========================================
# 1. 必要なツールの確認
# ==========================================
log_step "必要なツールを確認中..."

MISSING_TOOLS=()

if ! command -v mapshaper &> /dev/null; then
    MISSING_TOOLS+=("mapshaper")
fi

if ! command -v tippecanoe &> /dev/null; then
    MISSING_TOOLS+=("tippecanoe")
fi

if [ ${#MISSING_TOOLS[@]} -ne 0 ]; then
    log_error "以下のツールがインストールされていません:"
    for tool in "${MISSING_TOOLS[@]}"; do
        echo "  - $tool"
    done
    exit 1
fi

log_success "必要なツールが全てインストールされています"
echo "  - mapshaper: $(mapshaper --version 2>/dev/null || echo 'installed')"
echo "  - tippecanoe: $(tippecanoe --version 2>&1 | head -1)"

# ==========================================
# 2. 入力ファイルの確認
# ==========================================
log_step "入力ファイルを確認中..."

if [ ! -f "$INPUT_GEOJSON" ]; then
    log_error "入力ファイルが見つかりません: $INPUT_GEOJSON"
    exit 1
fi

INPUT_SIZE=$(du -h "$INPUT_GEOJSON" | cut -f1)
log_success "入力ファイル: $INPUT_GEOJSON ($INPUT_SIZE)"

# 湖沼データがあるか確認
LAKES_ENABLED=false
if [ -n "$LAKES_INPUT" ]; then
    if [ -f "$LAKES_INPUT" ]; then
        LAKES_SIZE=$(du -h "$LAKES_INPUT" | cut -f1)
        log_success "湖沼ファイル: $LAKES_INPUT ($LAKES_SIZE)"
        LAKES_ENABLED=true
    else
        log_warning "湖沼ファイルが見つかりません: $LAKES_INPUT（スキップします）"
    fi
else
    log_info "湖沼データは指定されていません（行政区域のみ処理します）"
fi

# ==========================================
# 3. 一時ディレクトリの作成
# ==========================================
log_step "一時ディレクトリを準備中..."

mkdir -p "$TEMP_DIR"
log_success "一時ディレクトリ: $TEMP_DIR"

# ==========================================
# 4. GeoJSONの前処理（mapshaper）
# ==========================================
log_step "GeoJSONを前処理中（mapshaper）..."

echo "  処理内容:"
echo "    - ポリゴンの簡略化 (1% keep-shapes)"
echo "    - 同じ行政区域コードで結合 (dissolve)"

# 修正: -explode, -sort, -uniq を削除し、-dissolve で結合する
# copy-fields で必要な属性（都道府県名など）を引き継ぐ
mapshaper "$INPUT_GEOJSON" \
    -simplify 1% keep-shapes \
    -dissolve N03_007 copy-fields=N03_001,N03_002,N03_003,N03_004,N03_005 \
    -o "$PROCESSED_GEOJSON" format=geojson force

PROCESSED_SIZE=$(du -h "$PROCESSED_GEOJSON" | cut -f1)
log_success "前処理完了: $PROCESSED_GEOJSON ($PROCESSED_SIZE)"

# 処理前後のフィーチャー数を表示
ORIGINAL_COUNT=$(grep -o '"type":"Feature"' "$INPUT_GEOJSON" | wc -l | tr -d ' ')
PROCESSED_COUNT=$(grep -o '"type":"Feature"' "$PROCESSED_GEOJSON" | wc -l | tr -d ' ')
echo "  フィーチャー数: $ORIGINAL_COUNT → $PROCESSED_COUNT"

# ==========================================
# 4.5. 湖沼データの前処理（オプション）
# ==========================================
if [ "$LAKES_ENABLED" = true ]; then
    log_step "湖沼データを前処理中（mapshaper）..."

    # 入力ファイルの形式を判定
    LAKES_EXT="${LAKES_INPUT##*.}"
    echo "  入力形式: .$LAKES_EXT"
    echo "  処理内容:"
    echo "    - ポリゴンの簡略化 (5% keep-shapes)"
    echo "    - 属性の標準化"

    # 湖沼データの前処理（mapshaperはShapefileを直接読み込める）
    # W09の属性: W09_001（湖沼名）, W09_002（都道府県名）, W09_003（最大水深）など
    mapshaper "$LAKES_INPUT" encoding=sjis \
        -simplify 5% keep-shapes \
        -each 'lake_name = this.properties.W09_001 || this.properties.name || ""; pref_name = this.properties.W09_002 || ""; lake_type = "lake"' \
        -filter-fields lake_name,pref_name,lake_type,W09_001,W09_002,W09_003,W09_004 \
        -o "$PROCESSED_LAKES_GEOJSON" format=geojson force

    PROCESSED_LAKES_SIZE=$(du -h "$PROCESSED_LAKES_GEOJSON" | cut -f1)
    log_success "湖沼前処理完了: $PROCESSED_LAKES_GEOJSON ($PROCESSED_LAKES_SIZE)"

    LAKES_COUNT=$(grep -o '"type":"Feature"' "$PROCESSED_LAKES_GEOJSON" | wc -l | tr -d ' ')
    echo "  湖沼フィーチャー数: $LAKES_COUNT"
fi

# ==========================================
# 5. PMTiles生成（tippecanoe）
# ==========================================
log_step "PMTilesを生成中（tippecanoe）..."

echo "  設定:"
echo "    - レイヤー名: municipalities"
if [ "$LAKES_ENABLED" = true ]; then
    echo "    - レイヤー名: lakes（湖沼）"
fi
echo "    - 最小ズーム: 4"
echo "    - 最大ズーム: 14"

# tippecanoeコマンドを構築
TIPPECANOE_CMD="tippecanoe -o \"$OUTPUT_PMTILES\" -Z4 -z14 --detect-shared-borders --coalesce-densest-as-needed --extend-zooms-if-still-dropping --force"

# 行政区域レイヤーを追加
TIPPECANOE_CMD="$TIPPECANOE_CMD --named-layer=municipalities:\"$PROCESSED_GEOJSON\""

# 湖沼レイヤーを追加（有効な場合）
if [ "$LAKES_ENABLED" = true ]; then
    TIPPECANOE_CMD="$TIPPECANOE_CMD --named-layer=lakes:\"$PROCESSED_LAKES_GEOJSON\""
fi

# tippecanoeを実行
eval $TIPPECANOE_CMD

OUTPUT_SIZE=$(du -h "$OUTPUT_PMTILES" | cut -f1)
log_success "PMTiles生成完了: $OUTPUT_PMTILES ($OUTPUT_SIZE)"

# ==========================================
# 6. クリーンアップ
# ==========================================
log_step "一時ファイルをクリーンアップ中..."

rm -rf "$TEMP_DIR"
log_success "一時ディレクトリを削除しました"

# ==========================================
# 完了
# ==========================================
echo ""
echo "=========================================="
log_success "PMTiles作成が完了しました！"
echo "=========================================="
echo ""
echo "出力ファイル: $OUTPUT_PMTILES"
echo "ファイルサイズ: $OUTPUT_SIZE"
echo ""
echo "含まれるレイヤー:"
echo "  - municipalities（行政区域）"
if [ "$LAKES_ENABLED" = true ]; then
    echo "  - lakes（湖沼）"
fi
echo ""
