import { generateId } from './domHelpers.js';

const state = {
  sessions: {},
  currentSessionId: '',
  canvasItems: [],
  selectedItemIds: [],
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

function _cleanupResolvedUrls() {}

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
    cancelBackendTask(item.taskId).catch(() => {});
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

// --- Provider management ---

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

// --- Backend storage ---

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
    try { await apiPost('/api/sessions', sanitizeForSave(state.sessions)); } catch {}
    try { await apiPost('/api/materials', sanitizeForSave(state.materials)); } catch {}
    try {
      await apiPost('/api/settings', {
        selectedModelId: state.selectedModelId,
        selectedProvider: state.selectedProvider,
        providers: state.providers,
        reusePrompt: state.reusePrompt,
        reuseRef: state.reuseRef,
        batchSize: state.batchSize
      });
    } catch {}
  }, 200);
}

// Send data to backend via fetch (async) or sendBeacon (for unload)
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

// Strip .ext from backend image API URLs (legacy cleanup)
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
    }).catch(() => {});
  }
}

async function loadSessions() {
  try {
    const remote = await apiGet('/api/sessions');
    if (remote && Object.keys(remote).length > 0) {
      console.log('[加载] sessions 从后端加载:', Object.keys(remote).length, '个');
      return remote;
    }
  } catch (e) { console.log('[加载] 后端 sessions 不可用:', e.message); }
  return {};
}

function saveSessions() {
  debouncedBackendSync();
}

async function loadActiveId() {
  try {
    const val = await apiGet('/api/active');
    if (val) return val;
  } catch (e) { console.log('[加载] 后端 active 不可用:', e.message); }
  return '';
}

function saveActiveId(id) {
  beaconPost('/api/active', { id });
}

// --- Session management ---

export async function createSession() {
  const id = generateId();
  state.sessions[id] = {
    id,
    title: '新会话',
    createdAt: Date.now(),
    _canvasSeq: 0
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
  state.viewport = { panX: 0, panY: 0, zoom: 1 };
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['currentSessionId']) listeners['currentSessionId'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['selectedItemIds']) listeners['selectedItemIds'].forEach(fn => fn());
  if (listeners['viewport']) listeners['viewport'].forEach(fn => fn());
}

export async function appendMessage(msg) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  // Upload reference images to backend first so session data stays small
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

// --- Canvas item management ---

function getViewportCenter() {
  const container = document.getElementById('canvasContainer');
  if (!container) return { cx: 200, cy: 200 };
  const vp = state.viewport;
  return {
    cx: (container.clientWidth / 2 - vp.panX) / vp.zoom,
    cy: (container.clientHeight / 2 - vp.panY) / vp.zoom
  };
}

// --- Generating placeholders ---

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
    error: ''
  };
  state.canvasItems.push(item);
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  return item;
}

export async function addResultToCanvas({ status, imageUrl, prompt, refImages, error, placeholderId }) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  // Upload refImages to backend first so session data stays small
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

  // Remove the generating placeholder for this generation
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
    error: error || ''
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

// --- Dropped external images ---

export async function addDroppedImage(dataUrl) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  // Upload image data to backend first so session payload stays small
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
    itemId: 'drop-' + id, messageIndex: -1, imageUrl: displayUrl || savedUrl, prompt: '',
    refImages: [], x, y, width: 300, height: 300,
    generating: false, status: 'ok', error: '', dropId: id
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
  }
}

export function removeCanvasItemById(itemId) {
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
  }

  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
}

export async function rebuildCanvasFromSession() {
  state.canvasItems = [];
  const session = state.sessions[state.currentSessionId];
  if (!session || !session.messages) {
    console.log('[重建画布] 无当前会话或会话无消息, session:', !!session, 'messages:', !!session?.messages);
    return;
  }

  console.log('[重建画布] 当前会话:', session.id, '标题:', session.title,
    '消息数:', session.messages.length,
    'droppedImages:', session.droppedImages?.length || 0);

  session.messages.forEach((msg, i) => {
    if (msg.role === 'assistant') {
      console.log(`[重建画布] 消息[${i}] role=${msg.role} status=${msg.status} canvasSeq=${msg.canvasSeq} imageUrl=${msg.imageUrl ? msg.imageUrl.slice(0, 80) + '...' : '无'}`);
    }
  });

  const items = [];
  let lastUserMsg = null;

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
          canvasSeq: msg.canvasSeq
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
          canvasSeq: msg.canvasSeq
        });
      }
    }
  });

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
        canvasSeq: img.canvasSeq
      });
    });
  }

  // Sort by canvasSeq
  if (items.length > 0 && items.every(it => it.canvasSeq != null)) {
    items.sort((a, b) => a.canvasSeq - b.canvasSeq);
  }

  state.canvasItems = items;
  console.log('[重建画布] 完成, canvasItems:', items.length, '个, 顺序:', items.map(it => `${it.itemId}(seq=${it.canvasSeq})`).join(', '));
}

// --- Materials ---

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
  saveMaterials();
  if (listeners['materials']) listeners['materials'].forEach(fn => fn());
}

// --- Init ---

export async function initStore() {
  state.sessions = await loadSessions();
  state.materials = await loadMaterials();
  const settings = await loadSettings();
  state.selectedModelId = settings.selectedModelId || '';
  state.selectedProvider = settings.selectedProvider || '';
  state.providers = settings.providers || {};
  rebuildModels();
  state.reusePrompt = settings.reusePrompt === true;
  state.reuseRef = settings.reuseRef === true;
  state.batchSize = settings.batchSize || 1;
  const savedId = await loadActiveId();
  console.log('[初始化] sessions:', Object.keys(state.sessions).length, '个, materials:', state.materials.length, '个, 当前会话ID:', savedId);

  if (savedId && state.sessions[savedId]) {
    state.currentSessionId = savedId;
    console.log('[初始化] 存在已保存会话, 重建画布');
    await rebuildCanvasFromSession();
  } else {
    const ids = Object.keys(state.sessions);
    if (ids.length > 0) {
      const fallbackId = ids[ids.length - 1];
      state.currentSessionId = fallbackId;
      saveActiveId(fallbackId);
      console.log('[初始化] active 缺失，使用最近会话重建画布:', fallbackId);
      await rebuildCanvasFromSession();
    } else {
      console.log('[初始化] 无已保存会话, currentSessionId:', savedId, 'session存在:', !!state.sessions[savedId]);
    }
  }

  window.addEventListener('pagehide', () => {
    const base = getStorageBase();
    if (!base) return;

    const sessionsPayload = JSON.stringify(sanitizeForSave(state.sessions));
    if (!navigator.sendBeacon(base + '/api/sessions', sessionsPayload)) {
      fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sessionsPayload, keepalive: true }).catch(() => {});
    }

    const materialsPayload = JSON.stringify(sanitizeForSave(state.materials));
    if (!navigator.sendBeacon(base + '/api/materials', materialsPayload)) {
      fetch(base + '/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: materialsPayload, keepalive: true }).catch(() => {});
    }

    const settingsPayload = JSON.stringify({
      selectedModelId: state.selectedModelId,
      selectedProvider: state.selectedProvider,
      providers: state.providers,
      reusePrompt: state.reusePrompt,
      reuseRef: state.reuseRef,
      batchSize: state.batchSize
    });
    if (!navigator.sendBeacon(base + '/api/settings', settingsPayload)) {
      fetch(base + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: settingsPayload, keepalive: true }).catch(() => {});
    }

    beaconPost('/api/active', { id: state.currentSessionId });
  });
}

// ============================================================
// Task Queue API
// ============================================================

const STORAGE = () => import.meta.env.VITE_STORAGE_BASE || 'http://127.0.0.1:5001';

export async function submitTask({ prompt, model, provider, refs }) {
  const base = STORAGE();
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, provider, refs })
  });
  if (!res.ok) throw new Error(`submitTask HTTP ${res.status}`);
  return res.json();
}

export async function fetchTasks() {
  const base = STORAGE();
  try {
    const res = await fetch(`${base}/api/tasks`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function cancelBackendTask(taskId) {
  const base = STORAGE();
  const res = await fetch(`${base}/api/tasks/${taskId}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`cancelTask HTTP ${res.status}`);
  return res.json();
}
