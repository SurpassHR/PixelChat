import { getState, setState, addMaterial, addDroppedImage, removeCanvasItemById, removeMaterial, createStackFromItems, removeFromStack, dissolveStack } from '../store.js';
import { $, $$ } from '../domHelpers.js';
import { openPromptHistory } from './modal.js';
import { showToast } from '../toast.js';

const menu = $('#contextMenu');
let currentContext = null;
let currentData = null;

export function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px 28px;max-width:360px;width:90%;text-align:center;';

    const p = document.createElement('p');
    p.textContent = message;
    p.style.cssText = 'font-size:15px;color:var(--text);margin:0 0 20px 0;line-height:1.5;';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:12px;justify-content:center;';

    const yesBtn = document.createElement('button');
    yesBtn.textContent = '是';
    yesBtn.style.cssText = 'padding:8px 28px;border-radius:8px;border:1px solid #d9534f;font-size:14px;cursor:pointer;background:#d9534f;color:#fff;';

    const noBtn = document.createElement('button');
    noBtn.textContent = '否';
    noBtn.style.cssText = 'padding:8px 28px;border-radius:8px;border:1px solid var(--border);font-size:14px;cursor:pointer;background:var(--surface);color:var(--text);';

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    dialog.appendChild(p);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    yesBtn.focus();

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        cleanup();
        resolve(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(false);
      }
    }

    yesBtn.addEventListener('click', () => { cleanup(); resolve(true); });
    noBtn.addEventListener('click', () => { cleanup(); resolve(false); });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(false); }
    });

    document.addEventListener('keydown', onKey);
  });
}

export function showMenu(e, context, data) {
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
    // "解散 stack": 仅在右键堆叠组时显示
    const dissolveStackItem = $$('.menu-item[data-action="dissolveStack"]', menu)[0];
    if (dissolveStackItem) {
      const item = getState().canvasItems.find(i => i.itemId === data.itemId);
      dissolveStackItem.classList.toggle('hidden', !item || item.type !== 'stack');
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

export function hideMenu() {
  menu.classList.remove('active');
  currentContext = null;
  currentData = null;
}

export async function handleAction(action) {
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
          // 从画布添加到素材库，默认归类为 'Imported'，用户可后续移动
          await addMaterial('画布图片', item.imageUrl, 'Imported');
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
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(combined);
        } else {
          const ta = document.createElement('textarea');
          ta.value = combined;
          ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        showToast(`已复制 ${prompts.length} 条提示词`, 'success');
      } catch (err) {
        showToast('复制失败: ' + (err?.message || '未知错误'), 'error');
      }
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
          await new Promise(r => setTimeout(r, 100));
        }
      }
      showToast(`已下载 ${itemIds.length} 张图片`, 'success');
      break;
    }
    case 'deleteImage': {
      const itemIds = getTargetItemIds();
      if (itemIds.length === 0) break;
      const msg = itemIds.length > 1
        ? `确定要删除选中的 ${itemIds.length} 张图片吗？`
        : '确定要删除这张图片吗？';
      const confirmed = await showConfirm(msg);
      if (!confirmed) break;
      // Sort by messageIndex descending so that earlier deletions don't shift
      // the indices that later deletions rely on within session.messages.
      const { canvasItems } = getState();
      const sortedIds = [...itemIds].sort((a, b) => {
        const itemA = canvasItems.find(i => i.itemId === a);
        const itemB = canvasItems.find(i => i.itemId === b);
        return (itemB?.messageIndex ?? -1) - (itemA?.messageIndex ?? -1);
      });
      for (const id of sortedIds) {
        await removeCanvasItemById(id);
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
      const { left, top } = currentData?.mousePos || { left: 200, top: 200 };
      const container = document.getElementById('canvasContainer');
      const rect = container.getBoundingClientRect();
      const vp = getState().viewport;
      const canvasX = (left - rect.left - vp.panX) / vp.zoom;
      const canvasY = (top - rect.top - vp.panY) / vp.zoom;
      const stack = await createStackFromItems(selectedItemIds, Math.max(0, canvasX - 150), Math.max(0, canvasY - 150));
      if (stack) {
        setState({ selectedItemIds: [] });
        showToast('已创建堆叠组', 'success');
      } else {
        showToast('创建堆叠组失败', 'error');
      }
      break;
    }
    case 'removeFromStack': {
      const { selectedItemIds, canvasItems } = getState();
      let indicesToRemove = [];
      let stackId = currentData?.stackId || currentData?.tempStackId;
      
      const extractIndexFromTempId = (id) => {
        const el = document.querySelector(`.canvas-item[data-item-id="${id}"]`);
        if (el && el.dataset.childIndex !== undefined) {
          return parseInt(el.dataset.childIndex, 10);
        }
        return null;
      };
      
      if (currentData?.childIndex !== undefined && stackId) {
        const extractedIndices = [];
        for (const id of selectedItemIds) {
          const idx = extractIndexFromTempId(id);
          if (idx !== null) extractedIndices.push(idx);
        }
        if (extractedIndices.length > 0) {
          indicesToRemove = [...new Set(extractedIndices)];
        } else {
          indicesToRemove = [currentData.childIndex];
        }
        indicesToRemove.sort((a, b) => b - a);
        
        // 使用 batchRemoveFromExpandedStack 确保展开视图即时刷新
        if (window.batchRemoveFromExpandedStack) {
          await window.batchRemoveFromExpandedStack(stackId, indicesToRemove);
          showToast(`已从堆叠组移出 ${indicesToRemove.length} 张图片`, 'success');
        } else {
          // 回退：手动移除并刷新
          for (const idx of indicesToRemove) {
            await removeFromStack(stackId, idx);
          }
          showToast(`已从堆叠组移出 ${indicesToRemove.length} 张图片`, 'success');
          if (window.refreshExpandedView) await window.refreshExpandedView();
        }
      } else {
        showToast('无法识别堆叠组', 'error');
      }
      break;
    }
    case 'dissolveStack': {
      const itemId = currentData?.itemId;
      if (!itemId) {
        showToast('无法识别堆叠组', 'error');
        break;
      }
      const item = getState().canvasItems.find(i => i.itemId === itemId);
      if (!item || item.type !== 'stack') {
        showToast('仅堆叠组可解散', 'error');
        break;
      }
      const success = await dissolveStack(item.stackId);
      showToast(success ? '已解散堆叠组' : '解散失败', success ? 'success' : 'error');
      break;
    }
    case 'addRef': {
      const { materials, selectedMaterialIds } = getState();
      let targetIds = [];
      if (selectedMaterialIds.length > 0) {
        targetIds = selectedMaterialIds;
      } else if (currentData?.materialId) {
        targetIds = [currentData.materialId];
      }
      if (targetIds.length === 0) break;
      
      let addedCount = 0;
      const refs = getState().refImages;
      for (const id of targetIds) {
        const mat = materials.find(m => m.id === id);
        if (mat) {
          let dataUrl = mat.dataUrl;
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
          addedCount++;
        }
      }
      if (addedCount > 0) {
        setState({ refImages: [...refs] });
        showToast(`已添加 ${addedCount} 张图片作为参考`, 'success');
      }
      break;
    }
    case 'downloadMat': {
      const { materials, selectedMaterialIds } = getState();
      let targetIds = [];
      if (selectedMaterialIds.length > 0) {
        targetIds = selectedMaterialIds;
      } else if (currentData?.materialId) {
        targetIds = [currentData.materialId];
      }
      if (targetIds.length === 0) break;
      
      let downloadedCount = 0;
      for (const id of targetIds) {
        const mat = materials.find(m => m.id === id);
        if (mat && mat.dataUrl) {
          const a = document.createElement('a');
          a.href = mat.dataUrl;
          a.download = mat.name || 'material.png';
          a.click();
          downloadedCount++;
          await new Promise(r => setTimeout(r, 100));
        }
      }
      showToast(`已下载 ${downloadedCount} 张图片`, 'success');
      break;
    }
    case 'removeMaterial': {
      const { selectedMaterialIds } = getState();
      let targetIds = [];
      if (selectedMaterialIds.length > 0) {
        targetIds = selectedMaterialIds;
      } else if (currentData?.materialId) {
        targetIds = [currentData.materialId];
      }
      if (targetIds.length === 0) break;

      const msg = targetIds.length > 1
        ? `确定要从素材库删除 ${targetIds.length} 张图片吗？`
        : '确定要从素材库删除这张图片吗？';
      const confirmed = await showConfirm(msg);
      if (!confirmed) break;

      let removedCount = 0;
      for (const id of targetIds) {
        removeMaterial(id);
        removedCount++;
      }
      showToast(`已删除 ${removedCount} 张图片`, 'success');
      break;
    }
    case 'promptHistory': {
      openPromptHistory();
      break;
    }
    case 'clearCanvas': {
      const items = [...getState().canvasItems];
      // Sort by messageIndex descending so that deletions don't shift indices
      // within session.messages for subsequent items.
      items.sort((a, b) => (b.messageIndex ?? -1) - (a.messageIndex ?? -1));
      for (const item of items) {
        await removeCanvasItemById(item.itemId);
      }
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
      if (itemEl.dataset.childIndex !== undefined && itemEl.dataset.tempStackId !== undefined) {
        data.childIndex = parseInt(itemEl.dataset.childIndex, 10);
        data.tempStackId = itemEl.dataset.tempStackId;
      }
      showMenu(e, 'canvas-image', data);
      return;
    }

    // 新版素材库使用 .mat-item 和 data-id
    const matEl = e.target.closest('.mat-item');
    if (matEl && matEl.dataset.id) {
      const mid = matEl.dataset.id;
      const { selectedMaterialIds } = getState();
      let newSelection;
      if (e.ctrlKey || e.metaKey) {
        if (selectedMaterialIds.includes(mid)) {
          newSelection = selectedMaterialIds.filter(id => id !== mid);
        } else {
          newSelection = [...selectedMaterialIds, mid];
        }
      } else {
        newSelection = [mid];
      }
      setState({ selectedMaterialIds: newSelection });
      showMenu(e, 'material', { materialId: mid });
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