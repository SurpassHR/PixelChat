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
  materials: [],
  viewport: { panX: 0, panY: 0, zoom: 1 },
  statusText: '就绪',
  generating: false,
  batchSize: 1
};

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
  if ('selectedModelId' in partial || 'selectedProvider' in partial || 'reusePrompt' in partial || 'reuseRef' in partial || 'batchSize' in partial) {
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
    try { await apiPost('/api/materials', sanitizeForSave(state.materials)); } catch { }
    try {
      await apiPost('/api/settings', {
        selectedModelId: state.selectedModelId,
        selectedProvider: state.selectedProvider,
        providers: state.providers,
        reusePrompt: state.reusePrompt,
        reuseRef: state.reuseRef,
        batchSize: state.batchSize
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
    error: '',
    type: 'image'
  };
  state.canvasItems.push(item);
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
    state.canvasItems = state.canvasItems.filter(it => it.itemId !== placeholderId);
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

async function loadMaterials() {
  try {
    const remote = await apiGet('/api/materials');
    if (remote && remote.length > 0) {
      remote.forEach(m => { if (m.dataUrl) m.dataUrl = resolveBackendUrl(m.dataUrl); });
      console.log('[加载] materials 从后端加载:', remote.length, '个');
      return remote;
    }
  } catch (e) { console.log('[加载] 后端 materials 不可用:', e.message); }
  return [];
}

function saveMaterials() {
  debouncedBackendSync();
}

export async function addMaterial(name, dataUrl) {
  const hash = await computeDataUrlHash(dataUrl);
  const existing = state.materials.find(m => m.dataHash === hash);
  if (existing) {
    setState({ statusText: '素材已存在，跳过添加' });
    return existing;
  }

  const savedUrl = await ensureImageUrl(dataUrl);
  const mat = { id: generateId(), name, dataUrl: resolveBackendUrl(savedUrl), dataHash: hash, addedAt: Date.now() };
  state.materials.push(mat);
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  return mat;
}

export function removeMaterial(id) {
  state.materials = state.materials.filter(m => m.id !== id);
  // Remove from selectedMaterialIds as well
  state.selectedMaterialIds = state.selectedMaterialIds.filter(selectedId => selectedId !== id);
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
  if (listeners['selectedMaterialIds']) listeners['selectedMaterialIds'].forEach(fn => fn());
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

// --------------------------------------------------------------
// 初始化存储（从后端加载数据）
// --------------------------------------------------------------
export async function initStore() {
  const [sessions, materials, settings, activeId] = await Promise.all([
    loadSessions(),
    loadMaterials(),
    loadSettings(),
    loadActiveId()
  ]);
  
  if (sessions && Object.keys(sessions).length > 0) {
    state.sessions = sessions;
  }
  if (materials && materials.length > 0) {
    state.materials = materials;
  }
  if (settings) {
    if (settings.selectedModelId !== undefined) state.selectedModelId = settings.selectedModelId;
    if (settings.selectedProvider !== undefined) state.selectedProvider = settings.selectedProvider;
    if (settings.providers !== undefined) state.providers = settings.providers;
    if (settings.reusePrompt !== undefined) state.reusePrompt = settings.reusePrompt;
    if (settings.reuseRef !== undefined) state.reuseRef = settings.reuseRef;
    if (settings.batchSize !== undefined) state.batchSize = settings.batchSize;
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
  
  // 如果有当前会话，重建画布（恢复画布项）
  if (state.currentSessionId) {
    await rebuildCanvasFromSession();
  }
  
  // 通知所有监听器状态已更新
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['currentSessionId']) listeners['currentSessionId'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
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

export async function removeFromStack(stackId, childIndex) {
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
    const { cx, cy } = getViewportCenter();
    const newX = cx + (Math.random() * 100 - 50);
    const newY = cy + (Math.random() * 100 - 50);
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