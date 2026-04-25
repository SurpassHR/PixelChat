import { getState, subscribe, addMaterial, removeMaterial, setState } from '../store.js';
import { $ } from '../domHelpers.js';

let lastClickedId = null;          // 用于 Shift 范围选择
let rubberBandActive = false;
let rubberBandStart = null;
let rubberBandDiv = null;

function updateSelectionHighlight() {
  const { selectedMaterialIds } = getState();
  const items = document.querySelectorAll('.material-item');
  items.forEach(item => {
    const mid = item.dataset.mid;
    if (selectedMaterialIds.includes(mid)) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

function renderMaterialList() {
  const container = $('#materialList');
  const { materials } = getState();
  console.log('[渲染素材库] materials:', materials.length, '个');
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
  updateSelectionHighlight();
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

// 辅助：获取两个 id 在 materials 数组中的索引范围
function getRangeIndices(idA, idB, materials) {
  const idxA = materials.findIndex(m => m.id === idA);
  const idxB = materials.findIndex(m => m.id === idB);
  if (idxA === -1 || idxB === -1) return [];
  const start = Math.min(idxA, idxB);
  const end = Math.max(idxA, idxB);
  const ids = [];
  for (let i = start; i <= end; i++) {
    ids.push(materials[i].id);
  }
  return ids;
}

// 处理点击选择 (Ctrl, Shift)
function handleItemClick(e, itemElement, mid) {
  e.stopPropagation();
  const { materials, selectedMaterialIds } = getState();
  const ctrlKey = e.ctrlKey || e.metaKey;
  const shiftKey = e.shiftKey;

  if (shiftKey) {
    // 范围选择
    let newSelection = [];
    if (lastClickedId && materials.find(m => m.id === lastClickedId)) {
      newSelection = getRangeIndices(lastClickedId, mid, materials);
    } else {
      newSelection = [mid];
    }
    setState({ selectedMaterialIds: newSelection });
    lastClickedId = mid;
  } else if (ctrlKey) {
    // 切换
    let newSelection;
    if (selectedMaterialIds.includes(mid)) {
      newSelection = selectedMaterialIds.filter(id => id !== mid);
    } else {
      newSelection = [...selectedMaterialIds, mid];
    }
    setState({ selectedMaterialIds: newSelection });
    lastClickedId = mid;
  } else {
    // 单选
    setState({ selectedMaterialIds: [mid] });
    lastClickedId = mid;
  }
}

// 橡皮筋选择逻辑
function startRubberBand(e) {
  if (rubberBandActive) return;
  const container = $('#materialList');
  // 确保点击在容器内，且目标不是 .material-item 及其内部元素 (除删除按钮外)
  const target = e.target;
  if (target.closest('.material-item')) return;

  rubberBandActive = true;
  rubberBandStart = { x: e.clientX, y: e.clientY };

  // 创建橡皮筋 div
  rubberBandDiv = document.createElement('div');
  rubberBandDiv.className = 'rubber-band';
  rubberBandDiv.style.position = 'absolute';
  rubberBandDiv.style.border = '1px solid var(--accent)';
  rubberBandDiv.style.backgroundColor = 'rgba(74, 111, 165, 0.1)';
  rubberBandDiv.style.pointerEvents = 'none';
  rubberBandDiv.style.zIndex = '1000';
  document.body.appendChild(rubberBandDiv);

  const onMouseMove = (moveEvent) => {
    if (!rubberBandActive) return;
    const left = Math.min(rubberBandStart.x, moveEvent.clientX);
    const top = Math.min(rubberBandStart.y, moveEvent.clientY);
    const width = Math.abs(rubberBandStart.x - moveEvent.clientX);
    const height = Math.abs(rubberBandStart.y - moveEvent.clientY);
    rubberBandDiv.style.left = left + 'px';
    rubberBandDiv.style.top = top + 'px';
    rubberBandDiv.style.width = width + 'px';
    rubberBandDiv.style.height = height + 'px';
  };

  const onMouseUp = (upEvent) => {
    if (!rubberBandActive) return;
    rubberBandActive = false;
    if (rubberBandDiv) rubberBandDiv.remove();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    const rect = {
      left: Math.min(rubberBandStart.x, upEvent.clientX),
      top: Math.min(rubberBandStart.y, upEvent.clientY),
      right: Math.max(rubberBandStart.x, upEvent.clientX),
      bottom: Math.max(rubberBandStart.y, upEvent.clientY)
    };
    // 如果矩形太小（比如只是点击），视为清除选择
    if (rect.right - rect.left < 5 && rect.bottom - rect.top < 5) {
      setState({ selectedMaterialIds: [] });
      lastClickedId = null;
      return;
    }

    // 找出所有与矩形相交的素材项
    const items = document.querySelectorAll('.material-item');
    const intersectingIds = [];
    items.forEach(item => {
      const itemRect = item.getBoundingClientRect();
      if (itemRect.right > rect.left && itemRect.left < rect.right &&
          itemRect.bottom > rect.top && itemRect.top < rect.bottom) {
        const mid = item.dataset.mid;
        if (mid) intersectingIds.push(mid);
      }
    });

    const ctrlKey = upEvent.ctrlKey || upEvent.metaKey;
    const { selectedMaterialIds } = getState();
    let newSelection;
    if (ctrlKey) {
      // Ctrl 橡皮筋：切换框内项的选中状态
      const currentSet = new Set(selectedMaterialIds);
      for (const id of intersectingIds) {
        if (currentSet.has(id)) {
          currentSet.delete(id);
        } else {
          currentSet.add(id);
        }
      }
      newSelection = Array.from(currentSet);
    } else {
      // 无修饰键：替换为框内项
      newSelection = intersectingIds;
    }
    setState({ selectedMaterialIds: newSelection });
    if (newSelection.length > 0) {
      // 更新 lastClickedId 为第一个选中项，便于下次范围选择
      lastClickedId = newSelection[0];
    } else {
      lastClickedId = null;
    }
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
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

  // 处理素材项的选择点击（使用 mousedown 避免与 dragstart 冲突）
  list.addEventListener('mousedown', e => {
    const item = e.target.closest('.material-item');
    if (item) {
      const mid = item.dataset.mid;
      handleItemClick(e, item, mid);
      // 阻止冒泡，避免触发容器的橡皮筋
      e.stopPropagation();
    }
  });

  // 橡皮筋选择（在空白区域按下）
  list.addEventListener('mousedown', startRubberBand);

  // Drag init
  initMaterialDrag();

  // 订阅素材变化
  subscribe('materials', renderMaterialList);
  // 订阅选中变化，更新高亮（无需重绘整个列表）
  subscribe('selectedMaterialIds', updateSelectionHighlight);

  // 初始渲染
  renderMaterialList();
}