// 为 jsdom 环境添加 sendBeacon polyfill
if (!navigator.sendBeacon) {
  Object.defineProperty(navigator, 'sendBeacon', {
    value: () => true,
    writable: true,
    configurable: true,
  });
}

// ===== 为右键菜单复制提示词测试准备 DOM 结构 =====
document.body.innerHTML = `
<div class="context-menu" id="contextMenu">
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="copyImage">复制图片</div>
  <div class="menu-divider hidden" data-ctx="canvas-image"></div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="addMaterial">添加到素材库</div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="copyPrompt">复制提示词</div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="download">下载图片</div>
  <div class="menu-divider hidden" data-ctx="canvas-image"></div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="makeStack">放入 stack</div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="removeFromStack">移出 stack</div>
  <div class="menu-divider hidden" data-ctx="canvas-image"></div>
  <div class="menu-item hidden" data-ctx="canvas-image" data-action="deleteImage">删除</div>
  <div class="menu-item hidden" data-ctx="material" data-action="addRef">作为参考图</div>
  <div class="menu-item hidden" data-ctx="material" data-action="downloadMat">下载图片</div>
  <div class="menu-divider hidden" data-ctx="material"></div>
  <div class="menu-item hidden" data-ctx="material" data-action="removeMaterial">从素材库删除</div>
  <div class="menu-item hidden" data-ctx="canvas-empty" data-action="pasteImage">粘贴</div>
  <div class="menu-divider hidden" data-ctx="canvas-empty"></div>
  <div class="menu-item hidden" data-ctx="canvas-empty" data-action="promptHistory">提示词历史</div>
  <div class="menu-item hidden" data-ctx="canvas-empty" data-action="clearCanvas">清空画板</div>
</div>
<div id="toast" class="toast"></div>
<div class="canvas-container">
  <div class="canvas-surface">
    <div class="canvas-item" data-item-id="item-0"></div>
    <div class="canvas-item" data-item-id="item-1"></div>
  </div>
</div>
`;

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
