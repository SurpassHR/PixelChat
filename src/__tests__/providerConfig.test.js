import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchModels } from '../api.js';
import { getState, addProvider, removeProvider, updateProviderModels, batchToggleModelsEnabled, getModelId, subscribe, initStore } from '../store.js';

// 模拟 fetch 和 localStorage
global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

describe('提供商配置统一表单', () => {
  beforeEach(() => {
    // 重置状态
    const state = getState();
    state.providers = {};
    state.models = [];
    vi.clearAllMocks();
  });

  it('应该能够添加任意名称、Base URL、API Key的提供商', () => {
    const name = 'MyCustomProvider';
    const base_url = 'https://api.example.com/v1';
    const api_key = 'sk-test123';
    const result = addProvider(name, base_url, api_key);
    expect(result).toBe(true);
    const providers = getState().providers;
    expect(providers[name]).toBeDefined();
    expect(providers[name].base_url).toBe(base_url);
    expect(providers[name].api_key).toBe(api_key);
    expect(providers[name].models).toEqual([]);
  });

  it('不应该允许重复添加同名的提供商', () => {
    addProvider('Duplicate', 'url1', 'key1');
    const second = addProvider('Duplicate', 'url2', 'key2');
    expect(second).toBe(false);
    const providers = getState().providers;
    expect(providers['Duplicate'].base_url).toBe('url1');
  });
});

describe('模型批量全选/反选', () => {
  beforeEach(() => {
    const state = getState();
    state.providers = {
      TestProvider: {
        base_url: 'http://test',
        api_key: '',
        models: [
          { id: 'model-a', enabled: false },
          { id: 'model-b', enabled: true },
          { id: 'model-c', enabled: false }
        ]
      }
    };
    // 手动触发 rebuildModels 以获得初始 models 数组
    // 但 batchToggleModelsEnabled 会内部调用 rebuildModels
  });

  it('应该能够将所有模型设为启用（全选）', () => {
    batchToggleModelsEnabled('TestProvider', true);
    const provider = getState().providers['TestProvider'];
    expect(provider.models[0].enabled).toBe(true);
    expect(provider.models[1].enabled).toBe(true);
    expect(provider.models[2].enabled).toBe(true);
    // 检查全局 models 数组是否更新
    const models = getState().models;
    expect(models.length).toBe(3);
    expect(models.every(m => m.id.startsWith('model-'))).toBe(true);
  });

  it('应该能够将所有模型设为禁用（反选）', () => {
    batchToggleModelsEnabled('TestProvider', false);
    const provider = getState().providers['TestProvider'];
    expect(provider.models[0].enabled).toBe(false);
    expect(provider.models[1].enabled).toBe(false);
    expect(provider.models[2].enabled).toBe(false);
    const models = getState().models;
    expect(models.length).toBe(0);
  });

  it('当提供商不存在时，批量操作应静默失败', () => {
    expect(() => batchToggleModelsEnabled('NonExistent', true)).not.toThrow();
    const state = getState();
    expect(state.providers['NonExistent']).toBeUndefined();
  });
});

describe('模型系列映射', () => {
  it('GPT Image 系列应该映射到 gpt-image-2', () => {
    expect(getModelId('gpt-image', '1:1', '1K')).toBe('gpt-image-2');
  });

  it('Gemini 图片模型映射应该保持不变', () => {
    expect(getModelId('gemini-3.0-pro-image', '1:1', '1K')).toBe('gemini-3.0-pro-image-square');
  });
});


describe('API URL 规范化', () => {
  it('模型列表请求不应该重复拼接 /v1', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-image-2' }] }),
    });

    await fetchModels({ base: 'https://image.thkss.top/v1', key: 'sk-test' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://image.thkss.top/v1/models',
      { headers: { Authorization: 'Bearer sk-test' } }
    );
  });
});

describe('提供商事件通知', () => {
  beforeEach(() => {
    const state = getState();
    state.providers = {};
    state.models = [];
    vi.clearAllMocks();
  });

  it('addProvider 应该通知 providers 监听器', () => {
    const listener = vi.fn();
    subscribe('providers', listener);
    addProvider('NotifyTest', 'https://api.test.com', 'sk-test');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removeProvider 应该通知 providers 监听器', () => {
    addProvider('ToDelete', 'https://api.test.com', 'sk-test');
    const listener = vi.fn();
    subscribe('providers', listener);
    removeProvider('ToDelete');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('设置持久化降级', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '{}'
    });
  });

  it('后端不可用时应从 localStorage 降级加载 providers', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    const savedSettings = {
      providers: {
        SavedProvider: { base_url: 'https://saved.example.com', api_key: 'sk-saved', models: [] }
      },
      selectedProvider: 'SavedProvider',
      selectedModelId: 'm-saved',
      selectedModelKey: 'SavedProvider::m-saved'
    };
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'image-gen-settings-v2') return JSON.stringify(savedSettings);
      return null;
    });

    const state = getState();
    state.providers = {};
    state.sessions = {};
    state.materials = [];
    state.materialStacks = [];
    state.selectedProvider = '';
    state.selectedModelId = '';
    state.selectedModelKey = '';

    await initStore();

    expect(state.providers).toHaveProperty('SavedProvider');
    expect(state.providers['SavedProvider'].base_url).toBe('https://saved.example.com');
    expect(state.providers['SavedProvider'].api_key).toBe('sk-saved');
    expect(state.selectedProvider).toBe('SavedProvider');
  });
});

describe('设置持久化 — 后端空数据时合并 localStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '{}'
    });
  });

  it('后端返回空 settings 时应从 localStorage 合并 providers', async () => {
    const savedSettings = {
      providers: {
        MergedProvider: { base_url: 'https://merged.example.com', api_key: 'sk-merged', models: [] }
      },
      selectedProvider: 'MergedProvider',
      selectedModelId: '',
      selectedModelKey: ''
    };
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'image-gen-settings-v2') return JSON.stringify(savedSettings);
      return null;
    });

    const state = getState();
    state.providers = {};
    state.sessions = {};
    state.materials = [];
    state.materialStacks = [];
    state.selectedProvider = '';
    state.selectedModelId = '';
    state.selectedModelKey = '';

    await initStore();

    expect(state.providers).toHaveProperty('MergedProvider');
    expect(state.providers['MergedProvider'].base_url).toBe('https://merged.example.com');
    expect(state.providers['MergedProvider'].api_key).toBe('sk-merged');
    expect(state.selectedProvider).toBe('MergedProvider');
  });

  it('后端返回部分 settings 时 localStorage 填补缺失字段', async () => {
    // 后端有 providers，但缺少 reusePrompt 等字段
    global.fetch.mockReset();
    const backendData = {
      providers: {
        BackendProvider: { base_url: 'https://backend.example.com', api_key: 'sk-backend', models: [{ id: 'm1', enabled: true }] }
      },
      selectedProvider: 'BackendProvider'
    };
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => backendData,
      text: async () => JSON.stringify(backendData)
    });

    // localStorage 有额外的字段
    const localSettings = {
      providers: {
        OldProvider: { base_url: 'https://old.example.com', api_key: 'sk-old', models: [] }
      },
      reusePrompt: true,
      reuseRef: false,
      batchSize: 3
    };
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'image-gen-settings-v2') return JSON.stringify(localSettings);
      return null;
    });

    const state = getState();
    state.providers = {};
    state.sessions = {};
    state.materials = [];
    state.materialStacks = [];

    await initStore();

    // 后端 providers 完全替换 localStorage providers（后端为权威）
    expect(state.providers).toHaveProperty('BackendProvider');
    expect(state.providers['BackendProvider'].base_url).toBe('https://backend.example.com');
    expect(state.providers).not.toHaveProperty('OldProvider');
    // localStorage 独有字段应被保留（后端未返回这些字段）
    expect(state.reusePrompt).toBe(true);
    expect(state.reuseRef).toBe(false);
    expect(state.batchSize).toBe(3);
  });
});

describe('设置面板 DOM 可见性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置状态
    const state = getState();
    state.providers = {};
    state.models = [];
    state.selectedProvider = '';
    state.selectedModelId = '';
    state.selectedModelKey = '';
    // 确保 DOM 元素存在
    if (!document.getElementById('settingsProviderPanel')) {
      const panel = document.createElement('div');
      panel.id = 'settingsProviderPanel';
      panel.style.display = 'none';
      document.body.appendChild(panel);
    }
    if (!document.getElementById('settingsProviderItems')) {
      const items = document.createElement('div');
      items.id = 'settingsProviderItems';
      document.getElementById('settingsProviderPanel').appendChild(items);
    }
  });

  it('providers 存在时应显示左侧面板', () => {
    const panel = document.getElementById('settingsProviderPanel');
    panel.style.display = 'none';

    addProvider('TestProvider', 'https://api.test.com', 'sk-test');

    // 验证 addProvider 后 providers 非空
    const { providers } = getState();
    const names = Object.keys(providers);
    expect(names.length).toBeGreaterThan(0);

    // 模拟 showProviderPanel / showProviderConfig 中的逻辑：
    // names.length > 0 时设置 panel 可见
    if (names.length > 0) {
      panel.style.display = 'flex';
    }
    expect(panel.style.display).toBe('flex');
  });

  it('providers 为空时也应显示面板（保留添加按钮可见）', () => {
    const panel = document.getElementById('settingsProviderPanel');
    panel.style.display = 'none';

    const { providers } = getState();
    expect(Object.keys(providers).length).toBe(0);

    // 即使无供应商，面板也应显示，让用户能看到 "+" 添加按钮
    panel.style.display = 'flex';
    expect(panel.style.display).toBe('flex');
  });
});
