import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, rebuildCanvasFromSession, dissolveStack, removeFromStack } from '../store.js';

function createResponse(json = {}) {
  return {
    ok: true,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

describe('Stack 解散与自动解散一致性', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve(createResponse({})));
    global.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    const state = getState();
    state.sessions = {};
    state.currentSessionId = '';
    state.canvasItems = [];
    state.selectedItemIds = [];
    state.providers = {};
    state.models = [];
    vi.clearAllMocks();
  });

  it('dissolveStack 后应将所有子图逐一重建到 canvas 且保留关键元数据', async () => {
    const sessionId = 'dissolve-session';
    const state = getState();

    state.sessions[sessionId] = {
      id: sessionId,
      title: '测试会话',
      _canvasSeq: 2,
      messages: [],
      droppedImages: [],
      stacks: [
        {
          id: 'stack-1',
          x: 100,
          y: 120,
          width: 300,
          height: 300,
          items: [
            {
              imageUrl: '/api/images/1',
              prompt: 'first prompt',
              refImages: [{ name: 'ref-1', dataUrl: 'data:image/png;base64,aaa' }],
              width: 320,
              height: 280,
              status: 'ok',
              model: 'model-a',
              provider: 'provider-a',
              createdAt: 111,
              durationMs: 222,
              resolution: { width: 320, height: 280 },
            },
            {
              imageUrl: '/api/images/2',
              prompt: 'second prompt',
              refImages: [{ name: 'ref-2', dataUrl: 'data:image/png;base64,bbb' }],
              width: 340,
              height: 260,
              status: 'ok',
              model: 'model-b',
              provider: 'provider-b',
              createdAt: 333,
              durationMs: 444,
              resolution: { width: 340, height: 260 },
            },
          ],
        },
      ],
    };
    state.currentSessionId = sessionId;

    await rebuildCanvasFromSession();
    const ok = await dissolveStack('stack-1');

    expect(ok).toBe(true);
    expect(state.sessions[sessionId].stacks).toEqual([]);
    expect(state.sessions[sessionId].droppedImages).toHaveLength(2);
    expect(state.canvasItems.map(item => item.itemId)).toEqual(['drop-' + state.sessions[sessionId].droppedImages[0].id, 'drop-' + state.sessions[sessionId].droppedImages[1].id]);
    expect(state.canvasItems.map(item => item.prompt)).toEqual(['first prompt', 'second prompt']);
    expect(state.canvasItems.map(item => item.refImages)).toEqual([
      [{ name: 'ref-1', dataUrl: 'data:image/png;base64,aaa' }],
      [{ name: 'ref-2', dataUrl: 'data:image/png;base64,bbb' }],
    ]);
    expect(state.canvasItems.map(item => item.model)).toEqual(['model-a', 'model-b']);
    expect(state.canvasItems.map(item => item.provider)).toEqual(['provider-a', 'provider-b']);
    expect(state.canvasItems.map(item => item.durationMs)).toEqual([222, 444]);
  });

  it('重复执行 dissolveStack 不应失败也不应重复写入 droppedImages', async () => {
    const sessionId = 'dissolve-idempotent-session';
    const state = getState();

    state.sessions[sessionId] = {
      id: sessionId,
      title: '测试会话',
      _canvasSeq: 1,
      messages: [],
      droppedImages: [],
      stacks: [
        {
          id: 'stack-1',
          x: 10,
          y: 20,
          width: 300,
          height: 300,
          items: [
            { imageUrl: '/api/images/1', prompt: 'one', width: 300, height: 300, status: 'ok' },
            { imageUrl: '/api/images/2', prompt: 'two', width: 300, height: 300, status: 'ok' },
          ],
        },
      ],
    };
    state.currentSessionId = sessionId;

    await rebuildCanvasFromSession();

    const first = await dissolveStack('stack-1');
    const firstDroppedIds = state.sessions[sessionId].droppedImages.map(item => item.id);
    const second = await dissolveStack('stack-1');

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(state.sessions[sessionId].stacks).toEqual([]);
    expect(state.sessions[sessionId].droppedImages.map(item => item.id)).toEqual(firstDroppedIds);
    expect(state.sessions[sessionId].droppedImages).toHaveLength(2);
  });

  it('removeFromStack 导致自动解散后应留下两张独立图且不残留 stack', async () => {
    const sessionId = 'auto-dissolve-session';
    const state = getState();

    state.sessions[sessionId] = {
      id: sessionId,
      title: '测试会话',
      _canvasSeq: 2,
      messages: [],
      droppedImages: [],
      stacks: [
        {
          id: 'stack-1',
          x: 30,
          y: 40,
          width: 300,
          height: 300,
          items: [
            {
              imageUrl: '/api/images/1',
              prompt: 'first prompt',
              refImages: [{ name: 'ref-1', dataUrl: 'data:image/png;base64,aaa' }],
              width: 310,
              height: 290,
              status: 'ok',
              model: 'model-a',
              provider: 'provider-a',
              createdAt: 111,
              durationMs: 222,
              resolution: { width: 310, height: 290 },
            },
            {
              imageUrl: '/api/images/2',
              prompt: 'second prompt',
              refImages: [{ name: 'ref-2', dataUrl: 'data:image/png;base64,bbb' }],
              width: 330,
              height: 270,
              status: 'ok',
              model: 'model-b',
              provider: 'provider-b',
              createdAt: 333,
              durationMs: 444,
              resolution: { width: 330, height: 270 },
            },
          ],
        },
      ],
    };
    state.currentSessionId = sessionId;

    await rebuildCanvasFromSession();
    const ok = await removeFromStack('stack-1', 0, 300, 320);

    expect(ok).toBe(true);
    expect(state.sessions[sessionId].stacks).toEqual([]);
    expect(state.sessions[sessionId].droppedImages).toHaveLength(2);
    expect(state.canvasItems).toHaveLength(2);
    expect(state.canvasItems.every(item => item.type === 'image')).toBe(true);
    expect(state.canvasItems.map(item => item.prompt).sort()).toEqual(['first prompt', 'second prompt']);
    expect(state.canvasItems.map(item => item.refImages).sort((a, b) => a[0].name.localeCompare(b[0].name))).toEqual([
      [{ name: 'ref-1', dataUrl: 'data:image/png;base64,aaa' }],
      [{ name: 'ref-2', dataUrl: 'data:image/png;base64,bbb' }],
    ]);
  });
});
