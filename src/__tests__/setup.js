// 为 jsdom 环境添加 sendBeacon polyfill
if (!navigator.sendBeacon) {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: () => true,
    writable: true,
    configurable: true,
  });
}

if (!globalThis.OffscreenCanvas) {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._fillStyle = '';
    }

    getContext() {
      return {
        set fillStyle(value) {
          this._canvas._fillStyle = value;
        },
        get fillStyle() {
          return this._canvas._fillStyle;
        },
        fillRect() {},
        _canvas: this,
      };
    }

    async convertToBlob() {
      return new Blob([`${this.width}x${this.height}:${this._fillStyle}`], { type: 'image/png' });
    }
  };
}
