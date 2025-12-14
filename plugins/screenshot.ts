import type { IControl } from 'maplibre-gl';

export class ScreenShotControl implements IControl {
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
    link.download = `map-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }
}
