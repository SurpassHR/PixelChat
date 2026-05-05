import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('展开态 Stack 子项索引映射', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="canvasContainer">
        <div id="canvasSurface"></div>
        <div id="canvasPlaceholder"></div>
      </div>
      <div id="imageDetailModal" class="modal hidden"></div>
      <div id="modalOverlay" class="modal-overlay hidden"></div>
      <div id="toast"></div>
    `;
    global.fetch = vi.fn(() => Promise.reject(new Error('backend unavailable')));
  });

  it('展开包含重复 imageUrl 的 stack 时每个临时项都应保留自己的 childIndex', async () => {
    const store = await import('../store.js');
    const sessionId = 'expanded-stack-session';

    store.getState().sessions = {
      [sessionId]: {
        id: sessionId,
        title: '测试会话',
        stacks: [
          {
            id: 'stack-1',
            x: 50,
            y: 60,
            width: 300,
            height: 300,
            items: [
              { imageUrl: '/api/images/same', prompt: 'first', width: 300, height: 300, status: 'ok' },
              { imageUrl: '/api/images/same', prompt: 'second', width: 300, height: 300, status: 'ok' },
            ],
          },
        ],
        messages: [],
        droppedImages: [],
      },
    };
    store.getState().currentSessionId = sessionId;
    await store.rebuildCanvasFromSession();

    const { initCanvas } = await import('../components/canvas.js');
    initCanvas();

    const stackEl = document.querySelector('.canvas-item[data-item-id="stack-stack-1"]');
    expect(stackEl).not.toBeNull();

    stackEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const expandedItems = [...document.querySelectorAll('.canvas-item[data-temp-stack-id="stack-1"]')];
    expect(expandedItems).toHaveLength(2);
    expect(expandedItems.map(el => el.dataset.childIndex)).toEqual(['0', '1']);
  });
});
