import { getState, setState, updateProviderModels, MODEL_FAMILIES, getModelId, selectFamilyRatioResolution as _selectFamilyRatioResolution } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { fetchModels as apiFetchModels } from '../api.js';

function selectModel(id) {
  setState({ selectedModelId: id });
  const { models } = getState();
  const model = models.find(m => m.id === id);
  if (model && model.provider) {
    setState({ selectedProvider: model.provider });
  } else if (model && model.owner) {
    setState({ selectedProvider: model.owner });
  }
  updateModelDisplay();
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
  const { models, selectedModelId, selectedFamilyId, aspectRatio, selectedResolution } = getState();
  if (models.length > 0) {
    if (!selectedModelId || !models.find(m => m.id === selectedModelId)) {
      // 优先通过级联选择重新匹配
      if (selectedFamilyId && aspectRatio && selectedResolution) {
        const modelId = getModelId(selectedFamilyId, aspectRatio, selectedResolution);
        if (modelId && models.find(m => m.id === modelId)) {
          _selectFamilyRatioResolution(selectedFamilyId, aspectRatio, selectedResolution);
        } else {
          const gemini = models.find(m => m.id.includes('gemini'));
          selectModel(gemini ? gemini.id : models[0].id);
        }
      } else {
        const gemini = models.find(m => m.id.includes('gemini'));
        selectModel(gemini ? gemini.id : models[0].id);
      }
    } else {
      const model = models.find(m => m.id === selectedModelId);
      if (model && model.provider) {
        setState({ selectedProvider: model.provider });
      }
      updateModelDisplay();
    }
  }
}

function updateModelDisplay() {
  const { batchSize, aspectRatio, selectedFamilyId, selectedResolution } = getState();
  const family = selectedFamilyId ? MODEL_FAMILIES.find(f => f.id === selectedFamilyId) : null;
  const familyLabel = family ? family.label : (selectedFamilyId || '');

  // 胶囊栏中的模型标签 — 显示 系列名
  const tagName = $('#modelTagName');
  if (tagName) tagName.textContent = familyLabel || '未选择';

  // 弹出面板中的模型名（已移除，兼容处理）
  const popoverName = $('#popoverModelName');
  if (popoverName) popoverName.textContent = familyLabel || '未选择';

  // 倍数显示
  const tagMult = $('#modelTagMult');
  if (tagMult) tagMult.textContent = '×' + (batchSize || 1);

  // 比例显示
  const tagRatio = $('#modelTagRatio');
  if (tagRatio) tagRatio.textContent = aspectRatio || '1:1';

  // 兼容旧元素（如果还存在）
  const legacyDisplay = $('#triggerModelDisplay');
  if (legacyDisplay) legacyDisplay.textContent = familyLabel || '未选择';
  const legacyBadge = $('#triggerBatchBadge');
  if (legacyBadge) legacyBadge.textContent = '×' + (batchSize || 1);
  const legacyVal = $('#dropdownModelValue');
  if (legacyVal) legacyVal.textContent = selectedResolution || aspectRatio || '-';
}

export function selectFamilyRatioResolution(familyId, ratio, resolution) {
  return _selectFamilyRatioResolution(familyId, ratio, resolution);
}

export { selectModel, fetchModels, updateModelDisplay };

export function initModelSelector() {
  fetchModels();
}
