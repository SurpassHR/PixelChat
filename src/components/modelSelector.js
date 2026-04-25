import { getState, setState } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { fetchModels as apiFetchModels } from '../api.js';

function selectModel(id) {
  setState({ selectedModelId: id });
  updateCurrentDisplay(id);
  setState({ statusText: `已选择: ${id}` });
}

async function fetchModels() {
  const base = $('#apiBase').value.replace(/\/+$/, '');
  const key = $('#apiKey').value;
  setState({ statusText: '正在加载模型列表...' });
  try {
    const models = await apiFetchModels({ base, key });
    setState({ models, statusText: '模型列表已加载' });
    if (models.length > 0) {
      const { selectedModelId } = getState();
      if (!selectedModelId || !models.find(m => m.id === selectedModelId)) {
        const gemini = models.find(m => m.id.includes('gemini'));
        selectModel(gemini ? gemini.id : models[0].id);
      } else {
        updateCurrentDisplay(selectedModelId);
      }
    }
  } catch (e) {
    setState({ statusText: '模型列表加载失败' });
  }
}

function updateCurrentDisplay(id) {
  const el = $('#currentModelDisplay');
  if (el) el.textContent = id || '未选择';
}

export { selectModel, fetchModels, updateCurrentDisplay };

export function initModelSelector() {
  // Header click — will be handled via command palette open in model mode
  // (the command palette reads model data from store directly)

  // Initial fetch
  fetchModels();
}
