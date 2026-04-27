import { generateId } from './domHelpers.js';

const state = {
  sessions: {},
  currentSessionId: '',
  canvasItems: [],
  selectedItemIds: [],
  selectedMaterialIds: [],
  refImages: [],
  reusePrompt: false,
  reuseRef: false,
  models: [],
  selectedModelId: '',
  selectedProvider: '',
  providers: {},
  materials: [],               // 平面素材列表，每个素材包含 id, name, dataUrl, dataHash, addedAt, category, type
  materialStacks: [],          // 堆叠组列表，每个组包含 id, name, category, children (素材 id 数组), thumbnail
  viewport: { panX: 0, panY: 0, zoom: 1 },
  statusText: '就绪',
  generating: false,
  batchSize: 1,
  aspectRatio: '1:1',
  selectedFamilyId: '',
  selectedResolution: '1K'
};

// --------------------------------------------------------------
// 模型系列映射表
// --------------------------------------------------------------
const RATIO_SLUG = { '1:1':'square', '3:4':'three-four', '4:3':'four-three', '9:16':'portrait', '16:9':'landscape' };

export const MODEL_FAMILIES = [
  {
    id: 'gemini-3.0-pro-image', label: 'Gemini 3.0 Pro',
    ratios: { '1:1':['1K','2K','4K'], '3:4':['1K','2K','4K'], '4:3':['1K','2K','4K'], '9:16':['1K','2K','4K'], '16:9':['1K','2K','4K'] },
    buildModelId(ratio, res) {
      const slug = RATIO_SLUG[ratio]; if (!slug) return '';
      const suffix = res === '1K' ? '' : `-${res.toLowerCase()}`;
      return `${this.id}-${slug}${suffix}`;
    }
  },
  {
    id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash',
    ratios: { '1:1':['1K','2K','4K'], '3:4':['1K','2K','4K'], '4:3':['1K','2K','4K'], '9:16':['1K','2K','4K'], '16:9':['1K','2K','4K'] },
    buildModelId(ratio, res) {
      const slug = RATIO_SLUG[ratio]; if (!slug) return '';
      const suffix = res === '1K' ? '' : `-${res.toLowerCase()}`;
      return `${this.id}-${slug}${suffix}`;
    }
  },
  {
    id: 'imagen-4.0', label: 'Imagen 4.0',
    ratios: { '9:16':['Preview'], '16:9':['Preview'] },
    buildModelId(ratio) {
      if (ratio === '9:16') return 'imagen-4.0-generate-preview-portrait';
      if (ratio === '16:9') return 'imagen-4.0-generate-preview-landscape';
      return '';
    }
  }
];

export function getModelId(familyId, ratio, resolution) {
  const family = MODEL_FAMILIES.find(f => f.id === familyId);
  if (!family) return '';
  const resList = family.ratios[ratio];
  if (!resList || !resList.includes(resolution)) return '';
  return family.buildModelId(ratio, resolution);
}

export function getAvailableFamilies() {
  const { models } = state;
  if (!models.length) return MODEL_FAMILIES;
  return MODEL_FAMILIES.filter(f => {
    return Object.entries(f.ratios).some(([ratio, resolutions]) => {
      return resolutions.some(res => {
        const mid = f.buildModelId(ratio, res);
        return models.some(m => m.id === mid);
      });
    });
  });
}

export function selectFamilyRatioResolution(familyId, ratio, resolution) {
  const modelId = getModelId(familyId, ratio, resolution);
  if (!modelId) return false;
  setState({
    selectedFamilyId: familyId,
    aspectRatio: ratio,
    selectedResolution: resolution,
    selectedModelId: modelId
  });
  // Auto-detect provider from available models
  const { models } = state;
  const model = models.find(m => m.id === modelId);
  if (model && model.provider) {
    setState({ selectedProvider: model.provider });
  }
  return true;
}

// --------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------
function sanitizeForSave(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && value.startsWith('blob:')) {
      continue;
    }
    clone[key] = typeof value === 'object' && value !== null ? sanitizeForSave(value) : value;
  }
  return clone;
}

function resolveBackendUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (/^https?:\/\//i.test(url)) return sanitizeImageUrl(url);
  if (url.startsWith('/')) return getStorageBase() + sanitizeImageUrl(url);
  return url;
}

export async function resolveIdbUrl(url) {
  return resolveBackendUrl(url);
}

function _cleanupResolvedUrls() { }

const listeners = {};
const _abortControllers = {};

export function getState() { return state; }

export function registerAbort(placeholderId, controller) {
  _abortControllers[placeholderId] = controller;
}

export function cancelGeneration(placeholderId) {
  const ctrl = _abortControllers[placeholderId];
  if (ctrl) { ctrl.abort(); delete _abortControllers[placeholderId]; }
  // Also cancel backend task if linked
  const item = state.canvasItems.find(i => i.itemId === placeholderId);
  if (item && item.taskId) {
    cancelBackendTask(item.taskId).catch(() => { });
    // Clean up pendingTasks so it won't reappear on refresh
    const session = state.sessions[state.currentSessionId];
    if (session && session.pendingTasks) {
      session.pendingTasks = session.pendingTasks.filter(pt => pt.taskId !== item.taskId);
      saveSessions();
    }
  }
}

export function subscribe(key, fn) {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(fn);
  return () => {
    listeners[key] = (listeners[key] || []).filter(f => f !== fn);
  };
}

export function setState(partial) {
  for (const key of Object.keys(partial)) {
    state[key] = partial[key];
  }
  if ('selectedModelId' in partial || 'selectedProvider' in partial || 'reusePrompt' in partial || 'reuseRef' in partial || 'batchSize' in partial || 'aspectRatio' in partial || 'selectedFamilyId' in partial || 'selectedResolution' in partial) {
    saveSettings();
  }
  for (const key of Object.keys(partial)) {
    if (listeners[key]) listeners[key].forEach(fn => fn());
  }
}

// --------------------------------------------------------------
// Provider 管理
// --------------------------------------------------------------
export function getProviderConfig(name) {
  return state.providers[name] || null;
}

function rebuildModels() {
  const allModels = [];
  Object.entries(state.providers).forEach(([name, provider]) => {
    (provider.models || []).forEach(m => {
      if (m.enabled !== false) {
        allModels.push({ id: m.id, owner: m.owner || name, provider: name });
      }
    });
  });
  state.models = allModels;
  if (listeners['models']) listeners['models'].forEach(fn => fn());
}

export function addProvider(name, base_url, api_key) {
  if (state.providers[name]) return false;
  state.providers[name] = { base_url, api_key, models: [] };
  saveSettings();
  return true;
}

export function removeProvider(name) {
  if (!state.providers[name]) return;
  delete state.providers[name];
  if (state.selectedProvider === name) {
    state.selectedProvider = '';
    state.selectedModelId = '';
  }
  rebuildModels();
  saveSettings();
}

export function updateProviderModels(name, models) {
  if (!state.providers[name]) return;
  const existing = state.providers[name].models || [];
  state.providers[name].models = models.map(m => {
    const prev = existing.find(em => em.id === m.id);
    return { ...m, enabled: prev ? prev.enabled : true };
  });
  rebuildModels();
  saveSettings();
  if (listeners['providers']) listeners['providers'].forEach(fn => fn());
}

export function toggleModelEnabled(providerName, modelId) {
  const provider = state.providers[providerName];
  if (!provider) return;
  const model = (provider.models || []).find(m => m.id === modelId);
  if (!model) return;
  model.enabled = !model.enabled;
  rebuildModels();
  saveSettings();
  if (listeners['providers']) listeners['providers'].forEach(fn => fn());
}

export function updateProviderConfig(name, config) {
  if (!state.providers[name]) return;
  Object.assign(state.providers[name], config);
  saveSettings();
}

// --------------------------------------------------------------
// 后端存储
// --------------------------------------------------------------
const STORAGE_BASE = import.meta.env.VITE_STORAGE_BASE || 'http://127.0.0.1:5001';

function getStorageBase() {
  return STORAGE_BASE.replace(/\/+$/, '');
}

function saveSettings() {
  debouncedBackendSync();
}

async function loadSettings() {
  try {
    return await apiGet('/api/settings') || {};
  } catch (e) {
    console.log('[加载] 后端 settings 不可用:', e.message);
    return {};
  }
}

let _pendingSave = null;

function debouncedBackendSync() {
  if (_pendingSave) return;
  _pendingSave = setTimeout(async () => {
    _pendingSave = null;
    try { await apiPost('/api/sessions', sanitizeForSave(state.sessions)); } catch { }
    // 发送完整素材库对象（包含堆叠组）
    try {
      await apiPost('/api/materials', {
        materials: state.materials,
        materialStacks: state.materialStacks
      });
    } catch (e) { console.error('[同步] 保存素材库到后端失败:', e); }
    try {
      await apiPost('/api/settings', {
        selectedModelId: state.selectedModelId,
        selectedProvider: state.selectedProvider,
        providers: state.providers,
        reusePrompt: state.reusePrompt,
        reuseRef: state.reuseRef,
        batchSize: state.batchSize,
        aspectRatio: state.aspectRatio,
        selectedFamilyId: state.selectedFamilyId,
        selectedResolution: state.selectedResolution
      });
    } catch { }
  }, 200);
}

async function apiGet(path) {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function apiPost(path, data) {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function beaconPost(path, data) {
  const base = getStorageBase();
  if (!base) return;
  navigator.sendBeacon(base + path, JSON.stringify(data));
}

function sanitizeImageUrl(url) {
  return url ? url.replace(/\/api\/images\/[a-f0-9]+\.\w+/g, m => m.replace(/\.\w+$/, '')) : url;
}

async function ensureImageUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return resolveBackendUrl(dataUrl);

  const hash = await computeDataUrlHash(dataUrl);
  const ext = dataUrl.split(';')[0].split('/')[1] || 'png';
  const { url } = await apiPost('/api/images', { data: dataUrl, ext, hash });
  return getStorageBase() + url;
}

function uploadItemImage(item) {
  if (!item) return;
  const url = item.imageUrl;

  if (url && url.startsWith('data:')) {
    ensureImageUrl(url).then(newUrl => {
      if (newUrl !== url) {
        item.imageUrl = newUrl;
        if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
        saveSessions();
      }
    }).catch(() => { });
  }
}

async function loadSessions() {
  try {
    const remote = await apiGet('/api/sessions');
    if (remote && Object.keys(remote).length > 0) {
      console.log('[加载] sessions 从后端加载:', Object.keys(remote).length, '个');
      // 确保每个 session 有 stacks 字段
      for (const id of Object.keys(remote)) {
        if (!remote[id].stacks) remote[id].stacks = [];
      }
      return remote;
    }
  } catch (e) { console.log('[加载] 后端 sessions 不可用:', e.message); }
  return {};
}

function saveSessions() {
  debouncedBackendSync();
}

const STORAGE_ACTIVE_KEY = 'image-gen-active-session';

function loadActiveIdFromLocalStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_ACTIVE_KEY);
    if (stored && stored !== 'undefined') return stored;
  } catch (e) { console.log('[加载] localStorage active 不可用:', e.message); }
  return '';
}

function saveActiveIdToLocalStorage(id) {
  try {
    if (id) localStorage.setItem(STORAGE_ACTIVE_KEY, id);
    else localStorage.removeItem(STORAGE_ACTIVE_KEY);
  } catch (e) { console.log('[保存] localStorage active 不可用:', e.message); }
}

async function loadActiveId() {
  const localId = loadActiveIdFromLocalStorage();
  if (localId) {
    console.log('[加载] 使用 localStorage 中的会话 ID:', localId);
    beaconPost('/api/active', { id: localId });
    return localId;
  }

  let backendId = '';
  try {
    const val = await apiGet('/api/active');
    if (val) backendId = val;
  } catch (e) { console.log('[加载] 后端 active 不可用:', e.message); }

  if (backendId) {
    saveActiveIdToLocalStorage(backendId);
    return backendId;
  }

  return '';
}

function saveActiveId(id) {
  beaconPost('/api/active', { id });
  saveActiveIdToLocalStorage(id);
}

// --------------------------------------------------------------
// 会话管理
// --------------------------------------------------------------
export async function createSession() {
  const id = generateId();
  state.sessions[id] = {
    id,
    title: '新会话',
    createdAt: Date.now(),
    _canvasSeq: 0,
    stacks: []      // 新增：存储堆叠组
  };
  saveSessions();
  await switchSession(id);
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
}

export async function deleteSession(id) {
  delete state.sessions[id];
  saveSessions();
  if (state.currentSessionId === id) {
    const ids = Object.keys(state.sessions);
    if (ids.length > 0) {
      await switchSession(ids[ids.length - 1]);
    } else {
      await createSession();
    }
  }
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
}

export async function switchSession(id) {
  _cleanupResolvedUrls();
  state.currentSessionId = id;
  saveActiveId(id);
  await rebuildCanvasFromSession();
  state.selectedItemIds = [];
  state.selectedMaterialIds = [];
  state.viewport = { panX: 0, panY: 0, zoom: 1 };
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['currentSessionId']) listeners['currentSessionId'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['selectedItemIds']) listeners['selectedItemIds'].forEach(fn => fn());
  if (listeners['selectedMaterialIds']) listeners['selectedMaterialIds'].forEach(fn => fn());
  if (listeners['viewport']) listeners['viewport'].forEach(fn => fn());
}

export async function appendMessage(msg) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  if (msg.role === 'user' && msg.refImages && msg.refImages.length > 0) {
    msg.refImages = await Promise.all(msg.refImages.map(async img => {
      if (img.dataUrl && img.dataUrl.startsWith('data:')) {
        try { return { ...img, dataUrl: await ensureImageUrl(img.dataUrl) }; }
        catch { return img; }
      }
      return img;
    }));
  }

  session.messages = session.messages || [];
  session.messages.push(msg);
  session.updatedAt = Date.now();

  const firstUserMsg = session.messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const t = firstUserMsg.prompt.slice(0, 40);
    session.title = t + (firstUserMsg.prompt.length > 40 ? '...' : '');
  }

  saveSessions();
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  return msg;
}

// --------------------------------------------------------------
// 画布元素管理
// --------------------------------------------------------------
function getViewportCenter() {
  const container = document.getElementById('canvasContainer');
  if (!container) return { cx: 200, cy: 200 };
  const vp = state.viewport;
  return {
    cx: (container.clientWidth / 2 - vp.panX) / vp.zoom,
    cy: (container.clientHeight / 2 - vp.panY) / vp.zoom
  };
}

// --------------------------------------------------------------
// 生成占位符
// --------------------------------------------------------------
export function addGeneratingPlaceholder(prompt, refImages, taskId) {
  const id = generateId();
  const item = {
    itemId: 'gen-' + id,
    taskId: taskId || '',
    messageIndex: -1,
    imageUrl: '',
    prompt: prompt || '',
    refImages: refImages || [],
    generating: true,
    status: 'generating',
    startTime: Date.now(),
    error: '',
    thinking: '',
    type: 'image'
  };
  state.canvasItems.push(item);

  // Persist pending task in session so placeholders survive page refresh
  const session = state.sessions[state.currentSessionId];
  if (session && taskId) {
    session.pendingTasks = session.pendingTasks || [];
    session.pendingTasks.push({
      taskId,
      prompt: prompt || '',
      refImages: refImages || [],
      startTime: Date.now()
    });
    saveSessions();
  }

  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return item;
}

export async function addResultToCanvas({ status, imageUrl, prompt, refImages, error, placeholderId }) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  let uploadRefs = refImages || [];
  if (uploadRefs.length > 0) {
    uploadRefs = await Promise.all(uploadRefs.map(async img => {
      if (img.dataUrl && img.dataUrl.startsWith('data:')) {
        try { return { ...img, dataUrl: await ensureImageUrl(img.dataUrl) }; }
        catch { return img; }
      }
      return img;
    }));
  }

  if (placeholderId) {
    const placeholder = state.canvasItems.find(it => it.itemId === placeholderId);
    state.canvasItems = state.canvasItems.filter(it => it.itemId !== placeholderId);
    // Remove from pendingTasks so it won't be recreated on refresh
    if (placeholder && placeholder.taskId && session.pendingTasks) {
      session.pendingTasks = session.pendingTasks.filter(pt => pt.taskId !== placeholder.taskId);
    }
  }

  session.messages = session.messages || [];
  const seq = session._canvasSeq = (session._canvasSeq || 0) + 1;
  const msg = {
    role: 'assistant',
    status: status || 'ok',
    error: error || '',
    imageUrl: imageUrl || '',
    prompt: prompt || '',
    refImages: uploadRefs,
    canvasSeq: seq
  };
  session.messages.push(msg);
  session.updatedAt = Date.now();

  const firstUserMsg = session.messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const t = firstUserMsg.prompt.slice(0, 40);
    session.title = t + (firstUserMsg.prompt.length > 40 ? '...' : '');
  }

  const msgIndex = session.messages.length - 1;
  const { cx, cy } = getViewportCenter();
  const offset = state.canvasItems.length * 30;
  const isErr = status === 'error';

  const item = {
    itemId: 'item-' + msgIndex,
    messageIndex: msgIndex,
    imageUrl: imageUrl || '',
    prompt: prompt || '',
    refImages: uploadRefs,
    x: Math.max(0, cx - 150 + offset),
    y: Math.max(0, cy + offset),
    width: 300,
    height: isErr ? 80 : 300,
    generating: false,
    status: status || 'ok',
    error: error || '',
    type: 'image'
  };

  msg.x = item.x;
  msg.y = item.y;
  msg.width = item.width;
  msg.height = item.height;

  saveSessions();

  item.imageUrl = resolveBackendUrl(item.imageUrl);
  state.canvasItems.push(item);
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());

  uploadItemImage(item);

  return item;
}

export async function addDroppedImage(dataUrl) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  const savedUrl = await ensureImageUrl(dataUrl);
  const hash = await computeDataUrlHash(dataUrl);

  const seq = session._canvasSeq = (session._canvasSeq || 0) + 1;
  session.droppedImages = session.droppedImages || [];
  const id = generateId();
  const { cx, cy } = getViewportCenter();
  const offset = state.canvasItems.length * 30;
  const x = Math.max(0, cx - 150 + offset);
  const y = Math.max(0, cy + offset);

  const img = { id, imageUrl: savedUrl, dataHash: hash, canvasSeq: seq, x, y, width: 300, height: 300 };
  session.droppedImages.push(img);
  session.updatedAt = Date.now();
  saveSessions();

  const displayUrl = resolveBackendUrl(savedUrl);

  const item = {
    itemId: 'drop-' + id,
    messageIndex: -1,
    imageUrl: displayUrl || savedUrl,
    prompt: '',
    refImages: [],
    x, y, width: 300, height: 300,
    generating: false,
    status: 'ok',
    error: '',
    dropId: id,
    type: 'image'
  };
  state.canvasItems.push(item);
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return item;
}

export function updateCanvasItemPosition(itemId, x, y) {
  const item = state.canvasItems.find(i => i.itemId === itemId);
  if (!item) return;
  item.x = x;
  item.y = y;

  const session = state.sessions[state.currentSessionId];
  if (!session) return;

  if (item.dropId) {
    const dropped = session.droppedImages?.find(d => d.id === item.dropId);
    if (dropped) { dropped.x = x; dropped.y = y; saveSessions(); }
  } else if (item.messageIndex >= 0 && session.messages[item.messageIndex]) {
    session.messages[item.messageIndex].x = x;
    session.messages[item.messageIndex].y = y;
    saveSessions();
  } else if (item.type === 'stack' && session.stacks) {
    const stack = session.stacks.find(s => s.id === item.itemId.substring(5)); // remove 'stack-'
    if (stack) { stack.x = x; stack.y = y; saveSessions(); }
  }
}

export async function removeCanvasItemById(itemId) {
  const idx = state.canvasItems.findIndex(i => i.itemId === itemId);
  if (idx === -1) return;
  const item = state.canvasItems[idx];
  state.canvasItems.splice(idx, 1);

  const session = state.sessions[state.currentSessionId];
  if (!session) return;

  if (item.dropId) {
    session.droppedImages = (session.droppedImages || []).filter(d => d.id !== item.dropId);
    saveSessions();
  } else if (item.messageIndex >= 0 && session.messages[item.messageIndex]) {
    const userIdx = item.messageIndex - 1;
    if (userIdx >= 0 && session.messages[userIdx]?.role === 'user') {
      session.messages.splice(userIdx, 2);
    } else {
      session.messages.splice(item.messageIndex, 1);
    }
    saveSessions();
  } else if (item.type === 'stack' && session.stacks) {
    const rawStackId = item.itemId.substring(5);
    // 尝试规范化 ID：去掉可能的前导连字符
    const normalizedId = rawStackId.replace(/^-+/, '');
    console.log('[删除Stack] 原始 stackId:', rawStackId, '规范化后:', normalizedId);
    console.log('[删除Stack] 当前 stacks 列表:', session.stacks.map(s => ({ id: s.id, type: typeof s.id })));
    console.log('[删除Stack] 当前 stacks 数量:', session.stacks.length);
    const beforeCount = session.stacks.length;
    // 同时匹配原始ID和规范化后的ID（处理可能的前导连字符不一致）
    session.stacks = session.stacks.filter(s => s.id !== rawStackId && s.id !== normalizedId);
    console.log('[删除Stack] 过滤后剩余数量:', session.stacks.length, '删除了', beforeCount - session.stacks.length, '个');
    if (session.stacks.length === beforeCount) {
      console.error('[删除Stack] 未找到匹配的 stack! 原始ID=', rawStackId, '规范化ID=', normalizedId, '可用 IDs:', session.stacks.map(s => s.id));
      // 尝试更宽松的匹配：输出每个 stack.id 的字符表示
      session.stacks.forEach(s => {
        console.log(`  可用stack id: "${s.id}", 是否等于 raw? ${s.id === rawStackId}, 是否等于 normalized? ${s.id === normalizedId}`);
      });
    } else {
      console.log('[删除Stack] 成功删除 stack');
    }
    // 立即保存到后端，避免刷新后重新出现
    try {
      await apiPost('/api/sessions', sanitizeForSave(state.sessions));
      console.log('[删除Stack] 立即保存 sessions 成功');
    } catch (err) {
      console.error('[删除Stack] 保存 sessions 失败:', err);
    }
  }

  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
}

export async function rebuildCanvasFromSession() {
  state.canvasItems = [];
  const session = state.sessions[state.currentSessionId];
  if (!session) {
    console.log('[重建画布] 无当前会话');
    return;
  }

  console.log('[重建画布] 当前会话:', session.id, '标题:', session.title,
    '消息数:', session.messages?.length || 0,
    'droppedImages:', session.droppedImages?.length || 0,
    'stacks:', session.stacks?.length || 0);

  const items = [];
  let lastUserMsg = null;

  // 处理 messages（如果存在）
  if (session.messages) {
    session.messages.forEach((msg, i) => {
      if (msg.role === 'user') {
        lastUserMsg = msg;
      } else if (msg.role === 'assistant') {
        if (msg.status === 'ok' && msg.imageUrl) {
          items.push({
            itemId: 'item-' + i,
            messageIndex: i,
            imageUrl: resolveBackendUrl(msg.imageUrl),
            prompt: msg.prompt || (lastUserMsg ? lastUserMsg.prompt : ''),
            refImages: msg.refImages || (lastUserMsg ? lastUserMsg.refImages || [] : []),
            x: msg.x != null ? msg.x : 50,
            y: msg.y != null ? msg.y : 50,
            width: msg.width || 300,
            height: msg.height || 300,
            generating: false,
            status: 'ok',
            error: '',
            canvasSeq: msg.canvasSeq,
            type: 'image'
          });
        } else if (msg.status === 'error') {
          items.push({
            itemId: 'item-' + i,
            messageIndex: i,
            imageUrl: '',
            prompt: msg.prompt || (lastUserMsg ? lastUserMsg.prompt : ''),
            refImages: msg.refImages || [],
            x: msg.x || 50,
            y: msg.y || 50,
            width: 300,
            height: 80,
            generating: false,
            status: 'error',
            error: msg.error || '',
            canvasSeq: msg.canvasSeq,
            type: 'image'
          });
        }
      }
    });
  }

  // 处理 droppedImages
  if (session.droppedImages) {
    session.droppedImages.forEach(img => {
      items.push({
        itemId: 'drop-' + img.id,
        messageIndex: -1,
        imageUrl: resolveBackendUrl(img.imageUrl),
        prompt: '',
        refImages: [],
        x: img.x != null ? img.x : 50,
        y: img.y != null ? img.y : 50,
        width: img.width || 300,
        height: img.height || 300,
        generating: false,
        status: 'ok',
        error: '',
        dropId: img.id,
        dataHash: img.dataHash,
        canvasSeq: img.canvasSeq,
        type: 'image'
      });
    });
  }

  // 处理 stacks
  if (session.stacks) {
    session.stacks.forEach(stack => {
      if (stack.items && stack.items.length > 0) {
        // 确保缩略图 URL 被解析
        const thumbnail = stack.items[0].imageUrl ? resolveBackendUrl(stack.items[0].imageUrl) : '';
        items.push({
          itemId: 'stack-' + stack.id,
          type: 'stack',
          stackId: stack.id,
          items: stack.items,           // 子图片原始数据（包含所有原始字段）
          x: stack.x != null ? stack.x : 50,
          y: stack.y != null ? stack.y : 50,
          width: stack.width || 300,
          height: stack.height || 300,
          thumbnail: thumbnail,
          count: stack.items.length,
          status: 'ok',                // 确保 status 为 ok 以正常渲染
          generating: false,
          imageUrl: thumbnail          // 提供 imageUrl 以便通用逻辑回退（可选）
        });
      }
    });
  }

  // 重建生成中的占位符（来自 pendingTasks），确保刷新后不丢失
  if (session.pendingTasks && session.pendingTasks.length > 0) {
    console.log('[重建画布] 恢复 pendingTasks:', session.pendingTasks.length, '个');
    session.pendingTasks.forEach(pt => {
      items.push({
        itemId: 'gen-' + generateId(),
        taskId: pt.taskId,
        messageIndex: -1,
        imageUrl: '',
        prompt: pt.prompt || '',
        refImages: pt.refImages || [],
        generating: true,
        status: 'generating',
        startTime: pt.startTime || Date.now(),
        error: '',
        thinking: pt.thinking || '',
        type: 'image'
      });
    });
  }

  // 按 canvasSeq 排序
  if (items.length > 0 && items.every(it => it.canvasSeq != null)) {
    items.sort((a, b) => a.canvasSeq - b.canvasSeq);
  }

  state.canvasItems = items;
  console.log('[重建画布] 完成, canvasItems:', items.length, '个, 顺序:', items.map(it => `${it.itemId}(seq=${it.canvasSeq})`).join(', '));
}

// --------------------------------------------------------------
// 素材库
// --------------------------------------------------------------
async function computeDataUrlHash(dataUrl) {
  const data = new TextEncoder().encode(dataUrl);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function migrateMaterialParentIds(materials, materialStacks) {
  let changed = false;
  // 1. 为每个堆叠组中的子素材设置 parentStackId
  for (const stack of materialStacks) {
    if (stack.children && stack.children.length) {
      for (const childId of stack.children) {
        const child = materials.find(m => m.id === childId);
        if (child && child.parentStackId !== stack.id) {
          child.parentStackId = stack.id;
          changed = true;
        }
      }
    }
  }
  // 2. 清理孤儿 parentStackId（指向不存在的堆叠组）
  // 注意：只有当 materialStacks 非空时才执行清理，避免因加载顺序导致错误清除
  if (materialStacks.length > 0) {
    for (const material of materials) {
      if (material.parentStackId) {
        const stackExists = materialStacks.some(s => s.id === material.parentStackId);
        if (!stackExists) {
          delete material.parentStackId;
          changed = true;
        }
      }
    }
  } else {
    // 如果没有堆叠组但某些素材有 parentStackId，可能是数据不一致，保留原值并输出警告
    const orphans = materials.filter(m => m.parentStackId);
    if (orphans.length) {
      console.warn(`[migrateMaterialParentIds] 检测到 ${orphans.length} 个素材有 parentStackId 但堆叠组为空，已保留 parentStackId 避免数据丢失`, orphans.map(m => ({ id: m.id, parent: m.parentStackId })));
    }
  }
  return changed;
}

async function loadMaterials() {
  // 完全从后端加载素材库（包括堆叠组）
  try {
    const response = await apiGet('/api/materials');
    // 新格式：{ materials, materialStacks }
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      let materials = response.materials || [];
      let materialStacks = response.materialStacks || [];
      // 确保每个素材有必要的字段
      materials.forEach(m => {
        if (!m.category) m.category = 'Imported';
        if (!m.type) m.type = 'image';
        if (m.parentStackId === undefined) m.parentStackId = null;
      });
      // 修复 parentStackId 映射
      const migrated = migrateMaterialParentIds(materials, materialStacks);
      if (migrated) {
        console.log('[修复] 已更新 parentStackId 映射，重新保存到后端');
        // 修复后需要保存回后端
        await apiPost('/api/materials', { materials, materialStacks });
      }
      // 可选：将后端数据同步到 localStorage 作为缓存（但不作为主存储）
      try {
        localStorage.setItem('image-gen-materials-v2', JSON.stringify({ materials, materialStacks }));
      } catch (e) { /* 忽略缓存写入失败 */ }
      return { materials, materialStacks };
    }
    // 兼容旧格式：后端返回的是数组（旧素材列表）
    if (Array.isArray(response)) {
      console.log('[加载] 检测到旧格式素材列表，正在迁移');
      const materials = response.map(m => ({
        ...m,
        category: 'Imported',
        type: 'image',
        parentStackId: null
      }));
      const materialStacks = [];
      // 立即保存新格式到后端
      await apiPost('/api/materials', { materials, materialStacks });
      // 清除 localStorage 中的旧数据
      localStorage.removeItem('image-gen-materials-v2');
      return { materials, materialStacks };
    }
  } catch (e) {
    console.log('[加载] 从后端加载素材库失败:', e.message);
  }
  // 如果后端完全不可用，尝试从 localStorage 读取作为最后的降级
  const localData = localStorage.getItem('image-gen-materials-v2');
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      if (parsed.materials && Array.isArray(parsed.materials)) {
        console.log('[降级] 从 localStorage 加载素材库 v2');
        parsed.materials.forEach(m => {
          if (!m.category) m.category = 'Imported';
          if (!m.type) m.type = 'image';
          if (m.parentStackId === undefined) m.parentStackId = null;
        });
        migrateMaterialParentIds(parsed.materials, parsed.materialStacks || []);
        // 尝试将降级数据写回后端
        try {
          await apiPost('/api/materials', { materials: parsed.materials, materialStacks: parsed.materialStacks || [] });
        } catch (e2) { /* 静默失败 */ }
        return { materials: parsed.materials, materialStacks: parsed.materialStacks || [] };
      }
    } catch (e) { console.log('[降级] localStorage 解析失败:', e); }
  }
  // 完全空状态
  return { materials: [], materialStacks: [] };
}

function saveMaterials() {
  // 完全依靠后端存储，不再使用 localStorage 作为主存储
  // 但为了降级，仍然可以写入 localStorage 作为缓存（可选）
  const toSave = {
    materials: state.materials,
    materialStacks: state.materialStacks
  };
  // 直接向后端发送完整数据
  debouncedBackendSync();
  // 可选：写入 localStorage 作为缓存，但不影响主要逻辑
  try {
    localStorage.setItem('image-gen-materials-v2', JSON.stringify(toSave));
  } catch (e) { /* 忽略缓存写入失败 */ }
}

export async function addMaterial(name, dataUrl, category = 'Imported', forceDetach = false, prompt = null, refImages = []) {
  const hash = await computeDataUrlHash(dataUrl);
  const existing = state.materials.find(m => m.dataHash === hash);
  if (existing) {
    // 如果需要强制移出堆叠组（例如用户拖拽到根区域时），通过 forceDetach 参数控制
    if (forceDetach && existing.parentStackId) {
      console.log(`[addMaterial] 强制将素材 "${existing.name}" 从堆叠组 ${existing.parentStackId} 中移出`);
      const oldStack = state.materialStacks.find(s => s.id === existing.parentStackId);
      if (oldStack) {
        oldStack.children = oldStack.children.filter(cid => cid !== existing.id);
        if (oldStack.children.length === 0) {
          state.materialStacks = state.materialStacks.filter(s => s.id !== oldStack.id);
          console.log(`[addMaterial] 原堆叠组 ${oldStack.id} 已变空，已删除`);
        } else {
          const firstChild = state.materials.find(m => m.id === oldStack.children[0]);
          if (firstChild) oldStack.thumbnail = firstChild.dataUrl;
        }
      }
      existing.parentStackId = null;
      saveMaterials();
      if (listeners['materials']) listeners['materials'].forEach(fn => fn());
      if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
      setState({ statusText: `素材“${existing.name}”已从堆叠组移出` });
    } else {
      // 正常重复素材，不做任何改动，仅提示
      console.log(`[addMaterial] 素材 "${existing.name}" 已存在，跳过添加`);
      setState({ statusText: '素材已存在，跳过添加' });
    }
    // 即使素材已存在，如果传入了新的 prompt/refImages 且现有素材缺失，则更新
    if (existing.prompt === undefined && prompt) existing.prompt = prompt;
    if ((existing.refImages === undefined || existing.refImages.length === 0) && refImages && refImages.length) existing.refImages = refImages;
    if (existing.prompt !== undefined || existing.refImages !== undefined) saveMaterials();
    return existing;
  }

  const savedUrl = await ensureImageUrl(dataUrl);
  const mat = {
    id: generateId(),
    name,
    dataUrl: resolveBackendUrl(savedUrl),
    dataHash: hash,
    addedAt: Date.now(),
    category,          // 'Generated' 或 'Imported'
    type: 'image',
    parentStackId: null,   // 所属堆叠组 ID，若为 null 表示独立素材
    prompt: prompt || null,   // 提示词（可能为空）
    refImages: refImages || [] // 参考图数组
  };
  state.materials.push(mat);
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  return mat;
}

// 显式将素材从堆叠组中移出（独立）
export async function detachMaterialFromStack(materialId) {
  const mat = state.materials.find(m => m.id === materialId);
  if (!mat || !mat.parentStackId) return false;
  const stackId = mat.parentStackId;
  const stack = state.materialStacks.find(s => s.id === stackId);
  if (stack) {
    stack.children = stack.children.filter(cid => cid !== materialId);
    if (stack.children.length === 0) {
      state.materialStacks = state.materialStacks.filter(s => s.id !== stackId);
    } else {
      const firstChild = state.materials.find(m => m.id === stack.children[0]);
      if (firstChild) stack.thumbnail = firstChild.dataUrl;
    }
  }
  mat.parentStackId = null;
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  return true;
}

// 辅助函数：清理所有只有一个子素材的堆叠组（自动解散）
function cleanupSingleItemStacks() {
  for (let i = 0; i < state.materialStacks.length; i++) {
    const stack = state.materialStacks[i];
    if (stack.children.length === 1) {
      const orphanId = stack.children[0];
      const orphanMat = state.materials.find(m => m.id === orphanId);
      if (orphanMat) {
        orphanMat.parentStackId = null;
      }
      state.materialStacks.splice(i, 1);
      i--; // 调整索引
    }
  }
}

export function removeMaterial(id) {
  const mat = state.materials.find(m => m.id === id);
  if (!mat) return;
  
  // 如果素材属于某个堆叠组，从该组中移除
  if (mat.parentStackId) {
    const stack = state.materialStacks.find(s => s.id === mat.parentStackId);
    if (stack) {
      stack.children = stack.children.filter(cid => cid !== id);
      // 如果堆叠组变空，删除堆叠组
      if (stack.children.length === 0) {
        state.materialStacks = state.materialStacks.filter(s => s.id !== stack.id);
      } else {
        // 更新缩略图
        const firstChild = state.materials.find(m => m.id === stack.children[0]);
        if (firstChild) stack.thumbnail = firstChild.dataUrl;
      }
    }
  }
  
  // 删除素材本身
  state.materials = state.materials.filter(m => m.id !== id);
  state.selectedMaterialIds = state.selectedMaterialIds.filter(selectedId => selectedId !== id);
  
  // 清理所有只剩一个子素材的堆叠组（自动解散）
  cleanupSingleItemStacks();
  
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  if (listeners['selectedMaterialIds']) listeners['selectedMaterialIds'].forEach(fn => fn());
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
}

// 创建堆叠组
export function createMaterialStack(itemIds, category, name = 'Group') {
  if (!itemIds.length) return null;
  const stackId = `stack-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  const children = [...itemIds];
  const firstMat = state.materials.find(m => m.id === children[0]);
  if (!firstMat) return null;
  const stack = {
    id: stackId,
    name,
    category,
    children,
    thumbnail: firstMat.dataUrl,
    type: 'stack',
    isStack: true
  };
  state.materialStacks.push(stack);
  // 为每个子素材设置 parentStackId
  for (const id of children) {
    const mat = state.materials.find(m => m.id === id);
    if (mat) {
      mat.parentStackId = stackId;
    }
  }
  saveMaterials();
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  return stack;
}

// 解散堆叠组
export function ungroupMaterialStack(stackId) {
  const stackIndex = state.materialStacks.findIndex(s => s.id === stackId);
  if (stackIndex === -1) return;
  const stack = state.materialStacks[stackIndex];
  // 清除子素材的 parentStackId
  for (const id of stack.children) {
    const mat = state.materials.find(m => m.id === id);
    if (mat) {
      mat.parentStackId = null;
    }
  }
  state.materialStacks.splice(stackIndex, 1);
  saveMaterials();
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
}

// 移动素材到指定堆叠组（或移出到根）
export function moveMaterialToStack(materialIds, targetStackId = null) {
  if (!materialIds.length) return;
  
  // 先清除这些素材原有的 parentStackId（从原组中移除）
  for (const id of materialIds) {
    const mat = state.materials.find(m => m.id === id);
    if (mat) {
      const oldStackId = mat.parentStackId;
      if (oldStackId) {
        const oldStack = state.materialStacks.find(s => s.id === oldStackId);
        if (oldStack) {
          oldStack.children = oldStack.children.filter(cid => cid !== id);
        }
      }
      mat.parentStackId = null;
    }
  }

  if (targetStackId === null) {
    // 移出到根：保持 parentStackId = null，无需额外操作
    // （上面已经清除）
  } else {
    // 加入目标堆叠组
    const targetStack = state.materialStacks.find(s => s.id === targetStackId);
    if (targetStack) {
      for (const id of materialIds) {
        const mat = state.materials.find(m => m.id === id);
        if (mat) {
          mat.parentStackId = targetStackId;
          if (!targetStack.children.includes(id)) {
            targetStack.children.push(id);
          }
        }
      }
      // 更新缩略图
      const firstChild = targetStack.children.length ? state.materials.find(m => m.id === targetStack.children[0]) : null;
      if (firstChild) targetStack.thumbnail = firstChild.dataUrl;
    } else {
      // 目标堆叠组不存在（异常情况），创建新组
      const category = materialIds.length ? (state.materials.find(m => m.id === materialIds[0])?.category || 'Imported') : 'Imported';
      createMaterialStack(materialIds, category);
    }
  }

  // 清理空堆叠组（没有子素材的组）
  for (let i = 0; i < state.materialStacks.length; i++) {
    const s = state.materialStacks[i];
    if (s.children.length === 0) {
      state.materialStacks.splice(i, 1);
      i--;
    }
  }

  // 清理所有只有一个子素材的堆叠组（自动解散）
  cleanupSingleItemStacks();

  saveMaterials();
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
}

// 清理孤儿素材：将 parentStackId 指向不存在的堆叠组的素材重置为独立素材
export function cleanupOrphanMaterials() {
  let changed = false;
  for (const material of state.materials) {
    if (material.parentStackId) {
      const stackExists = state.materialStacks.some(s => s.id === material.parentStackId);
      if (!stackExists) {
        delete material.parentStackId;
        changed = true;
      }
    }
  }
  if (changed) {
    saveMaterials();
    if (listeners['materials']) listeners['materials'].forEach(fn => fn());
    if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  }
}

// 获取合并后的视图数据（独立素材 + 堆叠组）
// 注意：独立素材是指 parentStackId 为 null 或 undefined 的素材（即未分组），不包括已分组的子素材
export function getFlattenedMaterialItems(category = null) {
  // 在获取前先清理孤儿素材，确保数据一致性
  cleanupOrphanMaterials();
  
  // 调试输出：所有素材的完整信息
  console.log(`[getFlattenedMaterialItems] 开始获取，category = ${category}`);
  console.log(`[getFlattenedMaterialItems] 素材总数: ${state.materials.length}`);
  state.materials.forEach(m => {
    console.log(`  素材: id=${m.id}, name=${m.name}, category=${m.category}, parentStackId=${m.parentStackId}`);
  });
  console.log(`[getFlattenedMaterialItems] 堆叠组总数: ${state.materialStacks.length}`);
  state.materialStacks.forEach(s => {
    console.log(`  堆叠组: id=${s.id}, name=${s.name}, category=${s.category}, children数量=${s.children.length}`);
  });
  
  const items = [];
  // 添加独立素材：parentStackId 不是有效堆叠组 ID 的素材（即 null 或 undefined 或孤儿）
  // 使用宽松的条件：!m.parentStackId 包括 null, undefined, 空字符串
  const filteredMats = state.materials.filter(m => (!m.parentStackId) && (category ? m.category === category : true));
  console.log(`[getFlattenedMaterialItems] 独立素材（无 parentStackId）过滤后数量: ${filteredMats.length}`);
  items.push(...filteredMats);
  // 添加堆叠组
  const filteredStacks = category ? state.materialStacks.filter(s => s.category === category) : [...state.materialStacks];
  console.log(`[getFlattenedMaterialItems] 堆叠组过滤后数量: ${filteredStacks.length}`);
  items.push(...filteredStacks);
  console.log(`[getFlattenedMaterialItems] 最终返回的 items 总数: ${items.length}`);
  return items;
}

// --------------------------------------------------------------
// 任务队列 API 辅助函数
// --------------------------------------------------------------
async function apiGetTasks() {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + '/api/tasks');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiPostTask(data) {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiCancelTask(taskId) {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + `/api/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export async function submitTask({ prompt, model, provider, refs }) {
  const task = await apiPostTask({ prompt, model, provider, refs });
  return { id: task.id };
}

export async function fetchTasks() {
  const tasks = await apiGetTasks();
  return tasks;
}

export async function cancelBackendTask(taskId) {
  await apiCancelTask(taskId);
}

// 在初始化时同步 pendingTasks 与后端任务状态：
// - 已完成的任务直接生成结果，不再显示占位符
// - 清理后端不存在的孤儿 pendingTasks
async function _reconcilePendingTasks() {
  const sessions = state.sessions;
  if (!sessions || !Object.keys(sessions).length) return;

  let backendTasks = [];
  try {
    backendTasks = await fetchTasks();
  } catch (e) {
    console.log('[同步] 无法获取后端任务列表，跳过 pendingTasks 同步:', e.message);
    return;
  }

  if (!Array.isArray(backendTasks) || backendTasks.length === 0) return;

  const backendTaskMap = {};
  for (const t of backendTasks) {
    backendTaskMap[t.id] = t;
  }

  let anyChanges = false;

  for (const sid of Object.keys(sessions)) {
    const session = sessions[sid];
    if (!session.pendingTasks || session.pendingTasks.length === 0) continue;

    const remaining = [];

    for (const pt of session.pendingTasks) {
      const backendTask = backendTaskMap[pt.taskId];

      if (!backendTask) {
        // 后端已清理此任务（可能超时被清理），从 pendingTasks 移除
        console.log('[同步] 清理孤儿 pendingTask:', pt.taskId);
        anyChanges = true;
        continue;
      }

      if (backendTask.status === 'completed' && backendTask.image_url) {
        console.log('[同步] 恢复已完成任务:', pt.taskId);
        const prevSessionId = state.currentSessionId;
        state.currentSessionId = sid;

        try {
          await addResultToCanvas({
            status: 'ok',
            imageUrl: backendTask.image_url,
            prompt: backendTask.prompt || pt.prompt,
            refImages: pt.refImages || [],
            placeholderId: null
          });
        } catch (e) {
          console.error('[同步] 恢复已完成任务失败:', pt.taskId, e);
          remaining.push(pt);
          state.currentSessionId = prevSessionId;
          continue;
        }

        state.currentSessionId = prevSessionId;
        anyChanges = true;
      } else if (backendTask.status === 'failed' || backendTask.status === 'cancelled') {
        console.log('[同步] 恢复失败/取消任务:', pt.taskId, backendTask.status);
        const prevSessionId = state.currentSessionId;
        state.currentSessionId = sid;

        if (backendTask.status === 'failed') {
          try {
            await addResultToCanvas({
              status: 'error',
              error: backendTask.error || '生成失败',
              prompt: backendTask.prompt || pt.prompt,
              refImages: pt.refImages || [],
              placeholderId: null
            });
          } catch (e) {
            console.error('[同步] 恢复失败任务结果出错:', pt.taskId, e);
            remaining.push(pt);
            state.currentSessionId = prevSessionId;
            continue;
          }
        }

        state.currentSessionId = prevSessionId;
        anyChanges = true;
      } else {
        // pending 或 running 的任务，保留占位符
        remaining.push(pt);
      }
    }

    session.pendingTasks = remaining;
  }

  if (anyChanges) {
    // 批量保存所有变更
    try { await apiPost('/api/sessions', sanitizeForSave(state.sessions)); } catch {}
  }
}

// --------------------------------------------------------------
// 初始化存储（从后端加载数据）
// --------------------------------------------------------------
export async function initStore() {
  const [sessions, materialsData, settings, activeId] = await Promise.all([
    loadSessions(),
    loadMaterials(),
    loadSettings(),
    loadActiveId()
  ]);
  
  if (sessions && Object.keys(sessions).length > 0) {
    state.sessions = sessions;
  }
  if (materialsData) {
    state.materials = materialsData.materials || [];
    state.materialStacks = materialsData.materialStacks || [];
  }
  if (settings) {
    if (settings.selectedModelId !== undefined) state.selectedModelId = settings.selectedModelId;
    if (settings.selectedProvider !== undefined) state.selectedProvider = settings.selectedProvider;
    if (settings.providers !== undefined) state.providers = settings.providers;
    if (settings.reusePrompt !== undefined) state.reusePrompt = settings.reusePrompt;
    if (settings.reuseRef !== undefined) state.reuseRef = settings.reuseRef;
    if (settings.batchSize !== undefined) state.batchSize = settings.batchSize;
    if (settings.aspectRatio !== undefined) state.aspectRatio = settings.aspectRatio;
    if (settings.selectedFamilyId !== undefined) state.selectedFamilyId = settings.selectedFamilyId;
    if (settings.selectedResolution !== undefined) state.selectedResolution = settings.selectedResolution;
  }
  
  // 恢复当前会话 ID
  if (activeId && state.sessions[activeId]) {
    state.currentSessionId = activeId;
  } else if (Object.keys(state.sessions).length > 0) {
    // 如果 activeId 无效，则使用第一个会话
    state.currentSessionId = Object.keys(state.sessions)[0];
  } else {
    // 没有任何会话，保持空字符串（由调用者创建）
    state.currentSessionId = '';
  }
  
  rebuildModels();

  // 在重建画布之前，先与后端任务列表同步 pendingTasks，
  // 确保已完成的任务直接展示结果，而不显示占位符
  await _reconcilePendingTasks();

  // 如果有当前会话，重建画布（恢复画布项）
  if (state.currentSessionId) {
    await rebuildCanvasFromSession();
  }
  
  // 通知所有监听器状态已更新
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['currentSessionId']) listeners['currentSessionId'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  if (listeners['materialStacks']) listeners['materialStacks']?.forEach(fn => fn());
  if (listeners['models']) listeners['models'].forEach(fn => fn());
  if (listeners['selectedModelId']) listeners['selectedModelId'].forEach(fn => fn());
  if (listeners['selectedProvider']) listeners['selectedProvider'].forEach(fn => fn());
  if (listeners['providers']) listeners['providers'].forEach(fn => fn());
}

// --------------------------------------------------------------
// Stack 操作
// --------------------------------------------------------------
function findItemSource(itemId) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  // 检查是否为 dropped image
  const dropMatch = itemId.match(/^drop-(.+)$/);
  if (dropMatch) {
    const dropId = dropMatch[1];
    const img = session.droppedImages?.find(d => d.id === dropId);
    if (img) return { type: 'dropped', data: img, id: dropId };
  }

  // 检查是否为 assistant message
  const msgMatch = itemId.match(/^item-(\d+)$/);
  if (msgMatch) {
    const idx = parseInt(msgMatch[1], 10);
    const msg = session.messages?.[idx];
    if (msg && msg.role === 'assistant') return { type: 'message', data: msg, index: idx };
  }
  return null;
}

function removeItemFromSource(itemId) {
  const source = findItemSource(itemId);
  const session = state.sessions[state.currentSessionId];
  if (!session || !source) return false;

  if (source.type === 'dropped') {
    session.droppedImages = session.droppedImages.filter(d => d.id !== source.id);
  } else if (source.type === 'message') {
    const idx = source.index;
    const userIdx = idx - 1;
    if (userIdx >= 0 && session.messages[userIdx]?.role === 'user') {
      session.messages.splice(userIdx, 2);
    } else {
      session.messages.splice(idx, 1);
    }
  }
  saveSessions();
  return true;
}

function getItemDataById(itemId) {
  const item = state.canvasItems.find(i => i.itemId === itemId);
  if (!item) return null;
  // 从原型数据中提取完整拷贝（避免引用）
  const source = findItemSource(itemId);
  if (source) {
    if (source.type === 'dropped') {
      return {
        type: 'image',
        imageUrl: source.data.imageUrl,
        prompt: '',
        refImages: [],
        x: source.data.x,
        y: source.data.y,
        width: source.data.width,
        height: source.data.height,
        status: 'ok',
        error: '',
        generating: false,
        dropId: source.data.id,
        messageIndex: -1,
        canvasSeq: source.data.canvasSeq
      };
    } else if (source.type === 'message') {
      const msg = source.data;
      return {
        type: 'image',
        imageUrl: msg.imageUrl,
        prompt: msg.prompt,
        refImages: msg.refImages,
        x: msg.x,
        y: msg.y,
        width: msg.width,
        height: msg.height,
        status: msg.status,
        error: msg.error,
        generating: false,
        messageIndex: source.index,
        canvasSeq: msg.canvasSeq
      };
    }
  }
  return null;
}

export async function createStackFromItems(itemIds, x, y) {
  console.log('[createStackFromItems] 开始创建 stack, itemIds:', itemIds);
  const session = state.sessions[state.currentSessionId];
  if (!session || !itemIds.length) {
    console.error('[createStackFromItems] 无效会话或无选中项');
    return null;
  }

  // 从当前 canvasItems 中获取要堆叠的项数据
  const children = [];
  const itemsToRemove = [];
  for (const id of itemIds) {
    const canvasItem = state.canvasItems.find(i => i.itemId === id);
    if (!canvasItem) {
      console.warn('[createStackFromItems] 未找到 canvasItem, id:', id);
      continue;
    }
    // 复制必要字段（避免引用）
    const child = {
      imageUrl: canvasItem.imageUrl,
      prompt: canvasItem.prompt || '',
      refImages: canvasItem.refImages || [],
      x: canvasItem.x,
      y: canvasItem.y,
      width: canvasItem.width,
      height: canvasItem.height,
      status: canvasItem.status || 'ok',
      error: canvasItem.error || '',
      generating: false,
    };
    children.push(child);
    itemsToRemove.push(id);
    console.log('[createStackFromItems] 收集子项:', child.imageUrl?.slice(0, 60));
  }
  if (children.length === 0) {
    console.error('[createStackFromItems] 没有有效的子项');
    return null;
  }
  console.log('[createStackFromItems] 子项数量:', children.length);

  // 从源数据中删除这些项
  for (const id of itemsToRemove) {
    const canvasItem = state.canvasItems.find(i => i.itemId === id);
    if (canvasItem) {
      if (canvasItem.dropId) {
        const before = session.droppedImages?.length || 0;
        session.droppedImages = session.droppedImages.filter(d => d.id !== canvasItem.dropId);
        console.log(`[createStackFromItems] 从 droppedImages 删除项 ${id}, 原数量 ${before}, 现数量 ${session.droppedImages?.length}`);
      } else if (canvasItem.messageIndex >= 0) {
        const idx = canvasItem.messageIndex;
        const userIdx = idx - 1;
        console.log(`[createStackFromItems] 从 messages 删除项 ${id}, index=${idx}`);
        if (userIdx >= 0 && session.messages[userIdx]?.role === 'user') {
          session.messages.splice(userIdx, 2);
        } else {
          session.messages.splice(idx, 1);
        }
      } else {
        console.warn('[createStackFromItems] 未知类型的 canvasItem:', canvasItem);
      }
    } else {
      console.warn('[createStackFromItems] 未找到 canvasItem 用于删除:', id);
    }
  }

  // 创建堆叠组
  const stackId = generateId();
  const stack = {
    id: stackId,
    items: children,
    x: x ?? 100,
    y: y ?? 100,
    width: 300,
    height: 300
  };
  if (!session.stacks) session.stacks = [];
  session.stacks.push(stack);
  console.log('[createStackFromItems] 已添加 stack, 当前 stacks 数量:', session.stacks.length);
  saveSessions();

  // 重建画布
  console.log('[createStackFromItems] 准备重建画布');
  await rebuildCanvasFromSession();
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  console.log('[createStackFromItems] 完成, stack:', stack);
  return stack;
}

export async function addToStack(stackId, itemId) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return false;

  const stack = session.stacks?.find(s => s.id === stackId);
  if (!stack) return false;

  const itemData = getItemDataById(itemId);
  if (!itemData) return false;

  stack.items.push(itemData);
  removeItemFromSource(itemId);
  saveSessions();

  await rebuildCanvasFromSession();
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return true;
}

export async function mergeStacks(sourceStackId, targetStackId) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return false;
  if (!session.stacks) return false;

  const sourceStack = session.stacks.find(s => s.id === sourceStackId);
  const targetStack = session.stacks.find(s => s.id === targetStackId);
  if (!sourceStack || !targetStack) return false;

  targetStack.items.push(...sourceStack.items);
  session.stacks = session.stacks.filter(s => s.id !== sourceStackId);
  saveSessions();

  await rebuildCanvasFromSession();
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return true;
}

export async function removeFromStack(stackId, childIndex, targetX, targetY) {
  console.log(`[移出Stack调试] 开始移除 stackId=${stackId}, childIndex=${childIndex}`);
  const session = state.sessions[state.currentSessionId];
  if (!session) {
    console.error('[移出Stack调试] 会话不存在');
    return false;
  }

  const stack = session.stacks?.find(s => s.id === stackId);
  if (!stack) {
    console.error(`[移出Stack调试] 未找到 stack: ${stackId}`);
    return false;
  }
  if (childIndex < 0 || childIndex >= stack.items.length) {
    console.error(`[移出Stack调试] 索引无效 childIndex=${childIndex}, stack长度=${stack.items.length}`);
    return false;
  }

  const removed = stack.items.splice(childIndex, 1)[0];
  console.log(`[移出Stack调试] 已移除子项, 剩余子项数量: ${stack.items.length}, 被移除图片: ${removed.imageUrl?.slice(0, 60)}`);

  // 移出的图片作为新的 dropped image 添加到画布
  if (removed) {
    let newX, newY;
    if (typeof targetX === 'number' && typeof targetY === 'number') {
      newX = targetX;
      newY = targetY;
    } else {
      const { cx, cy } = getViewportCenter();
      newX = cx + (Math.random() * 100 - 50);
      newY = cy + (Math.random() * 100 - 50);
    }
    const dropId = generateId();
    const seq = session._canvasSeq = (session._canvasSeq || 0) + 1;
    const newDropped = {
      id: dropId,
      imageUrl: removed.imageUrl,
      dataHash: removed.dataHash || '',
      canvasSeq: seq,
      x: newX,
      y: newY,
      width: 300,
      height: 300
    };
    if (!session.droppedImages) session.droppedImages = [];
    session.droppedImages.push(newDropped);
    saveSessions();
    console.log(`[移出Stack调试] 已添加为独立画布项, dropId=${dropId}`);
  }

  // 如果堆叠组为空，删除整个堆叠组
  if (stack.items.length === 0) {
    const stackIndex = session.stacks.findIndex(s => s.id === stackId);
    if (stackIndex !== -1) {
      session.stacks.splice(stackIndex, 1);
      console.log('[移出Stack调试] 堆叠组为空，已删除整个组');
      saveSessions();
    }
  } else {
    saveSessions();
  }

  await rebuildCanvasFromSession();
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return true;
}