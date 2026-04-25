import { getState, setState, subscribe } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { fetchModels as apiFetchModels } from '../api.js';

// --- Model list rendering ---

function renderModelList(models) {
  const list = $('#modelList');
  if (models.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px;">无匹配模型</div>';
    return;
  }
  const { selectedModelId } = getState();
  list.innerHTML = models
    .map(m => {
      const active = m.id === selectedModelId ? 'active' : '';
      return `<div class="model-item ${active}" data-mid="${m.id}">
        <div class="id">${escapeHtml(m.id)}</div>
        ${m.owner ? `<div class="owner">${escapeHtml(m.owner)}</div>` : ''}
      </div>`;
    })
    .join('');
}

function selectModel(id) {
  setState({ selectedModelId: id });
  $$('#modelList .model-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mid === id);
  });
  updateCurrentDisplay(id);
  setState({ statusText: `已选择: ${id}` });
}

function filterModels() {
  const q = $('#modelFilter').value.toLowerCase().trim();
  const { models } = getState();
  const filtered = q ? models.filter(m => m.id.toLowerCase().includes(q)) : models;
  renderModelList(filtered);
  if (filtered.length === 1) selectModel(filtered[0].id);
}

async function fetchModels() {
  const base = $('#apiBase').value.replace(/\/+$/, '');
  const key = $('#apiKey').value;
  const list = $('#modelList');
  list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px;">加载中...</div>';
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
    list.innerHTML = `<div class="error-msg">获取失败: ${escapeHtml(e.message)}</div>`;
    setState({ statusText: '模型列表加载失败' });
  }
}

// --- Header display ---

function updateCurrentDisplay(id) {
  const el = $('#currentModelDisplay');
  if (el) el.textContent = id || '未选择';
}

// --- Modal ---

const overlay = $('#modelSelectOverlay');

function openModal() {
  overlay.style.display = 'flex';
  // Refresh the model list when opening
  const { models } = getState();
  if (models.length > 0) {
    renderModelList(models);
    $('#modelFilter').value = '';
  } else {
    fetchModels();
  }
}

function closeModal() {
  overlay.style.display = 'none';
}

// --- Init ---

export function initModelSelector() {
  // Header click
  $('#modelSelector').addEventListener('click', openModal);

  // Modal close
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
  $('#modelSelectCloseBtn').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
  });

  // Model list delegation
  $('#modelList').addEventListener('click', e => {
    const item = e.target.closest('.model-item');
    if (item) {
      selectModel(item.dataset.mid);
      closeModal();
    }
  });

  // Model filter
  $('#modelFilter').addEventListener('input', filterModels);

  // Refresh models
  $('#refreshModelsBtn').addEventListener('click', fetchModels);

  // Subscribe to model list changes
  subscribe('models', () => renderModelList(getState().models));

  // Initial fetch
  fetchModels();
}
