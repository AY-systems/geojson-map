#!/bin/bash

# ==========================================
# PMTiles 一括作成スクリプト
# ==========================================
# 
# 使い方:
#   ./scripts/build-pmtiles.sh [入力GeoJSON] [出力PMTiles]
#
# 例:
#   ./scripts/build-pmtiles.sh N03-20240101.geojson japan_municipalities.pmtiles
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
TEMP_DIR="$PROJECT_DIR/.temp"
PROCESSED_GEOJSON="$TEMP_DIR/processed.geojson"

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
# 5. PMTiles生成（tippecanoe）
# ==========================================
log_step "PMTilesを生成中（tippecanoe）..."

echo "  設定:"
echo "    - レイヤー名: municipalities"
echo "    - 最小ズーム: 4"
echo "    - 最大ズーム: 14"

tippecanoe \
    -o "$OUTPUT_PMTILES" \
    --layer=municipalities \
    -Z4 -z14 \
    --detect-shared-borders \
    --coalesce-densest-as-needed \
    --extend-zooms-if-still-dropping \
    --force \
    "$PROCESSED_GEOJSON"

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
