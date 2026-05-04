import { getState, setState, subscribe, addDroppedImage, cancelGeneration, createStackFromItems, addToStack, removeFromStack, mergeStacks, removeCanvasItemById } from '../store.js';
import { $$ } from '../domHelpers.js';
import { openImageDetail } from './modal.js';
import { showToast } from '../toast.js';

// 图片模糊状态 (Ctrl+H / Cmd+H 切换)
function applyImageBlurState(value) {
  const v = !!value;
  surface.classList.toggle('images-blurred', v);
  document.body.classList.toggle('images-blurred', v);
}

function restoreImageBlurState() {
  applyImageBlurState(!!getState().imagesBlurred);
}

// 展开状态
let _expandedStackId = null;        // 当前展开的 stack ID
let _expandedItems = [];            // 展开时临时生成的 canvasItems
let _originalStackItem = null;      // 被展开的原始 stack 项（用于折叠恢复）

// 将展开状态暴露到全局，供 contextMenu 使用
window.__expandedStackId = _expandedStackId;
window.__expandedItems = _expandedItems;

const container = document.getElementById('canvasContainer');
const surface = document.getElementById('canvasSurface');
const placeholder = document.getElementById('canvasPlaceholder');

// --- 计时器更新 ---
let _timerInterval = null;

function updateTimers() {
  const { canvasItems } = getState();
  // 仅当有生成中的项时才更新
  const hasGenerating = canvasItems.some(item => item.generating === true);
  if (!hasGenerating) {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
    return;
  }

  const now = Date.now();
  const timerElements = document.querySelectorAll('.gen-timer');
  timerElements.forEach(el => {
    const itemId = el.dataset.itemId;
    if (!itemId) return;
    const item = canvasItems.find(i => i.itemId === itemId);
    if (!item || !item.startTime) return;
    const elapsed = Math.floor((now - item.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    el.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });
}

function startTimerUpdates() {
  if (_timerInterval) return;
  _timerInterval = setInterval(() => {
    updateTimers();
  }, 1000);
}

// 停止所有计时器（用于页面卸载）
function stopTimerUpdates() {
  if (_timerInterval) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
}

// --- Render ---

export function renderCanvas() {
  const { canvasItems, selectedItemIds } = getState();

  console.log('[渲染画布] canvasItems:', canvasItems.length, '个');
  canvasItems.forEach((it, i) => {
    console.log(`  [${i}] itemId=${it.itemId} type=${it.type} status=${it.status} generating=${it.generating} imageUrl=${it.imageUrl ? it.imageUrl.slice(0, 60) + '...' : '无'}`);
    // 调试：打印完整对象以排查 type 问题
    if (it.type !== 'stack' && it.itemId.startsWith('stack-')) {
      console.warn(`  警告: 项 ${it.itemId} 的 type 不是 'stack'，实际为`, it.type);
    }
  });

  surface.innerHTML = '';

  if (canvasItems.length === 0 && !_expandedStackId) {
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');

  // 如果处于展开模式，则渲染临时 items
  let itemsToRender = canvasItems;
  if (_expandedStackId) {
    itemsToRender = _expandedItems;
  }

  itemsToRender.forEach(item => {
    const el = document.createElement('div');
    // 展开模式下的临时项添加额外类
    let extraClass = '';
    let isTempExpanded = false;
    if (_expandedStackId && item._tempParentStackId === _expandedStackId) {
      extraClass = ' temp-expanded-item';
      isTempExpanded = true;
    }
    el.className = 'canvas-item' +
      (selectedItemIds.includes(item.itemId) ? ' selected' : '') +
      (item.generating ? ' generating' : '') +
      (item.type === 'stack' ? ' stack-item' : '') +
      extraClass;
    el.dataset.itemId = item.itemId;
    if (isTempExpanded) {
      el.dataset.tempStackId = _expandedStackId;
      // 从原始 stack 中查找子项索引
      const stackItem = _originalStackItem;
      if (stackItem && stackItem.items) {
        const childIndex = stackItem.items.findIndex(child => child.imageUrl === item.imageUrl);
        if (childIndex !== -1) {
          el.dataset.childIndex = childIndex;
        }
      }
    }
    el.draggable = !item.generating;

    if (item.generating) {
      const hasThinking = item.thinking && item.thinking.length > 0;

      // 从 thinking 文本中提取进度百分比
      let progressPercent = null;
      if (hasThinking) {
        const match = item.thinking.match(/生成进度[:\s]*(\d+)%/) || item.thinking.match(/\b(\d+)%\b/);
        if (match) {
          progressPercent = parseInt(match[1], 10);
        }
      }

      let labelText;
      if (progressPercent !== null) {
        labelText = '生成中 ' + progressPercent + '%';
      } else if (hasThinking) {
        labelText = '思考中...';
      } else {
        labelText = '正在生成...';
      }

      let progressClass = 'gen-progress-bar';
      let progressStyle = '';
      if (progressPercent !== null) {
        progressClass += ' gen-progress-bar-determined';
        progressStyle = ' style="width:' + progressPercent + '%"';
      }

      el.innerHTML =
        '<div class="gen-shimmer"></div>' +
        '<div class="gen-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>' +
        '<div class="gen-label">' + labelText + '</div>' +
        (hasThinking ? '<div class="gen-thinking"></div>' : '') +
        '<div class="gen-progress"><div class="' + progressClass + '"' + progressStyle + '></div></div>' +
        '<button class="gen-cancel" data-item-id="' + item.itemId + '" title="取消生成">×</button>' +
        '<div class="gen-timer" data-item-id="' + item.itemId + '">00:00</div>';
      // 用 textContent 设置 thinking 文本，避免 XSS
      if (hasThinking) {
        const thinkingEl = el.querySelector('.gen-thinking');
        if (thinkingEl) {
          const lines = item.thinking.split('\n').filter(l => l.trim());
          thinkingEl.textContent = lines.length ? lines[lines.length - 1] : '';
        }
      }
    } else if (item.status === 'ok') {
      if (item.type === 'stack') {
        // 渲染堆叠组
        const count = item.count || (item.items ? item.items.length : 0);
        el.innerHTML = `
          <img src="${item.thumbnail || item.items[0].imageUrl}" alt="堆叠组">
          <div class="stack-badge">+${count - 1}</div>
        `;
        const label = document.createElement('div');
        label.className = 'item-label';
        label.textContent = `堆叠组 (${count} 张)`;
        el.appendChild(label);
      } else {
        el.innerHTML = `<img src="${item.imageUrl}" alt="生成图片">`;
        const label = document.createElement('div');
        label.className = 'item-label';
        label.textContent = item.prompt ? item.prompt.slice(0, 60) + (item.prompt.length > 60 ? '…' : '') : '';
        el.appendChild(label);
      }
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

    // 捕获已完成图像的自然分辨率
    if (item.status === 'ok' && item.type !== 'stack' && !item.resolution) {
      const img = el.querySelector('img');
      if (img) {
        img.addEventListener('load', () => {
          if (img.naturalWidth && img.naturalHeight) {
            item.resolution = { width: img.naturalWidth, height: img.naturalHeight };
          }
        }, { once: true });
      }
    }
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
    console.log('[选中调试] 框选结束, 选中图片 IDs:', ids);
    setState({ selectedItemIds: ids });
  } else {
    console.log('[选中调试] 框选结束, 未选中任何图片');
  }
}

// --- Event handlers ---

function onDblClick(e) {
  const itemEl = e.target.closest('.canvas-item');
  if (!itemEl) return;
  const id = itemEl.dataset.itemId;
  const { canvasItems } = getState();
  let item = canvasItems.find(i => i.itemId === id);
  // 如果处于展开模式，可能在 _expandedItems 中
  if (!item && _expandedStackId) {
    item = _expandedItems.find(i => i.itemId === id);
  }
  if (!item) return;

  if (item.status === 'ok') {
    if (item.type === 'stack') {
      // 展开堆叠组
      expandStack(item);
    } else {
      openImageDetail(item);
    }
  }
}

// 展开堆叠组
function expandStack(stackItem) {
  if (_expandedStackId) {
    // 如果已有展开的，先折叠
    collapseExpanded();
  }
  const stackId = stackItem.stackId;
  const items = stackItem.items;
  if (!items || items.length === 0) return;

  // 计算网格布局位置（以原 stack 位置为中心，每行最多 3 个，间距 20px）
  const startX = stackItem.x;
  const startY = stackItem.y;
  const cols = 3;
  const spacing = 20;
  const width = 300;
  const height = 300;

  const expanded = items.map((child, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const newX = startX + col * (width + spacing);
    const newY = startY + row * (height + spacing);
    return {
      itemId: `temp-${stackId}-${idx}-${Date.now()}-${Math.random()}`,
      _tempParentStackId: stackId,
      _childIndex: idx,                     // 存储子项在原始 stack.items 中的索引
      type: 'image',
      imageUrl: child.imageUrl,
      prompt: child.prompt || '',
      refImages: child.refImages || [],
      x: newX,
      y: newY,
      width: child.width || 300,
      height: child.height || 300,
      status: child.status || 'ok',
      generating: false,
      error: child.error || '',
      model: child.model || '',
      provider: child.provider || '',
      createdAt: child.createdAt || null,
      durationMs: child.durationMs ?? null,
      resolution: child.resolution || null,
      messageIndex: -1,
      canvasSeq: Date.now() + idx
    };
  });

  _expandedStackId = stackId;
  _expandedItems = expanded;
  _originalStackItem = stackItem;

  // 同步到全局
  window.__expandedStackId = _expandedStackId;
  window.__expandedItems = _expandedItems;

  // 重新渲染画布（此时会使用 _expandedItems 而不是 canvasItems）
  renderCanvas();
}

// 刷新展开视图（例如移出子项后调用）
async function refreshExpandedView() {
  if (!_expandedStackId || !_originalStackItem) return;
  // 重新从当前的 stack 中获取最新数据（可能已被移除）
  const session = getState().sessions[getState().currentSessionId];
  const currentStack = session.stacks?.find(s => s.id === _expandedStackId);
  if (!currentStack) {
    // stack 已不存在，折叠并退出
    collapseExpanded();
    return;
  }
  // 更新原始 stack 项引用
  _originalStackItem = {
    ..._originalStackItem,
    items: currentStack.items,
    count: currentStack.items.length
  };
  // 重新生成展开项
  const startX = _originalStackItem.x;
  const startY = _originalStackItem.y;
  const cols = 3;
  const spacing = 20;
  const width = 300;
  const height = 300;
  const newExpanded = currentStack.items.map((child, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const newX = startX + col * (width + spacing);
    const newY = startY + row * (height + spacing);
    return {
      itemId: `temp-${_expandedStackId}-${idx}-${Date.now()}-${Math.random()}`,
      _tempParentStackId: _expandedStackId,
      _childIndex: idx,
      type: 'image',
      imageUrl: child.imageUrl,
      prompt: child.prompt || '',
      refImages: child.refImages || [],
      x: newX,
      y: newY,
      width: child.width || 300,
      height: child.height || 300,
      status: child.status || 'ok',
      generating: false,
      error: child.error || '',
      model: child.model || '',
      provider: child.provider || '',
      createdAt: child.createdAt || null,
      durationMs: child.durationMs ?? null,
      resolution: child.resolution || null,
      messageIndex: -1,
      canvasSeq: Date.now() + idx
    };
  });
  _expandedItems = newExpanded;

  // 同步到全局
  window.__expandedItems = _expandedItems;

  renderCanvas();
}

// 批量移出 stack 中的多个子项（按索引，降序排列）
window.batchRemoveFromExpandedStack = async (stackId, indicesToRemove) => {
  console.log('[批量移出调试] 开始移除 stackId:', stackId, 'indicesToRemove:', indicesToRemove);
  if (!stackId || !indicesToRemove.length) return;
  // 从大到小排序，避免索引变化
  indicesToRemove.sort((a, b) => b - a);
  let removedCount = 0;
  for (const idx of indicesToRemove) {
    console.log('[批量移出调试] 移出索引:', idx);
    await removeFromStack(stackId, idx);
    removedCount++;
  }
  // 刷新展开视图
  await refreshExpandedView();
  console.log(`[批量移出调试] 完成，共移出 ${removedCount} 张图片`);
};

// 供 contextMenu 调用的刷新函数
window.refreshExpandedView = refreshExpandedView;

// 折叠展开的堆叠组
function collapseExpanded() {
  if (!_expandedStackId) return;
  _expandedStackId = null;
  _expandedItems = [];
  _originalStackItem = null;

  // 同步到全局
  window.__expandedStackId = null;
  window.__expandedItems = [];

  renderCanvas();
}

// ESC 键折叠
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _expandedStackId) {
    collapseExpanded();
  }
});

// Delete 键删除选中图像
document.addEventListener('keydown', async e => {
  // Only handle Delete key (not in input/textarea/select)
  if (e.key !== 'Delete' && e.key !== 'Del') return;
  const activeTag = document.activeElement?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

  const { selectedItemIds } = getState();
  if (!selectedItemIds.length) return;

  e.preventDefault(); // Prevent any default browser delete behavior

  // Separate items into temporary expanded items and regular canvas items
  const tempIds = [];
  const regularIds = [];
  const indicesToRemove = [];

  if (_expandedStackId && _expandedItems.length) {
    for (const id of selectedItemIds) {
      const tempItem = _expandedItems.find(item => item.itemId === id);
      if (tempItem && tempItem._tempParentStackId === _expandedStackId && tempItem._childIndex !== undefined) {
        tempIds.push(id);
        indicesToRemove.push(tempItem._childIndex);
      } else {
        // Not a temp expanded item (could be regular canvas item when expanded mode is active)
        regularIds.push(id);
      }
    }
  } else {
    regularIds.push(...selectedItemIds);
  }

  // Remove temporary expanded items (from stack) first
  if (indicesToRemove.length) {
    // Sort descending for safe removal
    indicesToRemove.sort((a, b) => b - a);
    await window.batchRemoveFromExpandedStack(_expandedStackId, indicesToRemove);
  }

  // Remove regular canvas items serially to avoid race conditions.
  // Sort by messageIndex descending so that earlier deletions don't shift
  // the indices that later deletions rely on within session.messages.
  const sortedRegularIds = [...regularIds].sort((a, b) => {
    const { canvasItems } = getState();
    const itemA = canvasItems.find(i => i.itemId === a);
    const itemB = canvasItems.find(i => i.itemId === b);
    return (itemB?.messageIndex ?? -1) - (itemA?.messageIndex ?? -1);
  });
  for (const id of sortedRegularIds) {
    await removeCanvasItemById(id);
  }

  // Clear selection after deletion
  setState({ selectedItemIds: [] });
});

function onMouseDown(e) {
  // 点击画布时让输入框编辑器失焦（收起高度）
  if (document.activeElement) document.activeElement.blur();

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
      console.log('[选中调试] Ctrl+单击, 新选中列表:', ids);
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
        console.log('[选中调试] Shift+单击范围选择, 新选中列表:', ids);
        setState({ selectedItemIds: ids });
      }
      // Don't update _lastClickedIndex
    } else {
      // Plain click: select just this one
      const newId = itemEl.dataset.itemId;
      console.log('[选中调试] 普通单击, 选中:', newId);
      setState({ selectedItemIds: [newId] });
      _lastClickedIndex = getState().canvasItems.findIndex(i => i.itemId === newId);
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
    // 使用 Map 存储 哈希 -> dataUrl，实现基于内容去重
    const uniqueImages = new Map();
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
        // 计算内容哈希（基于 dataUrl 的 base64 部分）
        const base64Data = dataUrl.split(',')[1] || dataUrl;
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64Data));
        const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (!uniqueImages.has(hash)) {
          uniqueImages.set(hash, dataUrl);
        }
      }
    }
    let pasted = 0;
    for (const dataUrl of uniqueImages.values()) {
      const result = await addDroppedImage(dataUrl);
      if (result !== null) pasted++;
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

let _dragSourceId = null;
let _dragSourceStackId = null;
let _dragSourceChildIndex = -1;
let _dragOverCount = 0;

function setupItemDrag() {
  surface.addEventListener('dragstart', e => {
    const itemEl = e.target.closest('.canvas-item');
    if (!itemEl) return;
    const id = itemEl.dataset.itemId;
    // 检查是否在展开模式下的临时项
    let item = getState().canvasItems.find(i => i.itemId === id);
    if (!item && _expandedStackId) {
      item = _expandedItems.find(i => i.itemId === id);
    }
    if (!item || !item.imageUrl) {
      e.preventDefault();
      return;
    }

    _dragSourceId = id;
    _dragSourceStackId = item._tempParentStackId || null;
    _dragSourceChildIndex = typeof item._childIndex === 'number' ? item._childIndex : -1;
    _dragOverCount = 0;
    console.log('[拖拽] 1. 开始拖动图像, id:', id, 'type:', item.type, 'stackId:', _dragSourceStackId, 'pos:', item.x, item.y);

    // 创建干净的静态拖拽幽灵图，避免浏览器从动画 DOM 抓取产生残影
    const ghost = document.createElement('img');
    ghost.src = item.imageUrl;
    ghost.style.width = '120px';
    ghost.style.height = '120px';
    ghost.style.objectFit = 'cover';
    ghost.style.borderRadius = '8px';
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 60, 60);
    setTimeout(() => document.body.removeChild(ghost), 0);

    e.dataTransfer.setData('application/json', JSON.stringify({
      name: '画布图片: ' + (item.prompt ? item.prompt.slice(0, 30) : ''),
      dataUrl: item.imageUrl
    }));
    e.dataTransfer.effectAllowed = 'move';
  });

  surface.addEventListener('dragend', () => {
    console.log('[拖拽] dragend 触发, _dragSourceId:', _dragSourceId);
    _dragSourceId = null;
    _dragSourceStackId = null;
    _dragSourceChildIndex = -1;
    // 移除所有高亮
    document.querySelectorAll('.canvas-item').forEach(el => {
      el.classList.remove('drag-overlap-highlight');
    });
    container.classList.remove('drag-over-detach');
  });
}

// 在 dragover 中检测并高亮目标
function setupOverlapDetection() {
  surface.addEventListener('dragover', e => {
    const realTarget = document.elementFromPoint(e.clientX, e.clientY);
    console.log('[拖拽] surface dragover #' + (++_dragOverCount) + ' clientX=' + e.clientX + ' clientY=' + e.clientY + ' _dragSourceId:', _dragSourceId, 'e.target:', (e.target.className || e.target.tagName), 'elementFromPoint:', (realTarget ? (realTarget.className || realTarget.tagName) : 'null'));
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!_dragSourceId) return;

    const dragEl = document.querySelector(`.canvas-item[data-item-id="${_dragSourceId}"]`);
    if (!dragEl) return;

    let targetEl = e.target.closest('.canvas-item');
    if (!targetEl || targetEl.dataset.itemId === _dragSourceId) {
      console.log('[拖拽] dragover SKIP: targetEl=' + (targetEl ? targetEl.dataset.itemId : 'null') + ' _dragSourceId=' + _dragSourceId);
      // 清除所有高亮
      document.querySelectorAll('.canvas-item').forEach(el => {
        el.classList.remove('drag-overlap-highlight');
      });
      // 拖拽到空白区域：显示分离提示
      if (!targetEl && _dragSourceStackId) {
        container.classList.add('drag-over-detach');
      } else {
        container.classList.remove('drag-over-detach');
      }
      return;
    }

    // 有目标元素时清除分离提示
    container.classList.remove('drag-over-detach');

    // 光标已在目标元素上方（e.target.closest 验证通过），直接高亮
    targetEl.classList.add('drag-overlap-highlight');
    console.log('[拖拽] 2. 图像重合! dragId:', _dragSourceId, 'targetId:', targetEl.dataset.itemId);
  });
}

// 获取 canvas 坐标（从页面坐标转换）
function getCanvasCoords(el) {
  const { left, top } = el.getBoundingClientRect();
  const r = container.getBoundingClientRect();
  const vp = getState().viewport;
  return {
    x: (left - r.left - vp.panX) / vp.zoom,
    y: (top - r.top - vp.panY) / vp.zoom
  };
}

// 处理拖拽合并
function setupDragMerge() {
  surface.addEventListener('drop', async e => {
    console.log('[拖拽] surface drop 触发, _dragSourceId:', _dragSourceId);
    e.preventDefault();
    // 移除高亮
    document.querySelectorAll('.canvas-item').forEach(el => {
      el.classList.remove('drag-overlap-highlight');
    });
    container.classList.remove('drag-over-detach');

    if (!_dragSourceId) return;
    e.stopPropagation(); // 阻止冒泡到 container，避免 handleMaterialDrop 重复处理

    const targetEl = e.target.closest('.canvas-item');
    const dragItem = getState().canvasItems.find(i => i.itemId === _dragSourceId);

    // --- 场景：拖拽到空白区域 —— 分离（展开模式下的临时项） ---
    if (!targetEl && _dragSourceStackId && _dragSourceChildIndex >= 0) {
      const coords = getCanvasCoords(e.target.closest('#canvasSurface') || surface);
      const success = await removeFromStack(_dragSourceStackId, _dragSourceChildIndex, coords.x, coords.y);
      if (success) {
        await refreshExpandedView();
        showToast('已从堆叠组移出', 'success');
      } else {
        showToast('移出失败', 'error');
      }
      _dragSourceId = null;
      _dragSourceStackId = null;
      _dragSourceChildIndex = -1;
      return;
    }

    if (!targetEl || targetEl.dataset.itemId === _dragSourceId) return;

    let targetItem = getState().canvasItems.find(i => i.itemId === targetEl.dataset.itemId);
    if (!dragItem || !targetItem) return;

    // --- 展开模式下不允许与临时项合并 ---
    if (_expandedStackId) {
      if (targetItem._tempParentStackId) {
        showToast('请先折叠堆叠组再合并', 'info');
        return;
      }
      if (dragItem._tempParentStackId) {
        showToast('请先折叠堆叠组再合并', 'info');
        return;
      }
    }

    // 确认源元素仍存在（光标已在目标上方，无需 DOM 矩形重叠检测）
    const dragEl = document.querySelector(`.canvas-item[data-item-id="${_dragSourceId}"]`);
    if (!dragEl) return;

    // --- 场景 1：两个 stack 合并 ---
    if (dragItem.type === 'stack' && targetItem.type === 'stack') {
      const success = await mergeStacks(dragItem.stackId, targetItem.stackId);
      showToast(success ? '已合并堆叠组' : '合并失败', success ? 'success' : 'error');
      _dragSourceId = null;
      return;
    }

    // --- 场景 2：拖拽 stack 到普通图像 ~ 将图像加入 stack ---
    if (dragItem.type === 'stack' && targetItem.type !== 'stack') {
      const success = await addToStack(dragItem.stackId, _dragSourceId);
      showToast(success ? '已加入堆叠组' : '加入失败', success ? 'success' : 'error');
      _dragSourceId = null;
      return;
    }

    // --- 场景 3：目标已是 stack，将源加入 ---
    if (targetItem.type === 'stack') {
      const stackId = targetItem.stackId;
      const success = await addToStack(stackId, _dragSourceId);
      showToast(success ? '已加入堆叠组' : '加入失败', success ? 'success' : 'error');
      _dragSourceId = null;
      return;
    }

    // --- 场景 4：两个普通图像，创建新 stack ---
    console.log('[拖拽] 3. 松开鼠标，准备清除2张图片并创建 stack, ids:', [_dragSourceId, targetItem.itemId]);
    const coords = getCanvasCoords(targetEl);
    const stack = await createStackFromItems([_dragSourceId, targetItem.itemId], coords.x, coords.y);
    console.log('[拖拽] 4. stack 创建结果:', stack ? '成功 id=' + stack.id + ' items=' + stack.items.length : '失败');
    showToast(stack ? '已创建堆叠组' : '创建失败', stack ? 'success' : 'error');
    _dragSourceId = null;
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
  // 全局允许素材库拖拽
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/json')) {
      e.preventDefault();
    }
  });
  // 诊断：追踪 drop 事件流向
  window.addEventListener('drop', (e) => {
    console.log('[拖拽] WINDOW drop 触发, target:', (e.target.id || e.target.className || e.target.tagName));
  });
  document.addEventListener('drop', (e) => {
    console.log('[拖拽] DOCUMENT drop 触发, target:', (e.target.id || e.target.className || e.target.tagName));
  }, true); // 捕获阶段

  // 处理素材库拖拽到画布
  const handleMaterialDragOver = (e) => {
    console.log('[拖拽] container dragover 触发 (material), types:', Array.from(e.dataTransfer.types));
    if (e.dataTransfer.types.includes('application/json')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const handleMaterialDrop = async (e) => {
    // 跳过 canvas 内部拖拽（已由 setupDragMerge 处理）
    if (_dragSourceId && e.target.closest('#canvasSurface')) {
      console.log('[拖拽] handleMaterialDrop 跳过 (内部拖拽), _dragSourceId:', _dragSourceId);
      return;
    }

    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const { name, dataUrl } = JSON.parse(jsonData);
        if (dataUrl) {
          await addDroppedImage(dataUrl);
          showToast(`素材“${name}”已添加到画布`, 'success');
        }
      } catch (err) {
        console.error('处理素材拖拽失败:', err);
      }
    }
  };
  // 优先注册素材拖拽监听器（确保先于其他监听器捕获）
  container.addEventListener('dragover', handleMaterialDragOver);
  container.addEventListener('drop', handleMaterialDrop);

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

  // 单击已完成图片打开详情 Modal
  container.addEventListener('click', e => {
    if (e.target.closest('.gen-cancel')) return;
    const itemEl = e.target.closest('.canvas-item');
    if (!itemEl) return;
    const id = itemEl.dataset.itemId;
    const { canvasItems } = getState();
    let item = canvasItems.find(i => i.itemId === id);
    if (!item && _expandedStackId) {
      item = _expandedItems.find(i => i.itemId === id);
    }
    if (!item) return;
    if (item.status === 'ok' && item.type !== 'stack') {
      openImageDetail(item);
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

  // Toggle image blur (Ctrl+H / Cmd+H)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      const newValue = !getState().imagesBlurred;
      applyImageBlurState(newValue);
      setState({ imagesBlurred: newValue, statusText: newValue ? '图片已隐藏 (Ctrl+H 恢复)' : '' });
    }
  });

  setupItemDrag();
  setupExternalDrop();
  setupOverlapDetection();
  setupDragMerge();

  // 监听画布项变化，启动或停止计时器
  let isTimerSetup = false;
  subscribe('canvasItems', () => {
    const { canvasItems } = getState();
    const hasGenerating = canvasItems.some(item => item.generating === true);
    if (hasGenerating) {
      startTimerUpdates();
    } else {
      stopTimerUpdates();
    }
    renderCanvas();
  });
  subscribe('selectedItemIds', () => {
    const ids = getState().selectedItemIds;
    $$('.canvas-item').forEach(el => {
      el.classList.toggle('selected', ids.includes(el.dataset.itemId));
    });
  });
  subscribe('currentSessionId', restoreImageBlurState);

  // 页面关闭时停止定时器
  window.addEventListener('beforeunload', () => {
    stopTimerUpdates();
  });

  restoreImageBlurState();
  renderCanvas();
  // 初始检查是否需要启动定时器
  const { canvasItems } = getState();
  if (canvasItems.some(item => item.generating === true)) {
    startTimerUpdates();
  }
}
