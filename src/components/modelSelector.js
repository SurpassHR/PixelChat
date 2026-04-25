import { getState, setState, updateProviderModels } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { fetchModels as apiFetchModels } from '../api.js';

function selectModel(id) {
  setState({ selectedModelId: id });
  // Auto-detect provider from model data
  const { models } = getState();
  const model = models.find(m => m.id === id);
  if (model && model.provider) {
    setState({ selectedProvider: model.provider });
  } else if (model && model.owner) {
    setState({ selectedProvider: model.owner });
  }
  updateModelDisplay(id);
  setState({ statusText: `已选择: ${id}` });
}

export function groupModelsByProvider(models) {
  const groups = {};
  (models || []).forEach(m => {
    const provider = m.provider || m.owner || '其他';
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });
  Object.keys(groups).forEach(p => {
    groups[p].sort((a, b) => a.id.localeCompare(b.id));
  });
  return groups;
}

async function fetchModels() {
  const { providers } = getState();
  const providerNames = Object.keys(providers);

  if (providerNames.length === 0) {
    setState({ statusText: '请先在设置中添加提供商' });
    return;
  }

  setState({ statusText: '正在加载模型列表...' });
  let total = 0;

  for (const name of providerNames) {
    const { base_url, api_key } = providers[name];
    if (!base_url) {
      console.log(`[${name}] 跳过: 未配置 API 地址`);
      continue;
    }
    try {
      const models = await apiFetchModels({ base: base_url, key: api_key });
      updateProviderModels(name, models);
      total += models.length;
    } catch (e) {
      console.error(`[${name}] 模型加载失败:`, e.message);
    }
  }

  setState({ statusText: `模型列表已加载 (共 ${total} 个)` });

  // Auto-select if nothing selected or current model gone
  const { models, selectedModelId } = getState();
  if (models.length > 0) {
    if (!selectedModelId || !models.find(m => m.id === selectedModelId)) {
      const gemini = models.find(m => m.id.includes('gemini'));
      selectModel(gemini ? gemini.id : models[0].id);
    } else {
      const model = models.find(m => m.id === selectedModelId);
      if (model && model.provider) {
        setState({ selectedProvider: model.provider });
      }
      updateModelDisplay(selectedModelId);
    }
  }
}

function updateModelDisplay(id) {
  const display = $('#triggerModelDisplay');
  if (display) display.textContent = id || '未选择';
  const badge = $('#triggerBatchBadge');
  if (badge) {
    const { batchSize } = getState();
    badge.textContent = '×' + (batchSize || 1);
  }
  const val = $('#dropdownModelValue');
  if (val) val.textContent = id || '-';
}

export { selectModel, fetchModels, updateModelDisplay };

export function initModelSelector() {
  // Auto-fetch models from all configured providers on startup
  fetchModels();
}
