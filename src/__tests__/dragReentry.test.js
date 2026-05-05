import { describe, it, expect, beforeEach, vi } from 'vitest';

const createStackFromItemsMock = vi.fn();

vi.mock('../store.js', async () => {
  const actual = await vi.importActual('../store.js');
  return {
    ...actual,
    createStackFromItems: (...args) => createStackFromItemsMock(...args),
  };
});

describe('拖拽创建 Stack 重入保护', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="canvasContainer">
        <div id="canvasSurface"></div>
        <div id="canvasPlaceholder"></div>
      </div>
      <div id="toast"></div>
    `;
    Object.defineProperty(document, 'elementFromPoint', {
      value: vi.fn(() => null),
      configurable: true,
    });
    global.fetch = vi.fn(() => Promise.reject(new Error('backend unavailable')));
    createStackFromItemsMock.mockReset();
  });

  it('drop 与 dragend 连续触发时不应重复创建 stack', async () => {
    let resolveCreate;
    const pendingCreate = new Promise(resolve => {
      resolveCreate = resolve;
    });
    createStackFromItemsMock.mockImplementation(() => pendingCreate);

    const store = await import('../store.js');
    const sessionId = 'drag-reentry-session';
    store.getState().sessions = {
      [sessionId]: {
        id: sessionId,
        title: '测试会话',
        _canvasSeq: 2,
        messages: [],
        droppedImages: [],
        stacks: [],
      },
    };
    store.getState().currentSessionId = sessionId;
    store.getState().canvasItems = [
      {
        itemId: 'item-a',
        type: 'image',
        imageUrl: '/api/images/a',
        prompt: 'a',
        status: 'ok',
        x: 10,
        y: 10,
        width: 300,
        height: 300,
        generating: false,
        messageIndex: -1,
        canvasSeq: 1,
      },
      {
        itemId: 'item-b',
        type: 'image',
        imageUrl: '/api/images/b',
        prompt: 'b',
        status: 'ok',
        x: 420,
        y: 10,
        width: 300,
        height: 300,
        generating: false,
        messageIndex: -1,
        canvasSeq: 2,
      },
    ];

    const { initCanvas } = await import('../components/canvas.js');
    initCanvas();

    const sourceEl = document.querySelector('.canvas-item[data-item-id="item-a"]');
    const targetEl = document.querySelector('.canvas-item[data-item-id="item-b"]');
    expect(sourceEl).not.toBeNull();
    expect(targetEl).not.toBeNull();

    const dataTransfer = {
      types: [],
      data: {},
      dropEffect: 'move',
      effectAllowed: 'move',
      setData(format, value) {
        this.data[format] = value;
        if (!this.types.includes(format)) this.types.push(format);
      },
      getData(format) {
        return this.data[format] || '';
      },
      setDragImage() {},
    };

    const dragstart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragstart, 'dataTransfer', { value: dataTransfer });
    sourceEl.dispatchEvent(dragstart);

    const dragover = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragover, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(dragover, 'clientX', { value: 450 });
    Object.defineProperty(dragover, 'clientY', { value: 50 });
    targetEl.dispatchEvent(dragover);

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(drop, 'clientX', { value: 450 });
    Object.defineProperty(drop, 'clientY', { value: 50 });
    targetEl.dispatchEvent(drop);

    const dragend = new Event('dragend', { bubbles: true, cancelable: true });
    Object.defineProperty(dragend, 'dataTransfer', { value: dataTransfer });
    sourceEl.dispatchEvent(dragend);

    expect(createStackFromItemsMock).toHaveBeenCalledTimes(1);
    expect(createStackFromItemsMock).toHaveBeenCalledWith(['item-a', 'item-b'], expect.any(Number), expect.any(Number));

    resolveCreate?.({ id: 'stack-1', items: [] });
    await Promise.resolve();
    await Promise.resolve();
  });
});
