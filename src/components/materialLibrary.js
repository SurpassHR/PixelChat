import { getState, setState, subscribe, addMaterial, removeMaterial, createMaterialStack, ungroupMaterialStack, moveMaterialToStack, getFlattenedMaterialItems } from '../store.js';
import { showToast } from '../toast.js';

// ============================================================
// 1. 注入全局样式（模拟 Tailwind 的设计系统）
// ============================================================
if (!document.getElementById('material-library-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'material-library-styles';
    styleSheet.textContent = `
        /* 基础重置与颜色变量 */
        .mat2-root {
            --bg-base: #0a0a0a;
            --bg-surface: #121212;
            --bg-hover: #1a1a1a;
            --border: #2a2a2a;
            --text-primary: #e0e0e0;
            --text-secondary: #9ca3af;
            --accent: #3b82f6;
            --accent-dark: #2563eb;
            --danger: #ef4444;
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .mat2-root * {
            box-sizing: border-box;
        }
        /* 布局 - 只保留侧边栏，占满父容器 */
        .mat2-root {
            height: 100%;
        }
        .mat2-sidebar {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            background-color: var(--bg-surface);
            user-select: none;
            box-shadow: none; /* 去掉阴影，更加融合 */
        }
        /* 头部 */
        .mat2-header {
            padding: 1rem 1rem 0.5rem 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .mat2-title {
            font-size: 1.125rem;
            font-weight: bold;
            color: white;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .mat2-badge {
            font-size: 0.625rem;
            background-color: var(--accent);
            padding: 0.125rem 0.5rem;
            border-radius: 9999px;
        }
        /* 搜索框 */
        .mat2-search {
            padding: 0 1rem 0.5rem 1rem;
        }
        .mat2-search .relative {
            position: relative;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .mat2-search-icon {
            position: absolute;
            left: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            width: 1rem;
            height: 1rem;
            color: #6b7280;
        }
        .mat2-search-input {
            width: 100%;
            background-color: #1e1e1e;
            border: 1px solid var(--border);
            border-radius: 0.375rem;
            padding: 0.375rem 0.75rem 0.375rem 2rem;
            font-size: 0.875rem;
            color: var(--text-primary);
            outline: none;
        }
        .mat2-search-input:focus {
            border-color: var(--accent);
        }
        /* 标签页 Tabs */
        .mat2-tabs {
            padding: 0.75rem 1rem;
        }
        .mat2-tab-group {
            display: flex;
            background-color: var(--bg-base);
            border-radius: 0.5rem;
            padding: 0.25rem;
        }
        .mat2-tab {
            flex: 1;
            padding: 0.375rem 0;
            font-size: 0.875rem;
            font-weight: 500;
            border-radius: 0.375rem;
            transition: all 0.2s;
            background: transparent;
            border: none;
            color: #6b7280;
            cursor: pointer;
        }
        .mat2-tab.active {
            background-color: #2d2d2d;
            color: white;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .mat2-tab:not(.active):hover {
            color: #d1d5db;
        }
        /* 资产列表容器（可拖拽区域） */
        .mat2-list-container {
            flex: 1;
            overflow-y: auto;
            transition: background-color 0.3s;
        }
        .mat2-list-container.drag-over-root {
            background-color: rgba(59,130,246,0.05);
            outline: 2px solid rgba(59,130,246,0.2);
            outline-offset: -2px;
        }
        .mat2-root-hint {
            position: sticky;
            top: 0;
            z-index: 50;
            background-color: var(--accent);
            padding: 0.25rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-size: 0.625rem;
            font-weight: bold;
            color: white;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        /* 列表项 */
        .mat2-item {
            display: flex;
            flex-direction: column;
            cursor: grab;
            user-select: none;
        }
        .mat2-item-row {
            display: flex;
            align-items: center;
            padding: 0.625rem 1rem;
            border-bottom: 1px solid var(--border);
            transition: all 0.2s;
            background-color: transparent;
        }
        .mat2-item-row.selected {
            background-color: rgba(59,130,246,0.2);
            border-left: 2px solid var(--accent);
        }
        .mat2-item-row.drag-over {
            background-color: rgba(59,130,246,0.4);
            outline: 2px solid var(--accent);
            outline-offset: -2px;
            transform: scale(0.98);
        }
        .mat2-item-row.drag-source {
            opacity: 0.4;
        }
        .mat2-item-row.nested {
            background-color: #0d0d0d;
            padding-left: 2.5rem;
        }
        /* 缩略图区域 */
        .mat2-thumb-wrapper {
            position: relative;
            margin-right: 0.75rem;
            flex-shrink: 0;
        }
        .mat2-stack-overlay-bg {
            position: absolute;
            top: -2px;
            left: 2px;
            width: 48px;
            height: 48px;
            background-color: #2a2a2a;
            border-radius: 4px;
            border: 1px solid #3a3a3a;
            z-index: 0;
        }
        .mat2-stack-overlay-bg2 {
            position: absolute;
            top: -4px;
            left: 4px;
            width: 48px;
            height: 48px;
            background-color: #3a3a3a;
            border-radius: 4px;
            border: 1px solid #4a4a4a;
            z-index: 0;
        }
        .mat2-thumb {
            position: relative;
            width: 48px;
            height: 48px;
            background-color: #0a0a0a;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid var(--border);
            z-index: 1;
        }
        .mat2-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.9;
            transition: opacity 0.2s;
        }
        .mat2-item:hover .mat2-thumb img {
            opacity: 1;
        }
        .mat2-stack-badge {
            position: absolute;
            bottom: 0;
            right: 0;
            background-color: var(--accent);
            padding: 0 0.25rem;
            border-top-left-radius: 4px;
            font-size: 9px;
            font-weight: bold;
            color: white;
            display: flex;
            align-items: center;
            gap: 2px;
        }
        /* 信息区 */
        .mat2-info {
            flex: 1;
            min-width: 0;
        }
        .mat2-name {
            font-size: 0.875rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mat2-name.selected {
            color: white;
            font-weight: 500;
        }
        .mat2-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 2px;
        }
        .mat2-type {
            font-size: 0.625rem;
            text-transform: uppercase;
            font-weight: 600;
        }
        .mat2-type.selected {
            color: #93c5fd;
        }
        /* 右侧按钮组 */
        .mat2-actions {
            display: flex;
            align-items: center;
            gap: 0.25rem;
        }
        .mat2-action-btn {
            padding: 0.25rem;
            border-radius: 4px;
            background: transparent;
            border: none;
            cursor: pointer;
            color: #6b7280;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .mat2-action-btn:hover {
            background-color: rgba(255,255,255,0.1);
        }
        .mat2-ungroup-btn:hover {
            background-color: rgba(239,68,68,0.3);
            color: #f87171;
        }
        .mat2-expand-btn {
            padding: 0.25rem;
            border-radius: 4px;
            background: transparent;
            border: none;
            cursor: pointer;
            color: #6b7280;
        }
        .mat2-expand-btn:hover {
            background-color: rgba(255,255,255,0.1);
            color: white;
        }
        /* 空状态 */
        .mat2-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 160px;
            color: #4b5563;
            opacity: 0.3;
            pointer-events: none;
        }
        .mat2-empty svg {
            width: 2rem;
            height: 2rem;
            margin-bottom: 0.5rem;
        }
        /* 自定义滚动条 */
        .mat2-list-container::-webkit-scrollbar {
            width: 4px;
        }
        .mat2-list-container::-webkit-scrollbar-track {
            background: transparent;
        }
        .mat2-list-container::-webkit-scrollbar-thumb {
            background: #2a2a2a;
            border-radius: 10px;
        }
        .mat2-list-container::-webkit-scrollbar-thumb:hover {
            background: #444;
        }
        /* 动画 */
        @keyframes fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slide-in {
            from { transform: translateY(-4px); }
            to { transform: translateY(0); }
        }
        .mat2-animate-in {
            animation: fade-in 150ms forwards, slide-in 150ms forwards;
        }
    `;
    document.head.appendChild(styleSheet);
}

// ============================================================
// 2. 全局状态 (模仿 React 组件的内部状态)
// ============================================================
let selectedMaterialIds = [];        // 选中的素材 ID 列表（独立、堆叠组、子项均可选）
let dragSourceIds = [];              // 拖拽的源 ID 列表
let dragOverTargetId = null;         // 当前高亮的目标 ID
let dragSourceParentStackId = null;  // 如果拖拽子项，记录父堆叠组 ID
let currentTab = 'Imported';         // 'Imported' or 'Generated'
let searchQuery = '';
let expandedStacks = new Map();       // 堆叠组展开状态
let lastClickedIndex = -1;            // 用于 Shift 多选

// DOM 元素引用
let sidebarRoot = null;               // 整个侧边栏根节点
let workspacePlaceholder = null;      // 右侧占位区
let listContainer = null;             // 资产列表容器
let searchInput = null;
let generatedTabBtn = null;
let importedTabBtn = null;
let selectionBadge = null;

// 与 store 的订阅取消函数
let unsubscribeMaterials = null;
let unsubscribeStacks = null;

// ============================================================
// 3. 辅助函数：从 store 获取原始数据并构造成 UI 需要的树形结构
// ============================================================
function getUiItems() {
    const { materials, materialStacks } = getState();
    // 获取当前标签页下的独立素材（parentStackId 为 null 或 undefined）
    const independentItems = materials.filter(m => 
        (!m.parentStackId) && m.category === currentTab &&
        (searchQuery ? m.name.toLowerCase().includes(searchQuery.toLowerCase()) : true)
    );
    // 获取当前标签页下的堆叠组
    const stacks = materialStacks.filter(s => s.category === currentTab);
    // 过滤堆叠组名称搜索
    const filteredStacks = stacks.filter(s => 
        searchQuery ? s.name.toLowerCase().includes(searchQuery.toLowerCase()) : true
    );
    // 为每个堆叠组获取其子素材
    const itemsWithChildren = filteredStacks.map(stack => {
        const children = materials.filter(m => m.parentStackId === stack.id);
        // 子素材也支持搜索（如果堆叠组本身匹配，则显示所有子项；否则根据子项名称过滤）
        let filteredChildren = children;
        if (searchQuery && !stack.name.toLowerCase().includes(searchQuery.toLowerCase())) {
            filteredChildren = children.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        return { ...stack, children: filteredChildren, isStack: true };
    });
    // 合并独立素材和堆叠组，并排序（保持原有顺序）
    const all = [...independentItems, ...itemsWithChildren];
    return all;
}

// ============================================================
// 4. 渲染 UI（完全模拟 React 组件的结构）
// ============================================================
function render() {
    if (!sidebarRoot) return;
    const items = getUiItems();
    const selectedCount = selectedMaterialIds.length;
    if (selectionBadge) {
        selectionBadge.textContent = selectedCount > 0 ? selectedCount : '';
        selectionBadge.style.display = selectedCount > 0 ? 'inline-block' : 'none';
    }
    // 生成列表 HTML
    let listHtml = '';
    if (items.length === 0) {
        listHtml = `<div class="mat2-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16v16H4z"/><path d="M9 9h6v6H9z"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/></svg>
            <p>Empty Folder</p>
        </div>`;
    } else {
        listHtml = renderItemsList(items);
    }
    listContainer.innerHTML = listHtml;
    // 重新绑定事件
    bindItemEvents();
    // 更新根区域拖拽样式
    updateRootDragHighlight();
}

function renderItemsList(items, nestedLevel = 0) {
    return items.map(item => {
        const isStack = item.isStack === true;
        const isSelected = selectedMaterialIds.includes(item.id);
        const isDragover = dragOverTargetId === item.id;
        const isDragSource = dragSourceIds.includes(item.id);
        const childCount = isStack ? (item.children?.length || 0) : 0;
        const isExpanded = expandedStacks.get(item.id);
        // 缩略图 URL
        let thumbUrl = '';
        if (isStack) {
            thumbUrl = item.thumbnail || (item.children?.[0]?.dataUrl) || '';
        } else {
            thumbUrl = item.dataUrl || '';
        }
        const nestedClass = nestedLevel > 0 ? 'nested' : '';
        // 渲染行
        const rowHtml = `
            <div class="mat2-item-row ${isSelected ? 'selected' : ''} ${isDragover ? 'drag-over' : ''} ${isDragSource ? 'drag-source' : ''} ${nestedClass}" 
                 data-id="${item.id}" 
                 data-is-stack="${isStack}"
                 data-parent-stack="${nestedLevel > 0 ? item.parentStackId : ''}"
                 draggable="true">
                <div class="mat2-thumb-wrapper">
                    ${isStack ? '<div class="mat2-stack-overlay-bg"></div><div class="mat2-stack-overlay-bg2"></div>' : ''}
                    <div class="mat2-thumb">
                        <img src="${thumbUrl}" alt="${escapeHtml(item.name)}" draggable="false">
                        ${isStack ? `<div class="mat2-stack-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/></svg>${childCount}</div>` : ''}
                    </div>
                </div>
                <div class="mat2-info">
                    <div class="mat2-name ${isSelected ? 'selected' : ''}">${escapeHtml(item.name)}</div>
                    <div class="mat2-meta">
                        <span class="mat2-type ${isSelected ? 'selected' : ''}">${isStack ? 'stack' : item.type || 'image'}</span>
                    </div>
                </div>
                <div class="mat2-actions">
                    ${isStack ? `
                        <button class="mat2-action-btn mat2-ungroup-btn" data-action="ungroup" data-id="${item.id}" title="Ungroup">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/></svg>
                        </button>
                        <button class="mat2-expand-btn" data-action="toggle-stack" data-id="${item.id}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                ${isExpanded ? '<polyline points="6 9 12 15 18 9"></polyline>' : '<polyline points="9 18 15 12 9 6"></polyline>'}
                            </svg>
                        </button>
                    ` : `
                        <div class="mat2-action-btn" style="opacity:0.4; cursor:default;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                        </div>
                    `}
                </div>
            </div>
        `;
        // 如果是堆叠组且展开，递归渲染子项
        let childrenHtml = '';
        if (isStack && isExpanded && item.children && item.children.length) {
            childrenHtml = `<div class="mat2-item" style="margin-left:0;">${renderItemsList(item.children, nestedLevel + 1)}</div>`;
        }
        return `<div class="mat2-item">${rowHtml}${childrenHtml}</div>`;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&';
        if (m === '<') return '<';
        if (m === '>') return '>';
        return m;
    });
}

// ============================================================
// 5. 事件处理（完全模仿 React 组件的行为）
// ============================================================
function handleItemClick(e, id, isStack, parentStackId) {
    e.stopPropagation();
    // 如果点击在按钮上，忽略选择
    if (e.target.closest('.mat2-action-btn') || e.target.closest('.mat2-expand-btn')) return;
    if (e.ctrlKey || e.metaKey) {
        // 多选切换
        if (selectedMaterialIds.includes(id)) {
            selectedMaterialIds = selectedMaterialIds.filter(i => i !== id);
        } else {
            selectedMaterialIds.push(id);
        }
    } else if (e.shiftKey && lastClickedIndex !== -1) {
        // 范围选择（简单实现：获取所有可见的 items 顺序）
        const allRows = Array.from(listContainer.querySelectorAll('.mat2-item-row:not(.nested)'));
        const currentIdx = allRows.findIndex(row => row.dataset.id === id);
        if (currentIdx !== -1) {
            const start = Math.min(lastClickedIndex, currentIdx);
            const end = Math.max(lastClickedIndex, currentIdx);
            const idsInRange = allRows.slice(start, end+1).map(row => row.dataset.id);
            const newSet = new Set(selectedMaterialIds);
            idsInRange.forEach(i => newSet.add(i));
            selectedMaterialIds = Array.from(newSet);
        }
    } else {
        // 普通单击，仅选中当前
        selectedMaterialIds = [id];
    }
    // 更新 lastClickedIndex
    const allRowsNow = Array.from(listContainer.querySelectorAll('.mat2-item-row:not(.nested)'));
    lastClickedIndex = allRowsNow.findIndex(row => row.dataset.id === id);
    updateSelectionBadge();
    render();  // 重新渲染以高亮
}

function handleDragStart(e, id, parentStackId = null) {
    if (!selectedMaterialIds.includes(id)) {
        // 如果拖拽的项不在选中集合，则只拖拽这一项
        selectedMaterialIds = [id];
        render();
    }
    dragSourceIds = [...selectedMaterialIds];
    dragSourceParentStackId = parentStackId;
    e.dataTransfer.setData('text/plain', JSON.stringify({ sourceIds: dragSourceIds, parentStackId }));
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e, targetId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragSourceIds.includes(targetId)) {
        dragOverTargetId = targetId;
        render();
    }
}

function handleDragLeave() {
    dragOverTargetId = null;
    render();
}

async function handleDrop(e, targetId, targetIsStack) {
    e.preventDefault();
    const rawData = e.dataTransfer.getData('text/plain');
    let sourceIds = dragSourceIds;
    let sourceParentStackId = dragSourceParentStackId;
    if (rawData) {
        try {
            const parsed = JSON.parse(rawData);
            sourceIds = parsed.sourceIds;
            sourceParentStackId = parsed.parentStackId;
        } catch(e) {}
    }
    if (!sourceIds.length) return;
    // 目标是自己或已经在拖拽源中，忽略
    if (targetId && sourceIds.includes(targetId)) return;
    // 调用 store 的移动/组合逻辑
    if (targetId === 'root') {
        // 移出到根（解散任何组关系），但仅当至少有一个素材属于堆叠组时才执行
        const { materials } = getState();
        const anyInStack = sourceIds.some(id => {
            const mat = materials.find(m => m.id === id);
            return mat && mat.parentStackId;
        });
        if (anyInStack) {
            await moveMaterialToStack(sourceIds, null);
            showToast('已移出到素材库根目录', 'success');
        }
        // 如果所有素材已经在根目录，不做任何操作，也不显示提示
    } else {
        // 目标是一个具体的素材或堆叠组
        const targetItem = findItemById(targetId);
        if (!targetItem) return;
        if (targetItem.isStack) {
            // 加入已有堆叠组
            await moveMaterialToStack(sourceIds, targetId);
            showToast('已加入堆叠组', 'success');
        } else {
            // 创建新堆叠组，包含目标素材和拖拽素材
            const allIds = [...sourceIds, targetId];
            const category = currentTab;
            const newStack = createMaterialStack(allIds, category, 'Group');
            if (newStack) {
                showToast('已创建堆叠组', 'success');
            } else {
                showToast('创建失败', 'error');
            }
        }
    }
    // 清理状态并重新渲染
    dragSourceIds = [];
    dragOverTargetId = null;
    dragSourceParentStackId = null;
    selectedMaterialIds = [];
    render();
}

async function handleUngroup(stackId) {
    await ungroupMaterialStack(stackId);
    showToast('已解散堆叠组', 'success');
    render();
}

function handleToggleStack(stackId) {
    const expanded = expandedStacks.get(stackId);
    if (expanded) {
        expandedStacks.delete(stackId);
    } else {
        expandedStacks.set(stackId, true);
    }
    render();
}

function findItemById(id) {
    const { materials, materialStacks } = getState();
    const fromMat = materials.find(m => m.id === id);
    if (fromMat) return fromMat;
    const fromStack = materialStacks.find(s => s.id === id);
    if (fromStack) return { ...fromStack, isStack: true };
    return null;
}

function updateSelectionBadge() {
    if (selectionBadge) {
        const cnt = selectedMaterialIds.length;
        selectionBadge.textContent = cnt > 0 ? cnt : '';
        selectionBadge.style.display = cnt > 0 ? 'inline-block' : 'none';
    }
}

function bindItemEvents() {
    // 绑定行点击
    listContainer.querySelectorAll('.mat2-item-row').forEach(row => {
        const id = row.dataset.id;
        const isStack = row.dataset.isStack === 'true';
        const parentStack = row.dataset.parentStack || null;
        row.removeEventListener('click', (e) => handleItemClick(e, id, isStack, parentStack));
        row.addEventListener('click', (e) => handleItemClick(e, id, isStack, parentStack));
        row.removeEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ sourceIds: dragSourceIds, parentStackId: dragSourceParentStackId }));
        });
        row.addEventListener('dragstart', (e) => handleDragStart(e, id, parentStack));
        row.removeEventListener('dragover', (e) => handleDragOver(e, id));
        row.addEventListener('dragover', (e) => handleDragOver(e, id));
        row.removeEventListener('dragleave', handleDragLeave);
        row.addEventListener('dragleave', handleDragLeave);
        row.removeEventListener('drop', (e) => {
            const isStackTarget = row.dataset.isStack === 'true';
            handleDrop(e, id, isStackTarget);
        });
        row.addEventListener('drop', (e) => {
            const isStackTarget = row.dataset.isStack === 'true';
            handleDrop(e, id, isStackTarget);
        });
    });
    // 绑定按钮事件 (使用委托)
    listContainer.querySelectorAll('.mat2-ungroup-btn').forEach(btn => {
        btn.removeEventListener('click', (e) => {
            e.stopPropagation();
            const stackId = btn.dataset.id;
            if (stackId) handleUngroup(stackId);
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const stackId = btn.dataset.id;
            if (stackId) handleUngroup(stackId);
        });
    });
    listContainer.querySelectorAll('.mat2-expand-btn').forEach(btn => {
        btn.removeEventListener('click', (e) => {
            e.stopPropagation();
            const stackId = btn.dataset.id;
            if (stackId) handleToggleStack(stackId);
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const stackId = btn.dataset.id;
            if (stackId) handleToggleStack(stackId);
        });
    });
}

function updateRootDragHighlight() {
    // 完全移除根区域的视觉反馈，避免任何闪烁
    // 拖拽到空白区域仍然可以放置，但不再显示高亮或提示条
}

// 根区域拖拽处理
function setupRootDropTarget() {
    listContainer.addEventListener('dragover', (e) => {
        if (!e.target.closest('.mat2-item-row')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dragOverTargetId = 'root';
            updateRootDragHighlight();
        }
    });
    listContainer.addEventListener('dragleave', (e) => {
        if (!listContainer.contains(e.relatedTarget)) {
            dragOverTargetId = null;
            updateRootDragHighlight();
        }
    });
    listContainer.addEventListener('drop', async (e) => {
        if (!e.target.closest('.mat2-item-row')) {
            e.preventDefault();
            await handleDrop(e, 'root', false);
            dragOverTargetId = null;
            updateRootDragHighlight();
        }
    });
}

// ============================================================
// 6. 初始化 UI 结构（完全按照 React 组件的布局）
// ============================================================
function buildDOM() {
    // 查找原有的 material-section 容器，如果没有则创建
    let materialSection = document.querySelector('.material-section');
    if (!materialSection) {
        materialSection = document.createElement('div');
        materialSection.className = 'material-section';
        const sidebar = document.querySelector('.sidebar'); // 假设有左侧边栏
        if (sidebar) sidebar.appendChild(materialSection);
        else document.body.appendChild(materialSection);
    }
    // 清空并重绘
    materialSection.innerHTML = '';
    materialSection.classList.add('mat2-root');
    // 只构建侧边栏，移除 workspace 占位区
    const sidebar = document.createElement('div');
    sidebar.className = 'mat2-sidebar';
    sidebar.style.width = '100%'; // 占满父容器宽度
    sidebar.style.borderLeft = 'none'; // 去掉左边框，因为不再是右侧面板
    sidebar.innerHTML = `
        <div class="mat2-header">
            <div class="mat2-title">
                Media Assets
                <span class="mat2-badge" style="display:none;">0</span>
            </div>
            <button id="addMaterialBtn2" class="mat2-action-btn" title="Add Material">+</button>
        </div>
        <div class="mat2-search">
            <div class="relative">
                <svg class="mat2-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
                <input type="text" class="mat2-search-input" placeholder="Search..." id="materialSearchInput2">
            </div>
        </div>
        <div class="mat2-tabs">
            <div class="mat2-tab-group">
                <button class="mat2-tab" data-tab="Generated">Generated</button>
                <button class="mat2-tab active" data-tab="Imported">Imported</button>
            </div>
        </div>
        <div class="mat2-list-container" id="materialListContainer2"></div>
        <input type="file" id="materialFileInput2" accept="image/*" multiple style="display:none;">
    `;
    materialSection.appendChild(sidebar);
    sidebarRoot = materialSection;
    workspacePlaceholder = null; // 不再使用
    listContainer = sidebar.querySelector('#materialListContainer2');
    searchInput = sidebar.querySelector('#materialSearchInput2');
    const addBtn = sidebar.querySelector('#addMaterialBtn2');
    const fileInput = sidebar.querySelector('#materialFileInput2');
    const generatedTab = sidebar.querySelector('.mat2-tab[data-tab="Generated"]');
    const importedTab = sidebar.querySelector('.mat2-tab[data-tab="Imported"]');
    selectionBadge = sidebar.querySelector('.mat2-badge');
    // 绑定事件
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        render();
    });
    generatedTab.addEventListener('click', () => {
        currentTab = 'Generated';
        generatedTab.classList.add('active');
        importedTab.classList.remove('active');
        selectedMaterialIds = [];
        render();
    });
    importedTab.addEventListener('click', () => {
        currentTab = 'Imported';
        importedTab.classList.add('active');
        generatedTab.classList.remove('active');
        selectedMaterialIds = [];
        render();
    });
    addBtn.addEventListener('click', () => {
        fileInput.click();
    });
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const dataUrl = ev.target.result;
                    await addMaterial(file.name, dataUrl, currentTab);
                    showToast(`已添加素材: ${file.name}`, 'success');
                    render();
                };
                reader.readAsDataURL(file);
            }
        }
        fileInput.value = '';
    });
    // 点击空白区域取消选中
    listContainer.addEventListener('click', (e) => {
        if (e.target === listContainer || e.target.classList.contains('mat2-list-container')) {
            selectedMaterialIds = [];
            render();
        }
    });
    setupRootDropTarget();
    // 订阅 store 变化
    if (unsubscribeMaterials) unsubscribeMaterials();
    if (unsubscribeStacks) unsubscribeStacks();
    unsubscribeMaterials = subscribe('materials', () => render());
    unsubscribeStacks = subscribe('materialStacks', () => render());
    render();
}

// ============================================================
// 7. 对外暴露的初始化函数（兼容现有调用）
// ============================================================
export async function initMaterialLibrary() {
    buildDOM();
    // 确保同步画布图片
    const { materials, canvasItems } = getState();
    if (materials.length === 0 && canvasItems.length > 0) {
        await _syncCanvasImagesToMaterialLibrary();
        showToast('已自动从画布同步图片到素材库', 'success');
    } else {
        await _syncCanvasImagesToMaterialLibrary();
    }
    render();
}

// 需要用到 _syncCanvasImagesToMaterialLibrary 函数，从原文件中复制（但为了独立，我们直接引用原模块？为避免循环，我们可以在本文件内实现一个简化版，但最好使用原有逻辑）
// 由于原文件有 syncCanvasImagesToMaterialLibrary，但我们现在重写了整个文件，需要把同步逻辑也移植过来。
// 以下简化版同步函数（调用 store 的 addMaterial）
async function _syncCanvasImagesToMaterialLibrary() {
    const { canvasItems, currentSessionId, sessions, materials } = getState();
    const session = sessions[currentSessionId];
    if (!session) return;
    const imagesToAdd = [];
    const seenUrls = new Set();
    // 构建现有素材库的 hash 映射以快速判断是否已存在（避免重复添加）
    const existingHashes = new Set();
    for (const mat of materials) {
        if (mat.dataHash) existingHashes.add(mat.dataHash);
    }
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
            // 检查是否可能已存在（通过 URL 或后续 hash），但为了避免复杂，我们仍然调用 addMaterial，
            // 但 addMaterial 已修改为不会自动破坏堆叠组，且会跳过重复。不过为了性能，我们可以提前过滤：
            // 对于已经是本地 /api/images/ 的 URL，可以尝试推断 hash？为了简单，仍调用 addMaterial，因为 addMaterial 现在是安全的。
            let name = item.prompt ? item.prompt.slice(0, 30) + (item.prompt.length > 30 ? '...' : '') : `image_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
            imagesToAdd.push({ name, url: item.imageUrl, category });
        }
    }
    for (const img of imagesToAdd) {
        await addMaterial(img.name, img.url, img.category);
    }
}
