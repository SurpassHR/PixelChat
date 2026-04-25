import { getState, setState, subscribe, addProvider, removeProvider, updateProviderModels, toggleModelEnabled, updateProviderConfig } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { selectModel } from './modelSelector.js';
import { fetchModels as apiFetchModels } from '../api.js';

const overlay = $('#settingsModalOverlay');

const AVAILABLE_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, DALL-E 等图像生成模型', defaultBase: 'https://api.openai.com/v1', type: 'official' },
  { id: 'google', name: 'Google Gemini', description: 'Gemini 2.0 Flash 图像生成模型', defaultBase: 'https://generativelanguage.googleapis.com/v1beta/openai', type: 'official' },
  { id: 'custom', name: 'OpenAI Compat', description: '自定义 OpenAI 兼容 API，需要填写完整 base_url', defaultBase: '', type: 'custom' }
];

let _activeProvider = '';
let _addMode = 'grid'; // 'grid' | 'custom'
let _addSearchQuery = '';

// --- Settings modal ---

function closeSettingsModal() {
  overlay.style.display = 'none';
}

function openSettingsModal() {
  overlay.style.display = 'flex';
  const { providers } = getState();
  const names = Object.keys(providers);
  _activeProvider = names.includes(_activeProvider) ? _activeProvider : (names[0] || '');
  renderSidebar();
  showProviderConfig(_activeProvider);
}

// --- Sidebar ---

function renderSidebar() {
  const { providers } = getState();
  const names = Object.keys(providers).sort();
  const container = $('#settingsProviderItems');

  if (names.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px;">暂无供应商<br>点击上方 + 添加</div>';
    return;
  }

  let html = '';
  names.forEach(name => {
    const initial = name.charAt(0).toUpperCase();
    html += `<div class="settings-provider-item${name === _activeProvider ? ' active' : ''}" data-provider="${escapeHtml(name)}">
      <span class="p-icon">${escapeHtml(initial)}</span>
      <span class="p-name">${escapeHtml(name)}</span>
      <span class="p-badge">API</span>
    </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.settings-provider-item').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.provider;
      _activeProvider = name;
      renderSidebar();
      showProviderConfig(name);
    });
  });
}

// --- Config panel ---

function showProviderConfig(name) {
  const empty = $('#settingsEmpty');
  const config = $('#settingsConfig');
  const { providers } = getState();

  if (!name || !providers[name]) {
    empty.style.display = 'flex';
    config.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  config.style.display = 'block';

  const p = providers[name];

  $('#settingsProviderName').textContent = name;
  $('#settingsProviderIcon').textContent = name.charAt(0).toUpperCase();
  $('#settingsApiKey').value = p.api_key || '';
  $('#settingsBaseUrl').value = p.base_url || '';

  renderModelTable(name);
}

function renderModelTable(providerName) {
  const { providers } = getState();
  const models = (providers[providerName] && providers[providerName].models) || [];
  const tbody = $('#settingsModelList');
  const countEl = $('#settingsModelCount');

  countEl.textContent = models.length;

  if (models.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="settings-empty-row">暂无模型，请点击下方按钮获取</td></tr>';
    return;
  }

  let html = '';
  models.forEach(m => {
    html += `<tr>
      <td class="model-enabled">
        <label class="toggle-switch">
          <input type="checkbox" data-model-id="${escapeHtml(m.id)}" ${m.enabled !== false ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td class="model-name">${escapeHtml(m.id)}</td>
      <td class="model-action">
        <button class="settings-btn settings-btn-sm model-select-btn" data-model-id="${escapeHtml(m.id)}">选择</button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  tbody.querySelectorAll('.toggle-switch input').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleModelEnabled(providerName, cb.dataset.modelId);
    });
  });

  tbody.querySelectorAll('.model-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectModel(btn.dataset.modelId);
      syncSelectBtnStates(tbody, btn.dataset.modelId);
      setState({ statusText: `已选择模型: ${btn.dataset.modelId}` });
    });
  });

  const { selectedModelId } = getState();
  syncSelectBtnStates(tbody, selectedModelId);
}

function syncSelectBtnStates(tbody, selectedId) {
  tbody.querySelectorAll('.model-select-btn').forEach(btn => {
    if (btn.dataset.modelId === selectedId) {
      btn.textContent = '✓ 已选';
      btn.style.borderColor = 'var(--accent-dim)';
      btn.style.color = 'var(--accent)';
      btn.style.background = 'rgba(74,111,165,0.15)';
    } else {
      btn.textContent = '选择';
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.style.background = '';
    }
  });
}

// --- Add Provider Modal ---

function openAddModal() {
  const apOverlay = $('#addProviderOverlay');
  _addMode = 'grid';
  _addSearchQuery = '';
  $('#apSearch').value = '';
  $('#apBody').style.display = '';
  $('#apCustom').style.display = 'none';
  renderProviderGrid();
  apOverlay.style.display = 'flex';
}

function closeAddModal() {
  $('#addProviderOverlay').style.display = 'none';
}

function renderProviderGrid() {
  const container = $('#apGrid');
  const query = _addSearchQuery.toLowerCase();
  const filtered = AVAILABLE_PROVIDERS.filter(p =>
    p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="ap-empty">
      <div class="ap-empty-icon">⚙</div>
      <div>未找到相关供应商</div>
    </div>`;
    return;
  }

  let html = '';
  filtered.forEach(p => {
    const colors = { openai: '#00a67e', google: '#4285f4', custom: '#9ca3af' };
    const color = colors[p.id] || 'var(--accent-dim)';
    html += `<div class="ap-card" data-provider-id="${escapeHtml(p.id)}">
      <div class="ap-card-icon" style="color:${color}">${escapeHtml(p.name.charAt(0))}</div>
      <div class="ap-card-body">
        <div class="ap-card-name">${escapeHtml(p.name)}</div>
        <div class="ap-card-desc">${escapeHtml(p.description)}</div>
      </div>
      <span class="ap-card-arrow">→</span>
    </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.ap-card').forEach(el => {
    el.addEventListener('click', () => {
      handlePresetSelect(el.dataset.providerId);
    });
  });
}

function handlePresetSelect(id) {
  const preset = AVAILABLE_PROVIDERS.find(p => p.id === id);
  if (!preset) return;

  // For custom provider, open the custom form instead of adding directly
  if (preset.id === 'custom') {
    switchToCustom();
    return;
  }

  const { providers } = getState();
  const name = preset.name;
  if (providers[name]) {
    setState({ statusText: `供应商 "${name}" 已存在` });
    closeAddModal();
    _activeProvider = name;
    renderSidebar();
    showProviderConfig(name);
    return;
  }

  addProvider(name, preset.defaultBase, '');
  setState({ statusText: `已添加供应商: ${name}` });

  closeAddModal();
  _activeProvider = name;
  renderSidebar();
  showProviderConfig(name);

  // Auto-fetch models
  fetchAndRenderModels(name);
}

function switchToCustom() {
  _addMode = 'custom';
  $('#apBody').style.display = 'none';
  $('#apCustom').style.display = '';
  $('#apCustomName').value = '';
  $('#apCustomKey').value = '';
  $('#apCustomName').focus();
}

function switchBackToGrid() {
  _addMode = 'grid';
  $('#apBody').style.display = '';
  $('#apCustom').style.display = 'none';
}

function handleCustomSubmit() {
  const name = $('#apCustomName').value.trim();
  const base_url = $('#apCustomBase').value.trim();
  const api_key = $('#apCustomKey').value.trim();

  if (!name) { setState({ statusText: '请填写供应商名称' }); return; }
  if (!base_url) { setState({ statusText: '请填写 API 地址' }); return; }

  const ok = addProvider(name, base_url, api_key);
  if (!ok) {
    setState({ statusText: `供应商 "${name}" 已存在` });
    return;
  }

  setState({ statusText: `已添加供应商: ${name}` });
  closeAddModal();
  _activeProvider = name;
  renderSidebar();
  showProviderConfig(name);

  fetchAndRenderModels(name);
}

// --- Fetch models ---

async function fetchAndRenderModels(name) {
  const { providers } = getState();
  const provider = providers[name];
  if (!provider || !provider.base_url) {
    setState({ statusText: `${name}: 未配置 API 地址` });
    return;
  }

  const btn = $('#settingsFetchModels');
  if (btn) { btn.textContent = '获取中...'; btn.disabled = true; }

  try {
    const models = await apiFetchModels({ base: provider.base_url, key: provider.api_key });
    updateProviderModels(name, models);
    renderModelTable(name);
    setState({ statusText: `${name}: 已加载 ${models.length} 个模型` });
  } catch (e) {
    setState({ statusText: `${name}: 模型加载失败 - ${e.message}` });
  } finally {
    if (btn) { btn.textContent = '↻ 获取模型'; btn.disabled = false; }
  }
}

// --- Delete provider ---

function deleteActiveProvider() {
  if (!_activeProvider) return;
  if (!confirm(`确定要删除供应商 "${_activeProvider}"？`)) return;

  const name = _activeProvider;
  removeProvider(name);
  const { providers } = getState();
  const names = Object.keys(providers);
  _activeProvider = names.length > 0 ? names[0] : '';
  renderSidebar();
  showProviderConfig(_activeProvider);
  setState({ statusText: `已删除供应商: ${name}` });
}

// --- Test connection ---

async function testConnection() {
  const testBtn = $('#settingsTestBtn');
  const testText = $('#settingsTestText');
  if (!_activeProvider) return;

  const { providers } = getState();
  const p = providers[_activeProvider];
  if (!p || !p.base_url) {
    setState({ statusText: '请先配置 API 地址' });
    return;
  }

  testText.textContent = '测试中...';
  testBtn.disabled = true;

  try {
    const models = await apiFetchModels({ base: p.base_url, key: p.api_key || '' });
    testText.textContent = '✓ 连接成功';
    testBtn.style.borderColor = '#4caf50';
    testBtn.style.color = '#4caf50';
    setState({ statusText: `${_activeProvider}: 连接成功 (${models.length} 个模型)` });
    setTimeout(() => {
      testBtn.style.borderColor = '';
      testBtn.style.color = '';
      testText.textContent = '测试连接';
      testBtn.disabled = false;
    }, 2000);
  } catch (e) {
    testText.textContent = '✗ 连接失败';
    testBtn.style.borderColor = 'var(--danger)';
    testBtn.style.color = 'var(--danger)';
    setState({ statusText: `${_activeProvider}: 连接失败 - ${e.message}` });
    setTimeout(() => {
      testBtn.style.borderColor = '';
      testBtn.style.color = '';
      testText.textContent = '测试连接';
      testBtn.disabled = false;
    }, 2000);
  }
}

// --- Auto-save provider config ---

let _saveTimer = null;

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!_activeProvider) return;
    const api_key = $('#settingsApiKey').value.trim();
    const base_url = $('#settingsBaseUrl').value.trim();
    updateProviderConfig(_activeProvider, { api_key, base_url });
    setState({ statusText: `${_activeProvider}: 配置已保存` });
  }, 500);
}

// --- Init ---

export function initSettingsModal() {
  // Open settings
  $('#settingsBtn').addEventListener('click', openSettingsModal);

  // Close settings
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSettingsModal();
  });
  $('#settingsModalCloseBtn').addEventListener('click', closeSettingsModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeSettingsModal();
  });

  // Sidebar add button → open modal
  $('#settingsSidebarAdd').addEventListener('click', openAddModal);

  // Add-provider modal events
  $('#addProviderOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddModal();
  });
  $('#apCloseBtn').addEventListener('click', closeAddModal);
  $('#apCancelBtn').addEventListener('click', closeAddModal);
  $('#apCustomBack').addEventListener('click', switchBackToGrid);
  $('#apCustomSubmit').addEventListener('click', handleCustomSubmit);
  $('#apCustomName').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCustomSubmit();
  });

  // Search
  $('#apSearch').addEventListener('input', () => {
    _addSearchQuery = $('#apSearch').value;
    renderProviderGrid();
  });

  // Delete provider
  $('#settingsDeleteBtn').addEventListener('click', deleteActiveProvider);

  // Test connection
  $('#settingsTestBtn').addEventListener('click', testConnection);

  // Fetch models
  $('#settingsFetchModels').addEventListener('click', () => {
    if (_activeProvider) fetchAndRenderModels(_activeProvider);
  });

  // Auto-save on input
  $('#settingsApiKey').addEventListener('input', scheduleSave);
  $('#settingsBaseUrl').addEventListener('input', scheduleSave);

  // Re-render when external data changes
  subscribe('providers', () => {
    if (overlay.style.display !== 'none') {
      renderSidebar();
      if (_activeProvider) showProviderConfig(_activeProvider);
    }
  });

  subscribe('models', () => {
    if (overlay.style.display !== 'none') {
      renderSidebar();
      if (_activeProvider) showProviderConfig(_activeProvider);
    }
  });

  subscribe('selectedModelId', () => {
    if (overlay.style.display !== 'none' && _activeProvider) {
      const tbody = $('#settingsModelList');
      const { selectedModelId } = getState();
      syncSelectBtnStates(tbody, selectedModelId);
    }
  });
}
