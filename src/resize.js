/**
 * 侧边栏拖拽调整宽度功能
 */

const STORAGE_KEY_LEFT = 'sidebar-left-width';
const STORAGE_KEY_RIGHT = 'sidebar-right-width';

// 宽度限制
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

// 拖拽状态
let isResizing = false;
let activeHandle = null;         // 'left' 或 'right'
let startX = 0;
let startWidth = 0;

/**
 * 设置左侧栏宽度并保存
 */
function setLeftWidth(width) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    sidebar.style.width = width + 'px';
    localStorage.setItem(STORAGE_KEY_LEFT, width);
}

/**
 * 设置右侧栏宽度并保存
 */
function setRightWidth(width) {
    const sidebarRight = document.querySelector('.sidebar-right');
    if (!sidebarRight) return;
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    sidebarRight.style.width = width + 'px';
    localStorage.setItem(STORAGE_KEY_RIGHT, width);
}

/**
 * 从 localStorage 加载保存的宽度，并应用到侧边栏
 */
export function loadResizeWidths() {
    const savedLeft = localStorage.getItem(STORAGE_KEY_LEFT);
    if (savedLeft !== null) {
        const width = parseInt(savedLeft, 10);
        if (!isNaN(width)) {
            setLeftWidth(width);
        }
    }
    const savedRight = localStorage.getItem(STORAGE_KEY_RIGHT);
    if (savedRight !== null) {
        const width = parseInt(savedRight, 10);
        if (!isNaN(width)) {
            setRightWidth(width);
        }
    }
}

/**
 * 开始拖拽调整
 */
function startResize(e, handle) {
    if (e.button !== 0) return; // 只响应左键
    e.preventDefault();

    activeHandle = handle;
    startX = e.clientX;

    if (handle === 'left') {
        const sidebar = document.querySelector('.sidebar');
        startWidth = sidebar ? sidebar.offsetWidth : 320;
    } else if (handle === 'right') {
        const sidebarRight = document.querySelector('.sidebar-right');
        startWidth = sidebarRight ? sidebarRight.offsetWidth : 320;
    }

    isResizing = true;

    // 全局样式避免选中文本
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // 添加全局事件监听
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

/**
 * 拖拽中
 */
function onMouseMove(e) {
    if (!isResizing) return;

    let delta = e.clientX - startX;
    let newWidth = startWidth;

    if (activeHandle === 'left') {
        // 左侧栏拖拽：向右拖拽增加宽度
        newWidth = startWidth + delta;
        setLeftWidth(newWidth);
    } else if (activeHandle === 'right') {
        // 右侧栏拖拽：向左拖拽增加宽度（因为手柄在右侧栏左侧，鼠标左移时 delta 为负，宽度应增加）
        // 注意：右侧栏的位置在右边，拖拽向左移动时，宽度需要变大
        newWidth = startWidth - delta;
        setRightWidth(newWidth);
    }
}

/**
 * 结束拖拽
 */
function onMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    activeHandle = null;

    // 恢复全局样式
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // 移除全局事件监听
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
}

/**
 * 初始化拖拽手柄
 */
export function initResizeHandles() {
    const leftHandle = document.querySelector('.resize-handle-left');
    const rightHandle = document.querySelector('.resize-handle-right');

    if (leftHandle) {
        leftHandle.addEventListener('mousedown', (e) => startResize(e, 'left'));
    }
    if (rightHandle) {
        rightHandle.addEventListener('mousedown', (e) => startResize(e, 'right'));
    }

    // 可选：双击手柄恢复默认宽度
    const DEFAULT_WIDTH = 320;
    if (leftHandle) {
        leftHandle.addEventListener('dblclick', () => {
            setLeftWidth(DEFAULT_WIDTH);
        });
    }
    if (rightHandle) {
        rightHandle.addEventListener('dblclick', () => {
            setRightWidth(DEFAULT_WIDTH);
        });
    }
}