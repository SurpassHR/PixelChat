import { getState, subscribe, addMaterial, removeMaterial } from '../store.js';
import { $ } from '../domHelpers.js';

function renderMaterialList() {
  const container = $('#materialList');
  const { materials } = getState();
  console.log('[渲染素材库] materials:', materials.length, '个');
  materials.forEach((m, i) => console.log(`  [${i}] id=${m.id} name=${m.name} dataUrl=${m.dataUrl ? m.dataUrl.slice(0, 60) + '...' : '无'}`));
  if (materials.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text2);font-size:13px;padding:8px;text-align:center;">暂无素材</div>';
    return;
  }
  container.innerHTML = materials
    .map(m =>
      `<div class="material-item" data-mid="${m.id}" draggable="true">
        <img src="${m.dataUrl}" alt="${m.name}" title="${m.name}">
        <button class="mat-remove" data-mid="${m.id}">×</button>
      </div>`
    )
    .join('');
}

function initMaterialDrag() {
  const list = $('#materialList');
  list.addEventListener('dragstart', e => {
    const item = e.target.closest('.material-item');
    if (!item) return;
    const mid = item.dataset.mid;
    const { materials } = getState();
    const mat = materials.find(m => m.id === mid);
    if (mat) {
      e.dataTransfer.setData('application/json', JSON.stringify({
        name: mat.name,
        dataUrl: mat.dataUrl
      }));
      e.dataTransfer.effectAllowed = 'copy';
    }
  });
}

function handleFileInput(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      addMaterial(file.name, ev.target.result);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

export function initMaterialLibrary() {
  // File input
  const fileInput = $('#materialFileInput');
  fileInput.addEventListener('change', handleFileInput);

  // Add button triggers file input
  $('#addMaterialBtn').addEventListener('click', () => fileInput.click());

  // Remove button delegation
  const list = $('#materialList');
  list.addEventListener('click', e => {
    const btn = e.target.closest('.mat-remove');
    if (btn) {
      e.stopPropagation();
      removeMaterial(btn.dataset.mid);
    }
  });

  // Drag init
  initMaterialDrag();

  // Subscribe
  subscribe('materials', renderMaterialList);

  // Initial render (state.materials was set directly in initStore, not via setState)
  renderMaterialList();
}
