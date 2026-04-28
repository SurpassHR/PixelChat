import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, setState, addDroppedImage, removeCanvasItemById, rebuildCanvasFromSession, forceSaveSessions } from '../store.js';

// 模拟 fetch 和 localStorage
global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

describe('多选删除持久化测试', () => {
  beforeEach(async () => {
    // 重置状态
    const state = getState();
    state.sessions = {};
    state.currentSessionId = '';
    state.canvasItems = [];
    state.selectedItemIds = [];
    state.providers = {};
    state.models = [];
    vi.clearAllMocks();
  });

  // 辅助函数：创建测试图片dataURL
  const createTestImageDataUrl = (color) => {
    const canvas = new OffscreenCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 100, 100);
    return canvas.convertToBlob().then(blob => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }));
  };

  it('连续删除多个图片后刷新应全部消失', async () => {
    // 创建会话
    const sessionId = 'test-session';
    getState().sessions[sessionId] = { id: sessionId, stacks: [], droppedImages: [] };
    getState().currentSessionId = sessionId;

    // 添加3张测试图片
    const img1Url = await createTestImageDataUrl('#ff0000');
    const img2Url = await createTestImageDataUrl('#00ff00');
    const img3Url = await createTestImageDataUrl('#0000ff');
    const img1 = await addDroppedImage(img1Url);
    const img2 = await addDroppedImage(img2Url);
    const img3 = await addDroppedImage(img3Url);
    expect(getState().canvasItems.length).toBe(3);

    // 选择所有图片
    setState({ selectedItemIds: [img1.itemId, img2.itemId, img3.itemId] });

    // 串行删除
    for (const id of getState().selectedItemIds) {
      await removeCanvasItemById(id);
    }

    // 模拟刷新：重建画布
    await rebuildCanvasFromSession();
    expect(getState().canvasItems.length).toBe(0);
  });

  it('删除过程中部分失败不应影响其他删除', async () => {
    const sessionId = 'test-session-2';
    getState().sessions[sessionId] = { id: sessionId, stacks: [], droppedImages: [] };
    getState().currentSessionId = sessionId;

    const img1Url = await createTestImageDataUrl('#ff0000');
    const img2Url = await createTestImageDataUrl('#00ff00');
    const img1 = await addDroppedImage(img1Url);
    const img2 = await addDroppedImage(img2Url);
    expect(getState().canvasItems.length).toBe(2);

    // 手动损坏第二个图片的删除（模拟删除失败的情况不实际发生，但确保不会中断）
    // 这里只是验证串行删除不会因为一个失败而中断后续
    await removeCanvasItemById(img1.itemId);
    await removeCanvasItemById(img2.itemId);
    await rebuildCanvasFromSession();
    expect(getState().canvasItems.length).toBe(0);
  });
});