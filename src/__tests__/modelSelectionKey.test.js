import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getState, updateProviderModels, setState, selectFamilyRatioResolution } from '../store.js';
import { selectModel } from '../components/modelSelector.js';

const promptAreaSource = readFileSync(resolve(__dirname, '../components/promptArea.js'), 'utf-8');
const commandPaletteSource = readFileSync(resolve(__dirname, '../components/commandPalette.js'), 'utf-8');
const settingsModalSource = readFileSync(resolve(__dirname, '../components/settingsModal.js'), 'utf-8');

global.fetch = vi.fn();
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

function resetState() {
  const state = getState();
  state.providers = {
    providerA: { base_url: 'https://provider-a.test/v1', api_key: '', models: [] },
    providerB: { base_url: 'https://provider-b.test/v1', api_key: '', models: [] },
  };
  state.models = [];
  state.selectedModelId = '';
  state.selectedProvider = '';
  state.selectedModelKey = '';
  state.selectedFamilyId = '';
  state.aspectRatio = '1:1';
  state.selectedResolution = '1K';
  updateProviderModels('providerA', [{ id: 'same-model' }]);
  updateProviderModels('providerB', [{ id: 'same-model' }]);
}

describe('同名模型选择唯一性', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('customModelList 应使用 provider + model id 复合 key 判断选中态，避免同名模型多选', () => {
    expect(promptAreaSource).toContain('selectedModelKey');
    expect(promptAreaSource).toContain('data-model-key');
    expect(promptAreaSource).not.toContain('model.id === selectedModelId');
  });

  it('所有模型选择入口都应使用复合 key 判断选中态', () => {
    expect(commandPaletteSource).toContain('selectedModelKey');
    expect(commandPaletteSource).toContain('data-model-key');
    expect(commandPaletteSource).not.toContain('m.id === selectedModelId');

    expect(settingsModalSource).toContain('selectedModelKey');
    expect(settingsModalSource).toContain('data-model-key');
    expect(settingsModalSource).not.toContain('btn.dataset.modelId === selectedId');
  });

  it('选择第二个 provider 的同名模型时应保留该 provider，而不是命中更靠上的同名模型', () => {
    selectModel('providerB::same-model');

    expect(getState().selectedModelId).toBe('same-model');
    expect(getState().selectedProvider).toBe('providerB');
    expect(getState().selectedModelKey).toBe('providerB::same-model');
  });

  it('生成任务提交应使用用户选中的 provider + model 组合', async () => {
    setState({
      selectedModelId: 'same-model',
      selectedProvider: 'providerB',
      selectedModelKey: 'providerB::same-model',
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-1' }),
    });

    const { submitTask } = await import('../store.js');
    await submitTask({ prompt: 'draw', model: getState().selectedModelId, provider: getState().selectedProvider, refs: [], aspectRatio: '1:1' });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('same-model');
    expect(body.provider).toBe('providerB');
  });

  it('刷新模型列表后应继续用复合 key 恢复第二个 provider 的同名模型', () => {
    setState({
      selectedModelId: 'same-model',
      selectedProvider: 'providerB',
      selectedModelKey: 'providerB::same-model',
    });

    updateProviderModels('providerA', [{ id: 'same-model' }]);
    updateProviderModels('providerB', [{ id: 'same-model' }]);
    selectModel(getState().selectedModelKey);

    expect(getState().selectedProvider).toBe('providerB');
    expect(getState().selectedModelKey).toBe('providerB::same-model');
  });

  it('切换比例映射到同名模型时应优先保留当前 provider', () => {
    getState().providers.providerA.models = [{ id: 'gpt-image-2', enabled: true }];
    getState().providers.providerB.models = [{ id: 'gpt-image-2', enabled: true }];
    updateProviderModels('providerA', [{ id: 'gpt-image-2' }]);
    updateProviderModels('providerB', [{ id: 'gpt-image-2' }]);
    setState({
      selectedModelId: 'gpt-image-2',
      selectedProvider: 'providerB',
      selectedModelKey: 'providerB::gpt-image-2',
    });

    const ok = selectFamilyRatioResolution('gpt-image', '16:9', '1K');

    expect(ok).toBe(true);
    expect(getState().selectedModelId).toBe('gpt-image-2');
    expect(getState().selectedProvider).toBe('providerB');
    expect(getState().selectedModelKey).toBe('providerB::gpt-image-2');
  });
});
