import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, setState, addDroppedImage, removeCanvasItemById, rebuildCanvasFromSession, forceSaveSessions, createStackFromItems } from '../store.js';

// 模拟 fetch 和 localStorage
global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

describe('多选删除持久化测试', () => {
  beforeEach(async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/api/images/test-image' }),
      text: async () => JSON.stringify({}),
    });

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

  it('创建 stack 时应保持画布顺序而不是选择顺序', async () => {
    const sessionId = 'stack-order-session';
    getState().sessions[sessionId] = { id: sessionId, stacks: [], droppedImages: [] };
    getState().currentSessionId = sessionId;

    const img1Url = await createTestImageDataUrl('#111111');
    const img2Url = await createTestImageDataUrl('#222222');
    const img3Url = await createTestImageDataUrl('#333333');
    const img1 = await addDroppedImage(img1Url);
    const img2 = await addDroppedImage(img2Url);
    const img3 = await addDroppedImage(img3Url);

    const result = await createStackFromItems([img3.itemId, img1.itemId, img2.itemId], 10, 20);

    expect(result).not.toBeNull();
    expect(result.items.map(item => item.x)).toEqual([50, 80, 110]);
  });

  it('创建 stack 时不应部分迁移已选图像', async () => {

    const sessionId = 'stack-session';
    getState().sessions[sessionId] = { id: sessionId, stacks: [], droppedImages: [] };
    getState().currentSessionId = sessionId;

    const img1Url = await createTestImageDataUrl('#aa0000');
    const img2Url = await createTestImageDataUrl('#00aa00');
    const img3Url = await createTestImageDataUrl('#0000aa');
    const img1 = await addDroppedImage(img1Url);
    const img2 = await addDroppedImage(img2Url);
    const img3 = await addDroppedImage(img3Url);

    const result = await createStackFromItems([img1.itemId, 'missing-item', img2.itemId, img3.itemId], 10, 20);

    expect(result).toBeNull();
    expect(getState().canvasItems.map(item => item.itemId)).toEqual([img1.itemId, img2.itemId, img3.itemId]);
    expect(getState().sessions[sessionId].stacks).toEqual([]);
    expect(getState().sessions[sessionId].droppedImages.map(item => item.id)).toHaveLength(3);
  });
});