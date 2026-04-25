import { generateId } from './domHelpers.js';

const STORAGE_SESSIONS = 'image-gen-sessions';
const STORAGE_ACTIVE = 'image-gen-active';
const STORAGE_MATERIALS = 'image-gen-materials';
const STORAGE_MODEL = 'image-gen-model';
const STORAGE_REUSE_PROMPT = 'image-gen-reusePrompt';
const STORAGE_REUSE_REF = 'image-gen-reuseRef';

const state = {
  sessions: {},
  currentSessionId: '',
  canvasItems: [],
  selectedItemId: null,
  refImages: [],
  reusePrompt: false,
  reuseRef: false,
  models: [],
  selectedModelId: '',
  materials: [],
  viewport: { panX: 0, panY: 0, zoom: 1 },
  statusText: '就绪',
  generating: false
};

const listeners = {};
const _abortControllers = {};

export function getState() { return state; }

export function registerAbort(placeholderId, controller) {
  _abortControllers[placeholderId] = controller;
}

export function cancelGeneration(placeholderId) {
  const ctrl = _abortControllers[placeholderId];
  if (ctrl) { ctrl.abort(); delete _abortControllers[placeholderId]; }
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
  // Persist selected model
  if ('selectedModelId' in partial) {
    localStorage.setItem(STORAGE_MODEL, partial.selectedModelId);
  }
  if ('reusePrompt' in partial) {
    localStorage.setItem(STORAGE_REUSE_PROMPT, partial.reusePrompt ? '1' : '0');
  }
  if ('reuseRef' in partial) {
    localStorage.setItem(STORAGE_REUSE_REF, partial.reuseRef ? '1' : '0');
  }
  for (const key of Object.keys(partial)) {
    if (listeners[key]) listeners[key].forEach(fn => fn());
  }
}

// --- Backend storage ---

function getStorageBase() {
  const el = document.getElementById('storageBase');
  return el ? el.value.replace(/\/+$/, '') : '';
}

let _pendingSave = null;

// Debounced backend sync (avoids duplicate save calls)
function debouncedBackendSync() {
  if (_pendingSave) return;
  _pendingSave = setTimeout(async () => {
    _pendingSave = null;
    try { await apiPost('/api/sessions', state.sessions); } catch {}
    try { await apiPost('/api/materials', state.materials); } catch {}
  }, 200);
}

// Send data to backend via fetch (async) or sendBeacon (for unload)
async function apiGet(path) {
  const base = getStorageBase();
  if (!base) throw new Error('no backend');
  const res = await fetch(base + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
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

// Upload a data URL to the backend and return a URL
async function ensureImageUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const base = getStorageBase();
    const ext = dataUrl.split(';')[0].split('/')[1] || 'png';
    const hash = await computeDataUrlHash(dataUrl);
    const { url } = await apiPost('/api/images', { data: dataUrl, ext, hash });
    return base + url;
  } catch { return dataUrl; /* fallback to data URL */ }
}

// Upload image in the background and update the item's URL
function uploadItemImage(item) {
  if (!item || !item.imageUrl || !item.imageUrl.startsWith('data:')) return;
  ensureImageUrl(item.imageUrl).then(url => {
    if (url !== item.imageUrl) {
      item.imageUrl = url;
      if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
      saveSessions();
    }
  });
}

// --- Session persistence ---

async function loadSessions() {
  let backend = null;
  let local = null;

  try {
    const remote = await apiGet('/api/sessions');
    if (remote && Object.keys(remote).length > 0) backend = remote;
  } catch (e) { console.log('[加载] 后端 sessions 不可用:', e.message); }

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_SESSIONS));
    if (parsed && Object.keys(parsed).length > 0) local = parsed;
  } catch (e) { console.log('[加载] localStorage sessions 不可用:', e.message); }

  console.log('[加载] sessions 来源:', {
    backend: backend ? `有 ${Object.keys(backend).length} 个会话, ids: ${Object.keys(backend).join(',')}` : '无',
    local: local ? `有 ${Object.keys(local).length} 个会话, ids: ${Object.keys(local).join(',')}` : '无'
  });

  if (!backend && !local) { console.log('[加载] sessions 无任何来源, 返回 {}'); return {}; }
  if (!backend) { console.log('[加载] sessions 只用 localStorage'); return local; }
  if (!local) { console.log('[加载] sessions 只用后端'); return backend; }

  // Merge per-session: prefer whichever has newer updatedAt.
  // This ensures that if pagehide sendBeacon failed (payload too large),
  // the fresher localStorage data isn't discarded for stale backend data.
  const merged = { ...backend };
  for (const [id, session] of Object.entries(local)) {
    const existing = merged[id];
    if (!existing || (session.updatedAt || 0) > (existing.updatedAt || 0)) {
      merged[id] = session;
      console.log(`[加载] 会话 ${id} 使用 localStorage 版本 (updatedAt=${session.updatedAt})`);
    } else {
      console.log(`[加载] 会话 ${id} 使用后端版本 (updatedAt=${existing.updatedAt})`);
    }
  }
  // Log any backend-only sessions
  for (const id of Object.keys(backend)) {
    if (!local[id]) console.log(`[加载] 会话 ${id} 仅在后端存在`);
  }
  console.log(`[加载] sessions 合并后共 ${Object.keys(merged).length} 个会话`);
  return merged;
}

function saveSessions() {
  // Sync to localStorage (best effort — may fail on large data)
  try { localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(state.sessions)); }
  catch { /* quota exceeded, rely on backend */ }
  // Debounced async backend sync
  debouncedBackendSync();
}

async function loadActiveId() {
  try {
    const val = await apiGet('/api/active');
    if (val) return val;
  } catch { /* backend unavailable */ }
  return localStorage.getItem(STORAGE_ACTIVE) || '';
}

function saveActiveId(id) {
  localStorage.setItem(STORAGE_ACTIVE, id);
  beaconPost('/api/active', { id });
}

// --- Session management ---

export function createSession() {
  const id = generateId();
  state.sessions[id] = {
    id,
    title: '新会话',
    createdAt: Date.now(),
    _canvasSeq: 0
  };
  saveSessions();
  switchSession(id);
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
}

export function deleteSession(id) {
  delete state.sessions[id];
  saveSessions();
  if (state.currentSessionId === id) {
    const ids = Object.keys(state.sessions);
    if (ids.length > 0) {
      switchSession(ids[ids.length - 1]);
    } else {
      createSession();
    }
  }
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
}

export function switchSession(id) {
  state.currentSessionId = id;
  saveActiveId(id);
  rebuildCanvasFromSession();
  state.selectedItemId = null;
  state.viewport = { panX: 0, panY: 0, zoom: 1 };
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());
  if (listeners['currentSessionId']) listeners['currentSessionId'].forEach(fn => fn());
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['selectedItemId']) listeners['selectedItemId'].forEach(fn => fn());
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

export function addGeneratingPlaceholder(prompt, refImages) {
  const id = generateId();
  const item = {
    itemId: 'gen-' + id,
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
  state.canvasItems.push(item);
  if (listeners['canvasItems']) listeners['canvasItems'].forEach(fn => fn());
  if (listeners['sessions']) listeners['sessions'].forEach(fn => fn());

  // Upload image to backend in the background
  uploadItemImage(item);

  return item;
}

// --- Dropped external images ---

export async function addDroppedImage(dataUrl) {
  const session = state.sessions[state.currentSessionId];
  if (!session) return null;

  // Upload image data to backend first so session payload stays small
  const savedUrl = await ensureImageUrl(dataUrl);

  const seq = session._canvasSeq = (session._canvasSeq || 0) + 1;
  session.droppedImages = session.droppedImages || [];
  const id = generateId();
  const { cx, cy } = getViewportCenter();
  const offset = state.canvasItems.length * 30;
  const x = Math.max(0, cx - 150 + offset);
  const y = Math.max(0, cy + offset);

  const img = { id, imageUrl: savedUrl, canvasSeq: seq, x, y, width: 300, height: 300 };
  session.droppedImages.push(img);
  session.updatedAt = Date.now();
  saveSessions();

  const item = {
    itemId: 'drop-' + id, messageIndex: -1, imageUrl: savedUrl, prompt: '',
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

export function rebuildCanvasFromSession() {
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
          imageUrl: msg.imageUrl,
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

  // Add dropped external images
  if (session.droppedImages) {
    session.droppedImages.forEach(img => {
      items.push({
        itemId: 'drop-' + img.id,
        messageIndex: -1,
        imageUrl: img.imageUrl,
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
        canvasSeq: img.canvasSeq
      });
    });
  }

  // Sort by canvasSeq to restore original interleaving order.
  // If any items lack canvasSeq (old sessions), keep default order (messages then drops).
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
  let backend = null;
  let local = null;

  try {
    const remote = await apiGet('/api/materials');
    if (remote && remote.length > 0) backend = remote;
  } catch (e) { console.log('[加载] 后端 materials 不可用:', e.message); }

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_MATERIALS));
    if (parsed && parsed.length > 0) local = parsed;
  } catch (e) { console.log('[加载] localStorage materials 不可用:', e.message); }

  console.log('[加载] materials 来源:', {
    backend: backend ? `${backend.length} 个` : '无',
    local: local ? `${local.length} 个` : '无'
  });

  if (!backend && !local) { console.log('[加载] materials 无任何来源'); return []; }
  if (!backend) return local;
  if (!local) return backend;

  // Merge: prefer localStorage for matching ids (freshest),
  // then append backend materials not in local
  const seen = new Set();
  const merged = [];
  for (const m of local) {
    merged.push(m);
    seen.add(m.id);
  }
  for (const m of backend) {
    if (!seen.has(m.id)) {
      merged.push(m);
      seen.add(m.id);
    }
  }
  return merged;
}

function saveMaterials() {
  try { localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(state.materials)); }
  catch { /* quota exceeded */ }
  debouncedBackendSync();
}

export async function addMaterial(name, dataUrl) {
  const hash = await computeDataUrlHash(dataUrl);
  const existing = state.materials.find(m => m.dataHash === hash);
  if (existing) {
    setState({ statusText: '素材已存在，跳过添加' });
    return existing;
  }

  // Upload image to backend first so stored data stays small
  const savedUrl = await ensureImageUrl(dataUrl);

  const mat = { id: generateId(), name, dataUrl: savedUrl, dataHash: hash, addedAt: Date.now() };
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
  state.selectedModelId = localStorage.getItem(STORAGE_MODEL) || '';
  state.reusePrompt = localStorage.getItem(STORAGE_REUSE_PROMPT) === '1';
  state.reuseRef = localStorage.getItem(STORAGE_REUSE_REF) === '1';
  const savedId = await loadActiveId();
  console.log('[初始化] sessions:', Object.keys(state.sessions).length, '个, materials:', state.materials.length, '个, 当前会话ID:', savedId);
  if (savedId && state.sessions[savedId]) {
    state.currentSessionId = savedId;
    console.log('[初始化] 存在已保存会话, 重建画布');
    rebuildCanvasFromSession();
  } else {
    console.log('[初始化] 无已保存会话, currentSessionId:', savedId, 'session存在:', !!state.sessions[savedId]);
  }

  // Flush data to backend on page unload (guaranteed delivery)
  window.addEventListener('pagehide', () => {
    const base = getStorageBase();
    if (!base) return;
    if (!navigator.sendBeacon(base + '/api/sessions', JSON.stringify(state.sessions))) {
      fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.sessions), keepalive: true }).catch(() => {});
    }
    if (!navigator.sendBeacon(base + '/api/materials', JSON.stringify(state.materials))) {
      fetch(base + '/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.materials), keepalive: true }).catch(() => {});
    }
    beaconPost('/api/active', { id: state.currentSessionId });
  });
}
