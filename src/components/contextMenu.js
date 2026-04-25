import { getState, setState, addMaterial, addDroppedImage, removeCanvasItemById, removeMaterial, createStackFromItems, removeFromStack } from '../store.js';
import { $, $$ } from '../domHelpers.js';
import { openPromptHistory } from './modal.js';
import { showToast } from '../toast.js';

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

  // 动态控制菜单项的可见性
  if (context === 'canvas-image') {
    // "放入 stack": 仅在选中多个图像时显示
    const makeStackItem = $$('.menu-item[data-action="makeStack"]', menu)[0];
    if (makeStackItem) {
      const selectedCount = getState().selectedItemIds.length;
      makeStackItem.classList.toggle('hidden', selectedCount < 2);
    }
    // "移出 stack": 仅在展开模式下且有 childIndex 属性时显示
    const removeStackItem = $$('.menu-item[data-action="removeFromStack"]', menu)[0];
    if (removeStackItem) {
      const isTempExpanded = data && data.childIndex !== undefined;
      removeStackItem.classList.toggle('hidden', !isTempExpanded);
      if (isTempExpanded) {
        currentData.stackId = data.tempStackId;
        currentData.childIndex = data.childIndex;
      }
    }
  }

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

async function handleAction(action) {
  // 辅助函数：获取需要操作的 itemId 列表（支持批量）
  const getTargetItemIds = () => {
    if (currentContext === 'canvas-image') {
      const { selectedItemIds } = getState();
      if (selectedItemIds.length > 1) {
        return selectedItemIds;
      }
    }
    return currentData?.itemId ? [currentData.itemId] : [];
  };

  switch (action) {
    case 'copyImage': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      // 多选时只复制第一张图片（剪贴板限制）
      const { canvasItems } = getState();
      const firstItem = canvasItems.find(i => i.itemId === itemIds[0]);
      if (firstItem && firstItem.imageUrl) {
        try {
          const blob = await fetch(firstItem.imageUrl).then(r => r.blob());
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type]: blob })
          ]);
          if (itemIds.length > 1) {
            showToast(`已复制第一张图片（共选中 ${itemIds.length} 张）`, 'success');
          } else {
            showToast('图片已复制到剪贴板', 'success');
          }
        } catch (err) {
          showToast('复制失败: ' + err.message, 'error');
        }
      }
      break;
    }
    case 'pasteImage': {
      try {
        const items = await navigator.clipboard.read();
        let pasted = 0;
        for (const clipItem of items) {
          const imgType = clipItem.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await clipItem.getType(imgType);
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
      break;
    }
    case 'addMaterial': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      const { canvasItems } = getState();
      let addedCount = 0;
      for (const id of itemIds) {
        const item = canvasItems.find(i => i.itemId === id);
        if (item && item.imageUrl) {
          await addMaterial('画布图片', item.imageUrl);
          addedCount++;
        }
      }
      showToast(`已添加 ${addedCount} 张图片到素材库`, 'success');
      break;
    }
    case 'copyPrompt': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      const { canvasItems } = getState();
      const prompts = [];
      for (const id of itemIds) {
        const item = canvasItems.find(i => i.itemId === id);
        if (item && item.prompt) {
          prompts.push(item.prompt);
        } else {
          prompts.push('[无提示词]');
        }
      }
      const combined = prompts.join('\n---\n');
      navigator.clipboard.writeText(combined).catch(() => {});
      showToast(`已复制 ${prompts.length} 条提示词`, 'success');
      break;
    }
    case 'download': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      const { canvasItems } = getState();
      for (const id of itemIds) {
        const item = canvasItems.find(i => i.itemId === id);
        if (item && item.imageUrl) {
          const a = document.createElement('a');
          a.href = item.imageUrl;
          a.download = `image_${id}.png`;
          a.target = '_blank';
          a.click();
          // 短暂延迟避免浏览器拦截批量下载
          await new Promise(r => setTimeout(r, 100));
        }
      }
      showToast(`已下载 ${itemIds.length} 张图片`, 'success');
      break;
    }
    case 'deleteImage': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      for (const id of itemIds) {
        removeCanvasItemById(id);
      }
      showToast(`已删除 ${itemIds.length} 张图片`, 'success');
      break;
    }
    case 'makeStack': {
      const { selectedItemIds, canvasItems } = getState();
      if (selectedItemIds.length < 2) {
        showToast('请至少选择两个图像', 'error');
        break;
      }
      // 获取右键点击时的鼠标坐标（用于定位stack）
      const { left, top } = currentData?.mousePos || { left: 200, top: 200 };
      const container = document.getElementById('canvasContainer');
      const rect = container.getBoundingClientRect();
      const vp = getState().viewport;
      const canvasX = (left - rect.left - vp.panX) / vp.zoom;
      const canvasY = (top - rect.top - vp.panY) / vp.zoom;
      createStackFromItems(selectedItemIds, Math.max(0, canvasX - 150), Math.max(0, canvasY - 150));
      setState({ selectedItemIds: [] });
      showToast('已创建堆叠组', 'success');
      break;
    }
    case 'removeFromStack': {
      // 获取当前展开模式下的所有选中的临时项（如果有多个）
      const { selectedItemIds, canvasItems } = getState();
      let indicesToRemove = [];
      
      // 辅助函数：从临时项 ID 中提取索引（格式：temp-{stackId}-{idx}-...）
      const extractIndexFromTempId = (id) => {
        const match = id.match(/temp-[^-]+-(\d+)-/);
        return match ? parseInt(match[1], 10) : null;
      };
      
      if (currentData?.childIndex !== undefined && currentData?.tempStackId !== undefined) {
        // 优先使用所有选中项的索引（从 selectedItemIds 中解析）
        const extractedIndices = [];
        for (const id of selectedItemIds) {
          const idx = extractIndexFromTempId(id);
          if (idx !== null) extractedIndices.push(idx);
        }
        // 去重并过滤掉无效索引
        const uniqueIndices = [...new Set(extractedIndices)].filter(idx => idx !== null && !isNaN(idx));
        
        if (uniqueIndices.length > 0) {
          // 使用解析出的索引（支持批量）
          indicesToRemove = uniqueIndices;
          console.log('[右键移出] 从 selectedItemIds 解析出的索引:', indicesToRemove);
        } else {
          // 后备：通过 window.__expandedItems 查找
          let tempItems = [];
          if (window.__expandedItems && window.__expandedStackId === currentData.tempStackId) {
            tempItems = window.__expandedItems;
          } else {
            tempItems = canvasItems.filter(item => item._tempParentStackId === currentData.tempStackId);
          }
          const selectedTempItems = tempItems.filter(item => selectedItemIds.includes(item.itemId));
          if (selectedTempItems.length > 1) {
            indicesToRemove = selectedTempItems.map(item => item._childIndex).filter(idx => idx !== undefined);
          } else {
            indicesToRemove = [currentData.childIndex];
          }
          console.log('[右键移出] 通过展开项列表计算 indicesToRemove:', indicesToRemove);
        }
      } else if (currentData?.childIndex !== undefined) {
        indicesToRemove = [currentData.childIndex];
      }

      if (indicesToRemove.length === 0) return;

      console.log(`[右键移出] 将移出 ${indicesToRemove.length} 张图片，索引列表:`, indicesToRemove);
      // 从大到小排序，避免索引变化问题
      indicesToRemove.sort((a, b) => b - a);
      // 调用批量移除（需要在 canvas.js 中实现）
      if (typeof window.batchRemoveFromExpandedStack === 'function') {
        window.batchRemoveFromExpandedStack(currentData.stackId || currentData.tempStackId, indicesToRemove);
        showToast(`已从堆叠组移出 ${indicesToRemove.length} 张图片`, 'success');
      } else {
        // 后备：逐个调用
        for (const idx of indicesToRemove) {
          await removeFromStack(currentData.stackId || currentData.tempStackId, idx);
        }
        showToast(`已从堆叠组移出 ${indicesToRemove.length} 张图片`, 'success');
        // 刷新展开视图（如果有）
        if (typeof window.refreshExpandedView === 'function') {
          window.refreshExpandedView();
        }
      }
      break;
    }
    case 'addRef': {
      const { materials } = getState();
      const mat = materials.find(m => m.id === currentData?.materialId);
      if (mat) {
        const refs = getState().refImages;
        let dataUrl = mat.dataUrl;
        // Convert blob URLs to data URLs for API compatibility
        if (dataUrl && dataUrl.startsWith('blob:')) {
          try {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch { }
        }
        refs.push({ name: mat.name, dataUrl });
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
      const data = { itemId: itemEl.dataset.itemId };
      // 如果是展开模式下的临时项，传递额外信息
      if (itemEl.dataset.childIndex !== undefined && itemEl.dataset.tempStackId !== undefined) {
        data.childIndex = parseInt(itemEl.dataset.childIndex, 10);
        data.tempStackId = itemEl.dataset.tempStackId;
      }
      showMenu(e, 'canvas-image', data);
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
