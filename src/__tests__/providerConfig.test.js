import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchModels } from '../api.js';
import { getState, addProvider, updateProviderModels, batchToggleModelsEnabled, getModelId } from '../store.js';

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
