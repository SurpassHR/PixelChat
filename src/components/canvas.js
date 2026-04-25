import { getState, setState, subscribe, addDroppedImage, cancelGeneration } from '../store.js';
import { $$ } from '../domHelpers.js';
import { openImageDetail } from './modal.js';
import { showToast } from '../toast.js';

const container = document.getElementById('canvasContainer');
const surface = document.getElementById('canvasSurface');
const placeholder = document.getElementById('canvasPlaceholder');

// --- Render ---

export function renderCanvas() {
  const { canvasItems, selectedItemIds } = getState();

  console.log('[渲染画布] canvasItems:', canvasItems.length, '个');
  canvasItems.forEach((it, i) => console.log(`  [${i}] itemId=${it.itemId} status=${it.status} generating=${it.generating} imageUrl=${it.imageUrl ? it.imageUrl.slice(0, 60) + '...' : '无'}`));

  surface.innerHTML = '';

  if (canvasItems.length === 0) {
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');

  canvasItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'canvas-item' +
      (selectedItemIds.includes(item.itemId) ? ' selected' : '') +
      (item.generating ? ' generating' : '');
    el.dataset.itemId = item.itemId;
    el.draggable = true;

    if (item.generating) {
      el.innerHTML =
        '<div class="gen-shimmer"></div>' +
        '<div class="gen-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>' +
        '<div class="gen-label">正在生成...</div>' +
        '<div class="gen-progress"><div class="gen-progress-bar"></div></div>' +
        '<button class="gen-cancel" data-item-id="' + item.itemId + '" title="取消生成">×</button>';
    } else if (item.status === 'ok') {
      el.innerHTML = `<img src="${item.imageUrl}" alt="生成图片">`;
      const label = document.createElement('div');
      label.className = 'item-label';
      label.textContent = item.prompt ? item.prompt.slice(0, 60) + (item.prompt.length > 60 ? '…' : '') : '';
      el.appendChild(label);
    } else if (item.status === 'error') {
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.fontSize = '12px';
      el.style.color = 'var(--danger)';
      el.style.background = 'var(--surface2)';
      el.style.width = '200px';
      el.style.height = '200px';
      el.textContent = item.error ? '失败: ' + item.error : '生成失败';
    }

    surface.appendChild(el);
  });
}

// --- Multi-selection state ---

let _lastClickedIndex = -1;

// --- Rubber band ---

let _rubberBanding = false;
let _rubberBandStart = null;
let _rubberBandEl = null;

function rectsIntersect(r1, r2) {
  return !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top);
}

function endRubberBand() {
  if (!_rubberBandEl) return;
  _rubberBanding = false;

  const rect = _rubberBandEl.getBoundingClientRect();
  _rubberBandEl.remove();
  _rubberBandEl = null;

  const ids = [];
  $$('.canvas-item').forEach(el => {
    if (rectsIntersect(rect, el.getBoundingClientRect())) {
      ids.push(el.dataset.itemId);
    }
  });

  if (ids.length > 0) {
    setState({ selectedItemIds: ids });
  }
}

// --- Event handlers ---

function onDblClick(e) {
  const itemEl = e.target.closest('.canvas-item');
  if (!itemEl) return;
  const id = itemEl.dataset.itemId;
  const item = getState().canvasItems.find(i => i.itemId === id);
  if (item && item.status === 'ok') {
    openImageDetail(item);
  }
}

function onMouseDown(e) {
  // End any previous rubber band
  if (_rubberBandEl) {
    endRubberBand();
    return;
  }

  const itemEl = e.target.closest('.canvas-item');

  if (itemEl) {
    if (e.button !== 0) return;

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle
      const ids = [...getState().selectedItemIds];
      const idx = ids.indexOf(itemEl.dataset.itemId);
      if (idx >= 0) ids.splice(idx, 1);
      else ids.push(itemEl.dataset.itemId);
      setState({ selectedItemIds: ids });
      // Don't update _lastClickedIndex
    } else if (e.shiftKey) {
      // Shift+click: range select (add to current selection)
      const items = getState().canvasItems;
      const currentIdx = items.findIndex(i => i.itemId === itemEl.dataset.itemId);
      if (currentIdx >= 0) {
        const anchor = _lastClickedIndex >= 0 ? _lastClickedIndex : currentIdx;
        const [start, end] = currentIdx > anchor ? [anchor, currentIdx] : [currentIdx, anchor];
        const ids = [...getState().selectedItemIds];
        for (let i = start; i <= end; i++) {
          if (!ids.includes(items[i].itemId)) ids.push(items[i].itemId);
        }
        setState({ selectedItemIds: ids });
      }
      // Don't update _lastClickedIndex
    } else {
      // Plain click: select just this one
      setState({ selectedItemIds: [itemEl.dataset.itemId] });
      _lastClickedIndex = getState().canvasItems.findIndex(i => i.itemId === itemEl.dataset.itemId);
    }
    return;
  }

  // Click on empty area - only left click
  if (e.button !== 0) return;

  // Deselect all
  setState({ selectedItemIds: [] });

  // Start rubber band
  _rubberBanding = true;
  _rubberBandStart = { x: e.clientX, y: e.clientY };

  _rubberBandEl = document.createElement('div');
  _rubberBandEl.className = 'rubber-band';
  _rubberBandEl.style.left = e.clientX + 'px';
  _rubberBandEl.style.top = e.clientY + 'px';
  _rubberBandEl.style.width = '0px';
  _rubberBandEl.style.height = '0px';
  document.body.appendChild(_rubberBandEl);

  e.preventDefault();
}

function onMouseMove(e) {
  if (!_rubberBanding || !_rubberBandEl || !_rubberBandStart) return;

  const dx = e.clientX - _rubberBandStart.x;
  const dy = e.clientY - _rubberBandStart.y;
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

  const x1 = _rubberBandStart.x;
  const y1 = _rubberBandStart.y;
  const x2 = e.clientX;
  const y2 = e.clientY;

  _rubberBandEl.style.left = Math.min(x1, x2) + 'px';
  _rubberBandEl.style.top = Math.min(y1, y2) + 'px';
  _rubberBandEl.style.width = Math.abs(x2 - x1) + 'px';
  _rubberBandEl.style.height = Math.abs(y2 - y1) + 'px';
}

function onMouseUp(e) {
  if (_rubberBanding && _rubberBandEl) {
    endRubberBand();
  }
}

// --- Keyboard paste ---

export async function handlePasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    let pasted = 0;
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await addDroppedImage(dataUrl);
        pasted++;
      }
    }
    if (pasted > 0) {
      setState({ statusText: `已粘贴 ${pasted} 张图片` });
    } else {
      showToast('剪贴板中没有图片', 'error');
    }
  } catch (err) {
    showToast('无法读取剪贴板: ' + err.message, 'error');
  }
}
// --- Drag image to prompt area as reference (HTML5 DnD) ---

function setupItemDrag() {
  surface.addEventListener('dragstart', e => {
    const itemEl = e.target.closest('.canvas-item');
    if (!itemEl) return;
    const id = itemEl.dataset.itemId;
    const item = getState().canvasItems.find(i => i.itemId === id);
    if (!item || !item.imageUrl) return;

    e.dataTransfer.setData('application/json', JSON.stringify({
      name: '画布图片: ' + (item.prompt ? item.prompt.slice(0, 30) : ''),
      dataUrl: item.imageUrl
    }));
    e.dataTransfer.effectAllowed = 'copy';
  });
}

// --- External image drop ---

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageViaElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('load failed'));
    img.src = url;
  });
}

function setupExternalDrop() {
  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Don't show blue indicator for internal canvas item drags (drag to prompt area)
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes('application/json')) {
      container.classList.add('drag-over-surf');
    }
  });

  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('drag-over-surf');
    }
  });

  container.addEventListener('drop', async e => {
    e.preventDefault();
    container.classList.remove('drag-over-surf');

    try {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            const dataUrl = await fileToDataUrl(file);
            addDroppedImage(dataUrl);
          }
        }
        setState({ statusText: '已添加图片到画布' });
        return;
      }

      const dt = e.dataTransfer;
      let imageUrl = null;

      for (const fmt of ['text/plain', 'text/uri-list', 'text/html']) {
        try {
          const val = dt.getData(fmt);
          if (val) {
            const htmlSrc = val.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (htmlSrc) { imageUrl = htmlSrc[1]; break; }
            const urlMatch = val.match(/(https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg)[^\s"'<>]*)/i)
                         || val.match(/(data:image\/[^;]+;base64,[^\s"'<>]+)/i)
                         || val.match(/(file:\/\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg))/i);
            if (urlMatch) { imageUrl = urlMatch[1]; break; }
          }
        } catch { /* skip */ }
      }

      if (imageUrl) {
        let dataUrl = imageUrl;
        if (imageUrl.startsWith('http')) {
          try {
            const res = await fetch(imageUrl);
            dataUrl = await fileToDataUrl(await res.blob());
          } catch {
            setState({ statusText: '无法加载外部图片 (CORS)' }); return;
          }
        } else if (imageUrl.startsWith('file://')) {
          try {
            const res = await fetch(imageUrl);
            dataUrl = await fileToDataUrl(await res.blob());
          } catch {
            try { dataUrl = await loadImageViaElement(imageUrl); }
            catch { setState({ statusText: '无法加载文件，请直接从文件管理器拖入' }); return; }
          }
        }
        addDroppedImage(dataUrl);
        setState({ statusText: '已添加外部图片' });
      }
    } catch (err) {
      setState({ statusText: '拖入失败: ' + err.message });
    }
  });
}

// --- Init ---

export function initCanvas() {
  container.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  container.addEventListener('dblclick', onDblClick);

  // Cancel generation button
  container.addEventListener('click', e => {
    const btn = e.target.closest('.gen-cancel');
    if (btn && btn.dataset.itemId) {
      cancelGeneration(btn.dataset.itemId);
    }
  });

  // Keyboard paste (Ctrl+V / Cmd+V)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      handlePasteFromClipboard();
    }
  });

  setupItemDrag();
  setupExternalDrop();

  subscribe('canvasItems', renderCanvas);
  subscribe('selectedItemIds', () => {
    const ids = getState().selectedItemIds;
    $$('.canvas-item').forEach(el => {
      el.classList.toggle('selected', ids.includes(el.dataset.itemId));
    });
  });

  renderCanvas();
}
