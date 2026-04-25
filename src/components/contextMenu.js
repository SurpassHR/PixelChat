import { getState, setState, addMaterial, removeCanvasItemById, removeMaterial } from '../store.js';
import { $, $$ } from '../domHelpers.js';
import { openPromptHistory } from './modal.js';

const menu = $('#contextMenu');
let currentContext = null;
let currentData = null;

function showMenu(e, context, data) {
  e.preventDefault();
  currentContext = context;
  currentData = data;

  $$('.menu-item', menu).forEach(el => {
    el.classList.toggle('hidden', el.dataset.ctx !== context);
  });
  $$('.menu-divider', menu).forEach(el => {
    el.classList.toggle('hidden', el.dataset.ctx !== context);
  });

  const rect = menu.getBoundingClientRect();
  let x = e.clientX;
  let y = e.clientY;
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('active');
}

function hideMenu() {
  menu.classList.remove('active');
  currentContext = null;
  currentData = null;
}

function handleAction(action) {
  switch (action) {
    case 'addMaterial': {
      const { canvasItems } = getState();
      const item = canvasItems.find(i => i.itemId === currentData?.itemId);
      if (item && item.imageUrl) {
        addMaterial('画布图片', item.imageUrl);
      }
      break;
    }
    case 'copyPrompt': {
      const { canvasItems } = getState();
      const item = canvasItems.find(i => i.itemId === currentData?.itemId);
      if (item && item.prompt) {
        navigator.clipboard.writeText(item.prompt).catch(() => {});
      }
      break;
    }
    case 'download': {
      const { canvasItems } = getState();
      const item = canvasItems.find(i => i.itemId === currentData?.itemId);
      if (item && item.imageUrl) {
        const a = document.createElement('a');
        a.href = item.imageUrl;
        a.download = 'image.png';
        a.target = '_blank';
        a.click();
      }
      break;
    }
    case 'deleteImage': {
      const id = currentData?.itemId;
      if (id) removeCanvasItemById(id);
      break;
    }
    case 'addRef': {
      const { materials } = getState();
      const mat = materials.find(m => m.id === currentData?.materialId);
      if (mat) {
        const refs = getState().refImages;
        refs.push({ name: mat.name, dataUrl: mat.dataUrl });
        setState({ refImages: [...refs] });
      }
      break;
    }
    case 'downloadMat': {
      const { materials } = getState();
      const mat = materials.find(m => m.id === currentData?.materialId);
      if (mat) {
        const a = document.createElement('a');
        a.href = mat.dataUrl;
        a.download = mat.name || 'material.png';
        a.click();
      }
      break;
    }
    case 'removeMaterial': {
      if (currentData?.materialId) removeMaterial(currentData.materialId);
      break;
    }
    case 'promptHistory': {
      openPromptHistory();
      break;
    }
    case 'clearCanvas': {
      const items = [...getState().canvasItems];
      items.forEach(item => removeCanvasItemById(item.itemId));
      break;
    }
  }
  hideMenu();
}

export function initContextMenu() {
  document.addEventListener('contextmenu', e => {
    const itemEl = e.target.closest('.canvas-item');
    if (itemEl && itemEl.dataset.itemId) {
      showMenu(e, 'canvas-image', { itemId: itemEl.dataset.itemId });
      return;
    }

    const matEl = e.target.closest('.material-item');
    if (matEl && matEl.dataset.mid) {
      showMenu(e, 'material', { materialId: matEl.dataset.mid });
      return;
    }

    if (e.target.closest('.canvas-container') || e.target.closest('.canvas-surface') || e.target.closest('.canvas-placeholder')) {
      showMenu(e, 'canvas-empty', {});
      return;
    }
  });

  menu.addEventListener('click', e => {
    const item = e.target.closest('.menu-item');
    if (item && item.dataset.action) {
      handleAction(item.dataset.action);
    }
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) hideMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideMenu();
  });

  menu.addEventListener('contextmenu', e => e.preventDefault());
}
