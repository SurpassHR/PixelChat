import { getState, setState, subscribe, addDroppedImage, cancelGeneration } from '../store.js';
import { $, $$ } from '../domHelpers.js';
import { openImageDetail } from './modal.js';

const container = document.getElementById('canvasContainer');
const surface = document.getElementById('canvasSurface');
const placeholder = document.getElementById('canvasPlaceholder');

// --- Render ---

export function renderCanvas() {
  const { canvasItems, selectedItemId } = getState();

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
      (item.itemId === selectedItemId ? ' selected' : '') +
      (item.generating ? ' generating' : '');
    el.dataset.itemId = item.itemId;
    el.draggable = true;

    if (item.generating) {
      el.innerHTML = '<div class="gen-dots"><span class="gen-dot"></span><span class="gen-dot"></span><span class="gen-dot"></span></div><button class="gen-cancel" data-item-id="' + item.itemId + '" title="取消生成">×</button>';
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
  const itemEl = e.target.closest('.canvas-item');
  if (itemEl) {
    setState({ selectedItemId: itemEl.dataset.itemId });
    return;
  }
  // Click on empty area: deselect
  setState({ selectedItemId: null });
}

// Drag image to prompt area as reference (HTML5 DnD)
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
  container.addEventListener('dblclick', onDblClick);

  // Cancel generation button
  container.addEventListener('click', e => {
    const btn = e.target.closest('.gen-cancel');
    if (btn && btn.dataset.itemId) {
      cancelGeneration(btn.dataset.itemId);
    }
  });

  setupItemDrag();
  setupExternalDrop();

  subscribe('canvasItems', renderCanvas);
  subscribe('selectedItemId', () => {
    $$('.canvas-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.itemId === getState().selectedItemId);
    });
  });

  renderCanvas();
}
