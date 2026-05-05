import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sessionId = 'session-1';
const pendingTask = {
  taskId: 'task-missing',
  prompt: '等待恢复的图片',
  refImages: [],
  startTime: 1,
  model: 'gpt-image-2',
  provider: 'custom'
};

function createResponse({ text, json }) {
  return {
    ok: true,
    text: async () => text ?? JSON.stringify(json ?? {}),
    json: async () => json ?? JSON.parse(text ?? '{}')
  };
}

describe('initStore 图片恢复完整性', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    global.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('当后端本次返回的任务列表未覆盖当前 pendingTask 时，不应在初始化时删除该占位符', async () => {
    const listedTasks = Array.from({ length: 50 }, (_, index) => ({
      id: `other-${index}`,
      status: 'completed',
      prompt: `other-${index}`,
      model: 'gpt-image-2',
      provider: 'custom',
      refs: [],
      image_url: `/api/images/${index}`,
      error: '',
      thinking: '',
      retry_count: 0,
      created_at: 1000 - index,
      updated_at: 1000 - index,
    }));

    global.fetch = vi.fn(async (url, options = {}) => {
      const target = String(url);
      const method = options.method || 'GET';

      if (target.endsWith('/api/sessions') && method === 'GET') {
        return createResponse({
          text: JSON.stringify({
            [sessionId]: {
              id: sessionId,
              title: '待恢复会话',
              messages: [],
              droppedImages: [],
              stacks: [],
              pendingTasks: [pendingTask]
            }
          })
        });
      }

      if (target.endsWith('/api/materials')) {
        return createResponse({ text: JSON.stringify({ materials: [], materialStacks: [] }) });
      }

      if (target.endsWith('/api/settings')) {
        return createResponse({ text: JSON.stringify({}) });
      }

      if (target.endsWith('/api/active')) {
        return createResponse({ text: JSON.stringify(sessionId) });
      }

      if (target.endsWith('/api/tasks')) {
        if (method === 'GET') {
          return createResponse({ json: listedTasks });
        }
        if (method === 'POST') {
          return createResponse({ json: { ok: true } });
        }
      }

      if (target.endsWith('/api/sessions') && method === 'POST') {
        return createResponse({ json: { ok: true } });
      }

      throw new Error(`Unexpected fetch: ${method} ${target}`);
    });

    const { initStore, getState } = await import('../store.js');

    await initStore();

    expect(getState().sessions[sessionId].pendingTasks).toHaveLength(1);
    expect(getState().sessions[sessionId].pendingTasks[0].taskId).toBe('task-missing');
    expect(getState().canvasItems).toHaveLength(1);
    expect(getState().canvasItems[0]).toMatchObject({
      taskId: 'task-missing',
      generating: true,
      prompt: '等待恢复的图片'
    });
  });
});
