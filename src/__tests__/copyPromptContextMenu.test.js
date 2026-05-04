import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, setState } from '../store.js';
import {
  showMenu,
  hideMenu,
  handleAction,
} from '../components/contextMenu.js';

function makeContextMenuEvent() {
  return { preventDefault: vi.fn(), clientX: 200, clientY: 200 };
}

function setStoreCanvasItems(items) {
  const state = getState();
  state.canvasItems = items;
  state.selectedItemIds = [];
}

describe('右键菜单 - 复制提示词', () => {
  beforeEach(() => {
    // 重置剪贴板 mock
    let clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn((text) => {
          clipboardText = text;
          return Promise.resolve();
        }),
        write: vi.fn(() => Promise.resolve()),
        read: vi.fn(() => Promise.resolve([])),
      },
      writable: true,
      configurable: true,
    });

    // 重置 store 状态
    const state = getState();
    state.canvasItems = [];
    state.selectedItemIds = [];
    state.sessions = {};

    // 隐藏菜单（模块级状态重置）
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.remove('active');

    // 清空 toast
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = '';
      toast.className = 'toast';
    }

    vi.clearAllMocks();
  });

  describe('右键触发上下文菜单', () => {
    it('右键 canvas-item 应显示 canvas-image 上下文菜单', () => {
      const e = makeContextMenuEvent();
      showMenu(e, 'canvas-image', { itemId: 'item-0' });

      const menu = document.getElementById('contextMenu');
      expect(menu.classList.contains('active')).toBe(true);

      const copyPromptItem = document.querySelector('[data-action="copyPrompt"]');
      expect(copyPromptItem.classList.contains('hidden')).toBe(false);
    });

    it('复制提示词菜单项在 canvas-image 上下文中可见', () => {
      const e = makeContextMenuEvent();
      showMenu(e, 'canvas-image', { itemId: 'item-0' });

      const copyPromptItem = document.querySelector('[data-action="copyPrompt"]');
      expect(copyPromptItem.dataset.ctx).toBe('canvas-image');
      expect(copyPromptItem.classList.contains('hidden')).toBe(false);

      // 其他上下文的菜单项应隐藏
      const materialItem = document.querySelector('[data-action="addRef"]');
      expect(materialItem.classList.contains('hidden')).toBe(true);
    });

    it('hideMenu 应隐藏菜单', () => {
      const e = makeContextMenuEvent();
      showMenu(e, 'canvas-image', { itemId: 'item-0' });
      hideMenu();

      const menu = document.getElementById('contextMenu');
      expect(menu.classList.contains('active')).toBe(false);
    });
  });

  describe('复制提示词到剪贴板', () => {
    it('点击复制提示词应调用 clipboard.writeText 并显示成功 toast', async () => {
      setStoreCanvasItems([
        {
          itemId: 'item-0',
          prompt: '一只可爱的猫咪在草地上',
          imageUrl: 'http://localhost/test.png',
          messageIndex: 0,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
      ]);

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-0' });
      await handleAction('copyPrompt');

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('一只可爱的猫咪在草地上');

      const toast = document.getElementById('toast');
      expect(toast.textContent).toContain('已复制');
      expect(toast.className).toContain('success');
    });

    it('多条提示词应以分符合并', async () => {
      setStoreCanvasItems([
        {
          itemId: 'item-0',
          prompt: '提示词A',
          imageUrl: 'http://localhost/a.png',
          messageIndex: 0,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
        {
          itemId: 'item-1',
          prompt: '提示词B',
          imageUrl: 'http://localhost/b.png',
          messageIndex: 1,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
      ]);

      // 多选场景
      getState().selectedItemIds = ['item-0', 'item-1'];

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-0' });
      await handleAction('copyPrompt');

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('提示词A\n---\n提示词B');
    });

    it('item 无 prompt 时应复制降级文本', async () => {
      setStoreCanvasItems([
        {
          itemId: 'item-0',
          prompt: '',
          imageUrl: 'http://localhost/test.png',
          messageIndex: 0,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
      ]);

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-0' });
      await handleAction('copyPrompt');

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[无提示词]');
    });

    it('itemId 不存在时应降级复制 [无提示词] 不报错', async () => {
      setStoreCanvasItems([]);

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-nonexistent' });
      await handleAction('copyPrompt');

      // 不应抛出异常，降级复制 [无提示词]
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[无提示词]');
    });

    it('剪贴板 API 失败时应显示错误 toast', async () => {
      const writeTextSpy = vi.fn(() => Promise.reject(new Error('Clipboard access denied')));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        writable: true,
        configurable: true,
      });

      setStoreCanvasItems([
        {
          itemId: 'item-0',
          prompt: '测试提示词',
          imageUrl: 'http://localhost/test.png',
          messageIndex: 0,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
      ]);

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-0' });
      await handleAction('copyPrompt');

      const toast = document.getElementById('toast');
      expect(toast.textContent).toContain('失败');
      expect(toast.className).toContain('error');
    });
  });

  describe('剪贴板 API 不可用时的降级', () => {
    it('navigator.clipboard 不存在时应使用 execCommand fallback', async () => {
      // 保存原始 clipboard
      const origClipboard = navigator.clipboard;
      delete navigator.clipboard;

      // Mock execCommand
      document.execCommand = vi.fn(() => true);

      // 创建临时 textarea 如果不存在
      if (!document.getElementById('clipboard-fallback')) {
        const ta = document.createElement('textarea');
        ta.id = 'clipboard-fallback';
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
      }

      setStoreCanvasItems([
        {
          itemId: 'item-0',
          prompt: 'fallback测试',
          imageUrl: 'http://localhost/test.png',
          messageIndex: 0,
          x: 0, y: 0, width: 300, height: 300,
          generating: false, status: 'ok', error: '',
          refImages: [], model: '', provider: '',
          createdAt: null, durationMs: null, resolution: null,
          type: 'image',
        },
      ]);

      showMenu(makeContextMenuEvent(), 'canvas-image', { itemId: 'item-0' });
      await handleAction('copyPrompt');

      expect(document.execCommand).toHaveBeenCalledWith('copy');

      // 恢复 clipboard
      Object.defineProperty(navigator, 'clipboard', {
        value: origClipboard,
        writable: true,
        configurable: true,
      });
    });
  });
});
