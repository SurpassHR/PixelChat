import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, rebuildCanvasFromSession, createStackFromItems } from '../store.js';

global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

describe('创建 Stack 来源删除顺序', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => JSON.stringify({}),
    });

    const state = getState();
    state.sessions = {};
    state.currentSessionId = '';
    state.canvasItems = [];
    state.selectedItemIds = [];
    state.providers = {};
    state.models = [];
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it('同一次从多个 message 图像创建 stack 后不应残留原 assistant 图片', async () => {
    const sessionId = 'stack-create-session';
    const state = getState();

    state.sessions[sessionId] = {
      id: sessionId,
      title: '测试会话',
      _canvasSeq: 2,
      messages: [
        { role: 'user', prompt: 'prompt-1', refImages: [] },
        { role: 'assistant', status: 'ok', imageUrl: '/api/images/1', x: 10, y: 20, width: 300, height: 300, canvasSeq: 1 },
        { role: 'user', prompt: 'prompt-2', refImages: [] },
        { role: 'assistant', status: 'ok', imageUrl: '/api/images/2', x: 30, y: 40, width: 300, height: 300, canvasSeq: 2 },
      ],
      droppedImages: [],
      stacks: [],
    };
    state.currentSessionId = sessionId;

    await rebuildCanvasFromSession();

    const sourceIds = state.canvasItems
      .filter(item => item.type === 'image')
      .map(item => item.itemId);

    expect(sourceIds).toEqual(['item-1', 'item-3']);

    await createStackFromItems(sourceIds, 100, 120);

    expect(state.sessions[sessionId].messages ?? []).toHaveLength(0);
    expect(state.sessions[sessionId].stacks).toHaveLength(1);
    expect(state.sessions[sessionId].stacks[0].items).toHaveLength(2);
    expect(state.canvasItems.map(item => item.type)).toEqual(['stack']);
  });

  it('createStackFromItems 返回前应已发起 sessions 持久化', async () => {
    const sessionId = 'stack-save-session';
    const state = getState();

    state.sessions[sessionId] = {
      id: sessionId,
      title: '测试会话',
      _canvasSeq: 1,
      messages: [
        { role: 'user', prompt: 'prompt-1', refImages: [] },
        { role: 'assistant', status: 'ok', imageUrl: '/api/images/1', x: 10, y: 20, width: 300, height: 300, canvasSeq: 1 },
      ],
      droppedImages: [],
      stacks: [],
    };
    state.currentSessionId = sessionId;

    await rebuildCanvasFromSession();

    await createStackFromItems(['item-1'], 100, 120);

    const sessionSaveCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/sessions'));
    expect(sessionSaveCalls).toHaveLength(1);
  });
});
