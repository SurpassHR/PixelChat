import { getState, setState, subscribe, addMaterial, removeMaterial, createMaterialStack, ungroupMaterialStack, moveMaterialToStack, getFlattenedMaterialItems } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { showToast } from '../toast.js';

// 当前选中的素材ID列表（支持多选）
let selectedMaterialIds = [];

// 拖拽相关状态
let dragSourceIds = [];
let dragOverTargetId = null;
let dragSourceParentStackId = null; // 如果拖拽的是堆叠组内的子素材，记录父组ID

// UI 状态
let currentTab = 'Imported';   // 'Imported' or 'Generated'
let searchQuery = '';
let expandedStacks = new Map();  // stackId -> boolean
let lastClickedIndex = -1;

// 引用 DOM 元素
let materialListContainer;
let addMaterialBtn;
let materialFileInput;

// 同步防抖定时器
let syncDebounceTimer = null;

/**
 * 从当前会话的画布中同步图片到素材库（防抖）
 * 遍历 canvasItems（包括消息和拖拽图片），如果尚未在素材库中则添加
 */
async function syncCanvasImagesToMaterialLibrary(force = false) {
    if (!force && syncDebounceTimer) return;
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(async () => {
        syncDebounceTimer = null;
        await _syncCanvasImagesToMaterialLibrary();
    }, 300);
}

async function _syncCanvasImagesToMaterialLibrary() {
    const { canvasItems, currentSessionId, sessions } = getState();
    const session = sessions[currentSessionId];
    if (!session) return;

    const imagesToAdd = [];
    const seenUrls = new Set();

    for (const item of canvasItems) {
        if (item.type === 'image' && item.imageUrl && item.status === 'ok') {
            if (seenUrls.has(item.imageUrl)) continue;
            seenUrls.add(item.imageUrl);

            let category = 'Imported';
            if (item.messageIndex >= 0 && session.messages && session.messages[item.messageIndex]?.role === 'assistant') {
                category = 'Generated';
            } else if (item.dropId) {
                category = 'Imported';
            }
            let name = '';
            if (item.prompt) {
                name = item.prompt.slice(0, 30) + (item.prompt.length > 30 ? '...' : '');
            } else {
                name = `image_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            }
            imagesToAdd.push({ url: item.imageUrl, name, category });
        }
    }

    let addedCount = 0;
    for (const img of imagesToAdd) {
        try {
            const result = await addMaterial(img.name, img.url, img.category);
            if (result && result.id !== img.url) {
                addedCount++;
            }
        } catch (err) {
            console.warn('同步图片到素材库失败:', img.url, err);
        }
    }
    if (addedCount > 0) {
        console.log(`素材库同步: 新增 ${addedCount} 张图片`);
    }
}

// 渲染函数
function renderMaterialLibrary() {
    if (!materialListContainer) return;
    
    const { materials, materialStacks } = getState();
    
    let allItems = getFlattenedMaterialItems(currentTab);
    console.log(`[渲染素材库] 当前标签页: ${currentTab}, 从 getFlattenedMaterialItems 获得 ${allItems.length} 个项`);
    if (searchQuery.trim()) {
        const lowerQuery = searchQuery.toLowerCase();
        allItems = allItems.filter(item => item.name.toLowerCase().includes(lowerQuery));
        console.log(`[渲染素材库] 搜索过滤后剩余 ${allItems.length} 个项`);
    }
    
    // 构建树形结构：堆叠组加子项（如果展开）
    const renderItems = [];
    for (const item of allItems) {
        // 统一判断是否为堆叠组：支持 isStack 标志或 type === 'stack'
        const isStackItem = item.isStack === true || item.type === 'stack';
        renderItems.push({ type: 'item', data: item });
        if (isStackItem && expandedStacks.get(item.id)) {
            const stack = item;
            // 通过 parentStackId 查找子素材，不再依赖 stack.children（保证同步）
            let childMaterials = materials.filter(m => m.parentStackId === stack.id);
            console.log(`[渲染调试] 堆叠组 ${stack.id} 展开中，通过 parentStackId 找到 ${childMaterials.length} 个子素材`);
            // 如果通过 parentStackId 找不到，尝试通过 stack.children 查找（兼容旧数据）
            if (childMaterials.length === 0 && stack.children && Array.isArray(stack.children)) {
                console.log(`[渲染调试] 尝试通过 stack.children 查找, children 数组:`, stack.children);
                if (stack.children.length) {
                    childMaterials = stack.children.map(cid => materials.find(m => m.id === cid)).filter(Boolean);
                    console.log(`[渲染调试] 通过 stack.children 找到 ${childMaterials.length} 个有效素材`);
                    // 修复这些素材的 parentStackId 以便后续使用
                    let fixed = false;
                    for (const child of childMaterials) {
                        if (child && child.parentStackId !== stack.id) {
                            child.parentStackId = stack.id;
                            fixed = true;
                        }
                    }
                    if (fixed) {
                        // 保存修复后的数据
                        const { materials: currentMats, materialStacks: currentStacks } = getState();
                        localStorage.setItem('image-gen-materials-v2', JSON.stringify({
                            materials: currentMats,
                            materialStacks: currentStacks
                        }));
                        console.log('[修复] 已更新 parentStackId 映射并保存到 localStorage');
                    }
                } else {
                    console.log(`[渲染调试] stack.children 为空数组，无法获取子素材`);
                }
            } else if (childMaterials.length === 0) {
                console.log(`[渲染调试] 无法获取子素材: parentStackId 无匹配且 stack.children 不可用或为空`);
            }
            console.log(`[渲染调试] 最终子素材列表:`, childMaterials.map(c => ({ id: c.id, name: c.name })));
            for (const child of childMaterials) {
                renderItems.push({ type: 'child', data: child, parentStackId: stack.id });
            }
        }
    }
    
    // 额外调试：输出所有素材的 parentStackId
    console.log('[渲染调试] 当前所有素材的 parentStackId 映射:', materials.map(m => ({ id: m.id, name: m.name, parent: m.parentStackId, category: m.category })));
    console.log('[渲染调试] 当前所有堆叠组:', materialStacks.map(s => ({ id: s.id, name: s.name, category: s.category, children: s.children })));
    console.log('[渲染调试] 即将渲染的 renderItems 数量:', renderItems.length);
    
    // 新的渲染方式：使用类似 MediaAssetsSidebar 的设计，每个素材项具有更丰富的视觉元素
    const html = renderItems.map((entry) => {
        const item = entry.data;
        // 统一判断堆叠组
        const isStack = item.isStack === true || item.type === 'stack';
        const isChild = entry.type === 'child';
        const isSelected = selectedMaterialIds.includes(item.id);
        const isDragover = dragOverTargetId === item.id;
        
        // 缩略图处理：堆叠组使用第一个子素材的缩略图，否则使用素材本身的 dataUrl
        let thumbUrl = '';
        if (isStack) {
            if (item.thumbnail) {
                thumbUrl = item.thumbnail;
            } else if (item.children && item.children.length > 0) {
                const firstChildId = item.children[0];
                const childMat = getState().materials.find(m => m.id === firstChildId);
                thumbUrl = childMat ? childMat.dataUrl : '';
            }
        } else {
            thumbUrl = item.dataUrl || '';
        }
        
        const typeLabel = isStack ? 'stack' : (item.type || 'image');
        const childCount = isStack
            ? (item.children ? item.children.length : getState().materials.filter(m => m.parentStackId === item.id).length)
            : 0;
        
        // 展开/折叠按钮
        let expandButtonHtml = '';
        if (isStack && childCount > 0) {
            const expandState = expandedStacks.get(item.id);
            expandButtonHtml = `
                <button class="mat-stack-expand-btn" data-id="${item.id}" title="${expandState ? '折叠' : '展开'}">
                    ${expandState ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>'}
                </button>
            `;
        }
        
        // 堆叠组显示的叠加层数图标
        let stackOverlayHtml = '';
        if (isStack) {
            stackOverlayHtml = `
                <div class="mat-stack-overlay">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><line x1="8" y1="2" x2="8" y2="22"></line><line x1="16" y1="2" x2="16" y2="22"></line></svg>
                    <span class="mat-stack-count">${childCount}</span>
                </div>
            `;
        }
        
        const selectedClass = isSelected ? 'mat-selected' : '';
        const dragoverClass = isDragover ? 'mat-dragover' : '';
        const childClass = isChild ? 'mat-child-item' : '';
        
        // 添加拖拽视觉反馈的额外类
        const dragActiveClass = dragSourceIds.includes(item.id) ? 'mat-drag-source' : '';
        
        return `
            <div class="mat-item ${selectedClass} ${dragoverClass} ${childClass} ${dragActiveClass}" data-id="${item.id}" data-stack="${isStack}" data-parent-stack="${isChild ? entry.parentStackId : ''}" draggable="true">
                <div class="mat-item-thumb">
                    <img src="${thumbUrl}" alt="${escapeHtml(item.name)}" draggable="false">
                    ${stackOverlayHtml}
                </div>
                <div class="mat-item-info">
                    <div class="mat-item-name">${escapeHtml(item.name)}</div>
                    <div class="mat-item-type">${typeLabel}</div>
                </div>
                <div class="mat-item-actions">
                    ${expandButtonHtml}
                    <button class="mat-remove-btn" data-id="${item.id}" title="删除">×</button>
                </div>
            </div>
        `;
    }).join('');
    
    // 如果列表为空，显示空状态
    const finalHtml = html || `
        <div class="mat-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M4 4h16v16H4z"/><path d="M9 9h6v6H9z"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/></svg>
            <p>暂无素材</p>
            <span class="mat-empty-hint">点击 + 添加图片或从画布右键添加</span>
        </div>
    `;
    materialListContainer.innerHTML = finalHtml;
    
    bindItemEvents();
}

function bindItemEvents() {
    if (!materialListContainer) return;
    
    // 点击选择（支持 Ctrl/Shift 多选）
    materialListContainer.querySelectorAll('.mat-item').forEach(el => {
        el.removeEventListener('click', handleItemClick);
        el.addEventListener('click', handleItemClick);
        // 拖拽事件
        el.removeEventListener('dragstart', handleDragStart);
        el.addEventListener('dragstart', handleDragStart);
        el.removeEventListener('dragend', handleDragEnd);
        el.addEventListener('dragend', handleDragEnd);
        el.removeEventListener('dragover', handleDragOver);
        el.addEventListener('dragover', handleDragOver);
        el.removeEventListener('dragleave', handleDragLeave);
        el.addEventListener('dragleave', handleDragLeave);
        el.removeEventListener('drop', handleDrop);
        el.addEventListener('drop', handleDrop);
    });
    
    // 删除按钮
    materialListContainer.querySelectorAll('.mat-remove-btn').forEach(btn => {
        btn.removeEventListener('click', handleRemoveClick);
        btn.addEventListener('click', handleRemoveClick);
    });
    
    // 堆叠组展开/折叠按钮（使用事件委托，避免重新绑定）
    if (!materialListContainer._stackExpandHandler) {
        materialListContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.mat-stack-expand-btn');
            if (!btn) return;
            e.stopPropagation();
            const stackId = btn.dataset.id;
            if (!stackId) return;
            const currentlyExpanded = expandedStacks.get(stackId);
            console.log('[展开调试] 点击展开按钮, stackId:', stackId, '当前展开状态:', currentlyExpanded);
            if (currentlyExpanded) {
                expandedStacks.delete(stackId);
            } else {
                expandedStacks.set(stackId, true);
            }
            console.log('[展开调试] 更新后 expandedStacks:', Array.from(expandedStacks.entries()));
            renderMaterialLibrary();
        });
        materialListContainer._stackExpandHandler = true;
    }
    
    // 添加全局调试点：输出当前 expandedStacks 内容
    window.__debugExpandedStacks = () => console.log('当前 expandedStacks:', Array.from(expandedStacks.entries()));
    
    // 添加根区域的拖拽高亮
    const materialRoot = materialListContainer;
    if (!materialRoot._rootDragHandler) {
        materialRoot.addEventListener('dragover', (e) => {
            if (!e.target.closest('.mat-item')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                materialRoot.classList.add('mat-root-dragover');
            }
        });
        materialRoot.addEventListener('dragleave', (e) => {
            if (!e.target.closest('.mat-item')) {
                materialRoot.classList.remove('mat-root-dragover');
            }
        });
        materialRoot.addEventListener('drop', async (e) => {
            materialRoot.classList.remove('mat-root-dragover');
            // 交由现有的根区域 drop 逻辑处理（已在 initRootDropTarget 中实现）
        });
        materialRoot._rootDragHandler = true;
    }
}

function handleItemClick(e) {
    const target = e.target.closest('.mat-item');
    if (!target) return;
    if (target.querySelector('.mat-stack-expand-btn')?.contains(e.target)) return;
    e.stopPropagation();
    
    const id = target.dataset.id;
    const item = findItemById(id);
    if (!item) return;
    
    if (e.ctrlKey || e.metaKey) {
        if (selectedMaterialIds.includes(id)) {
            selectedMaterialIds = selectedMaterialIds.filter(i => i !== id);
        } else {
            selectedMaterialIds.push(id);
        }
    } else if (e.shiftKey && lastClickedIndex !== -1) {
        const items = Array.from(materialListContainer.querySelectorAll('.mat-item:not(.mat-child-item)'));
        const currentIdx = items.findIndex(el => el.dataset.id === id);
        if (currentIdx !== -1) {
            const start = Math.min(lastClickedIndex, currentIdx);
            const end = Math.max(lastClickedIndex, currentIdx);
            const idsInRange = items.slice(start, end + 1).map(el => el.dataset.id);
            selectedMaterialIds = [...new Set([...selectedMaterialIds, ...idsInRange])];
        }
    } else {
        selectedMaterialIds = [id];
    }
    
    const allItems = Array.from(materialListContainer.querySelectorAll('.mat-item:not(.mat-child-item)'));
    lastClickedIndex = allItems.findIndex(el => el.dataset.id === id);
    
    setState({ selectedMaterialIds });
    renderMaterialLibrary();
}

function handleRemoveClick(e) {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    removeMaterial(id);
    selectedMaterialIds = selectedMaterialIds.filter(i => i !== id);
    setState({ selectedMaterialIds });
    renderMaterialLibrary();
    showToast('素材已删除', 'success');
}

// handleStackExpand 已通过委托处理，移除原函数（避免冲突）

function handleDragStart(e) {
    const target = e.target.closest('.mat-item');
    if (!target) return;
    const id = target.dataset.id;
    const parentStack = target.dataset.parentStack || null;
    
    // 如果当前拖拽的素材不在选中列表中，则将其设为唯一选中（但不重新渲染，以免破坏拖拽）
    if (!selectedMaterialIds.includes(id)) {
        selectedMaterialIds = [id];
        // 注意：不调用 setState 和 renderMaterialLibrary，避免拖拽源被销毁
    }
    
    dragSourceIds = [...selectedMaterialIds];
    dragSourceParentStackId = parentStack;
    
    // 设置拖拽数据（用于外部拖拽到画布或输入框）
    const item = findItemById(id);
    if (item && !item.isStack) {
        e.dataTransfer.setData('application/json', JSON.stringify({
            name: item.name,
            dataUrl: item.dataUrl
        }));
    } else if (item && item.isStack && item.children.length) {
        const firstChildId = item.children[0];
        const firstChild = getState().materials.find(m => m.id === firstChildId);
        if (firstChild) {
            e.dataTransfer.setData('application/json', JSON.stringify({
                name: firstChild.name,
                dataUrl: firstChild.dataUrl
            }));
        }
    }
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    // 拖拽结束后，刷新 UI 以同步选中高亮
    // 注意：不立即重绘，避免破坏 drop 效果，延迟一下
    setTimeout(() => {
        renderMaterialLibrary();
    }, 20);
    dragSourceIds = [];
    dragOverTargetId = null;
    dragSourceParentStackId = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.mat-item');
    if (!target) {
        dragOverTargetId = null;
        return;
    }
    const targetId = target.dataset.id;
    // 不允许拖拽到自己或正在拖拽的集合中的元素
    if (dragSourceIds.includes(targetId)) {
        dragOverTargetId = null;
        return;
    }
    dragOverTargetId = targetId;
    renderMaterialLibrary();
}

function handleDragLeave(e) {
    dragOverTargetId = null;
    renderMaterialLibrary();
}

async function handleDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.mat-item');
    
    // 处理外部拖拽（例如从画布拖拽图片到素材库）
    if (dragSourceIds.length === 0) {
        const jsonData = e.dataTransfer.getData('application/json');
        if (jsonData) {
            try {
                const { name, dataUrl } = JSON.parse(jsonData);
                if (dataUrl) {
                    await addMaterial(name, dataUrl, currentTab);
                    showToast(`素材“${name}”已添加到素材库`, 'success');
                    renderMaterialLibrary();
                }
            } catch (err) {
                console.error('解析外部拖拽数据失败:', err);
            }
        }
        // 清除拖拽状态
        dragSourceIds = [];
        dragOverTargetId = null;
        dragSourceParentStackId = null;
        renderMaterialLibrary();
        return;
    }
    
    // 如果没有目标元素，视为拖拽到根区域
    if (!target) {
        // 移出到根区域
        if (dragSourceIds.length) {
            // 移动到根（解散组）
            moveMaterialToStack(dragSourceIds, null);
            selectedMaterialIds = [];
            setState({ selectedMaterialIds });
            renderMaterialLibrary();
            showToast('已移出素材', 'success');
        }
        dragSourceIds = [];
        dragOverTargetId = null;
        dragSourceParentStackId = null;
        renderMaterialLibrary();
        return;
    }
    
    const targetId = target.dataset.id;
    const targetIsStack = target.dataset.stack === 'true';
    const targetParentStack = target.dataset.parentStack || null;
    
    // 确定目标对象的实际类型和目标组ID
    let targetStackId = null;
    let shouldCreateNewStack = false;
    
    if (targetIsStack) {
        // 目标是堆叠组，直接加入该组
        targetStackId = targetId;
    } else {
        // 目标是普通素材，需要创建新堆叠组
        shouldCreateNewStack = true;
        // 如果目标素材本身属于某个堆叠组？理论上普通素材不会是子项，子项有 parent-stack
        if (targetParentStack) {
            // 如果目标是堆叠组的子项，那么应该加入其父堆叠组
            targetStackId = targetParentStack;
            shouldCreateNewStack = false;
        }
    }
    
    if (dragSourceIds.length === 0) return;
    
    if (shouldCreateNewStack) {
        // 创建新堆叠组，包含所有源素材和目标素材
        const allIds = [...dragSourceIds, targetId];
        const category = currentTab; // 使用当前标签页作为组类别
        const newStack = createMaterialStack(allIds, category, 'Group');
        if (newStack) {
            // 如果创建成功，清除选中
            selectedMaterialIds = [];
            setState({ selectedMaterialIds });
            renderMaterialLibrary();
            showToast('已创建堆叠组', 'success');
        } else {
            showToast('创建堆叠组失败', 'error');
        }
    } else if (targetStackId) {
        // 加入已有堆叠组
        moveMaterialToStack(dragSourceIds, targetStackId);
        selectedMaterialIds = [];
        setState({ selectedMaterialIds });
        renderMaterialLibrary();
        showToast('已加入堆叠组', 'success');
    } else {
        // 其他情况：移出到根
        moveMaterialToStack(dragSourceIds, null);
        selectedMaterialIds = [];
        setState({ selectedMaterialIds });
        renderMaterialLibrary();
        showToast('已移出素材', 'success');
    }
    
    dragSourceIds = [];
    dragOverTargetId = null;
    dragSourceParentStackId = null;
    renderMaterialLibrary();
}

function findItemById(id) {
    const { materials, materialStacks } = getState();
    const fromMaterials = materials.find(m => m.id === id);
    if (fromMaterials) return fromMaterials;
    const fromStacks = materialStacks.find(s => s.id === id);
    return fromStacks || null;
}

// 根区域拖拽处理
function initRootDropTarget() {
    if (!materialListContainer) return;
    materialListContainer.addEventListener('dragover', (e) => {
        // 只要鼠标不在素材项上，就认为是根区域拖拽（接受外部拖拽）
        if (!e.target.closest('.mat-item')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    });
    materialListContainer.addEventListener('drop', async (e) => {
        // 如果拖拽源是空的，则可能是外部拖拽（从画布拖图片）
        if (dragSourceIds.length === 0) {
            e.preventDefault();
            const jsonData = e.dataTransfer.getData('application/json');
            if (jsonData) {
                try {
                    const { name, dataUrl } = JSON.parse(jsonData);
                    if (dataUrl) {
                        await addMaterial(name, dataUrl, currentTab);
                        showToast(`素材“${name}”已添加到素材库`, 'success');
                        renderMaterialLibrary();
                    }
                } catch (err) {
                    console.error('解析外部拖拽数据失败:', err);
                }
            }
            return;
        }
        // 内部拖拽到根区域：移出到根
        if (!e.target.closest('.mat-item') && dragSourceIds.length > 0) {
            e.preventDefault();
            moveMaterialToStack(dragSourceIds, null);
            selectedMaterialIds = [];
            setState({ selectedMaterialIds });
            renderMaterialLibrary();
            showToast('已移出素材', 'success');
            dragSourceIds = [];
            dragOverTargetId = null;
            dragSourceParentStackId = null;
        }
    });
}

// 搜索和标签切换
function setupUI() {
    const searchInput = document.querySelector('#materialSearchInput');
    const generatedTab = document.querySelector('#materialTabGenerated');
    const importedTab = document.querySelector('#materialTabImported');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderMaterialLibrary();
        });
    }
    if (generatedTab && importedTab) {
        generatedTab.addEventListener('click', () => {
            currentTab = 'Generated';
            generatedTab.classList.add('active');
            importedTab.classList.remove('active');
            renderMaterialLibrary();
        });
        importedTab.addEventListener('click', () => {
            currentTab = 'Imported';
            importedTab.classList.add('active');
            generatedTab.classList.remove('active');
            renderMaterialLibrary();
        });
        if (currentTab === 'Generated') {
            generatedTab.classList.add('active');
            importedTab.classList.remove('active');
        } else {
            importedTab.classList.add('active');
            generatedTab.classList.remove('active');
        }
    }
    
    if (addMaterialBtn && materialFileInput) {
        addMaterialBtn.addEventListener('click', () => {
            materialFileInput.click();
        });
        materialFileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        const dataUrl = ev.target.result;
                        const name = file.name;
                        await addMaterial(name, dataUrl, currentTab);
                        renderMaterialLibrary();
                        showToast(`已添加素材: ${name}`, 'success');
                    };
                    reader.readAsDataURL(file);
                }
            }
            materialFileInput.value = '';
        });
    }
}

function subscribeToStore() {
    subscribe('materials', () => {
        renderMaterialLibrary();
    });
    subscribe('materialStacks', () => {
        renderMaterialLibrary();
    });
    subscribe('canvasItems', () => {
        syncCanvasImagesToMaterialLibrary();
    });
}

export async function initMaterialLibrary() {
    materialListContainer = document.querySelector('.material-list');
    addMaterialBtn = document.querySelector('#addMaterialBtn');
    materialFileInput = document.querySelector('#materialFileInput');
    
    if (!materialListContainer) return;
    
    const materialSection = document.querySelector('.material-section');
    if (materialSection && !document.querySelector('#materialSearchInput')) {
        const toolbarHtml = `
            <div class="mat-toolbar">
                <div class="mat-tabs">
                    <button id="materialTabImported" class="mat-tab active">导入的</button>
                    <button id="materialTabGenerated" class="mat-tab">生成的</button>
                </div>
                <div class="mat-search">
                    <input type="text" id="materialSearchInput" placeholder="搜索素材..." autocomplete="off">
                </div>
            </div>
        `;
        const header = materialSection.querySelector('.material-header');
        if (header) {
            header.insertAdjacentHTML('afterend', toolbarHtml);
        } else {
            materialSection.insertAdjacentHTML('afterbegin', toolbarHtml);
        }
    }
    
    setupUI();
    subscribeToStore();
    initRootDropTarget();
    
    // 强制同步画布图片到素材库，确保素材库不为空
    const { materials, canvasItems } = getState();
    if (materials.length === 0 && canvasItems.length > 0) {
        console.log('[素材库] 检测到素材库为空但画布有内容，自动同步...');
        await _syncCanvasImagesToMaterialLibrary();
        showToast('已自动从画布同步图片到素材库', 'success');
    } else {
        await _syncCanvasImagesToMaterialLibrary();
    }
    renderMaterialLibrary();
}
