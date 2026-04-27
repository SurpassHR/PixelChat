/**
 * 通用拖拽调整大小系统
 * 支持水平 (col-resize) 和垂直 (row-resize) 两种方向
 */

// 存储 key 映射 — 已有 key 保持兼容
const STORAGE_MAP = {
  'sidebar-left-width': 'sidebar-left-width',
  'sidebar-right-width': 'sidebar-right-width',
};

function storageKey(id) {
  return STORAGE_MAP[id] || 'resize-' + id;
}

// 通用配置
const HANDLERS = [
  {
    id: 'sidebar-left-width',
    handle: '.resize-handle-left',
    direction: 'horizontal',
    target: '.sidebar',
    min: 200,
    max: 500,
    default: 320,
    reverse: false,
  },
  {
    id: 'sidebar-right-width',
    handle: '.resize-handle-right',
    direction: 'horizontal',
    target: '.sidebar-right',
    min: 200,
    max: 500,
    default: 320,
    reverse: true,
  },
  {
    id: 'history-section-height',
    handle: '.resize-handle-history',
    direction: 'vertical',
    target: '.history-section',
    min: 60,
    max: null,
    default: null,
    reverse: false,
    getMax() {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return 9999;
      const log = document.querySelector('#taskLogSection');
      const tq = document.querySelector('.taskqueue-section:not(#taskLogSection)');
      const handles = sidebar.querySelectorAll('.resize-handle-h');
      const other = (log ? Math.max(60, log.offsetHeight || 60) : 60)
        + (tq ? Math.max(60, tq.offsetHeight || 60) : 60);
      return sidebar.clientHeight - other - handles.length * 4;
    },
  },
  {
    id: 'log-section-height',
    handle: '.resize-handle-log',
    direction: 'vertical',
    target: '#taskLogSection',
    min: 60,
    max: null,
    default: null,
    reverse: false,
    getMax() {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return 9999;
      const history = document.querySelector('.history-section');
      const tq = document.querySelector('.taskqueue-section:not(#taskLogSection)');
      const handles = sidebar.querySelectorAll('.resize-handle-h');
      const other = (history ? Math.max(60, history.offsetHeight || 60) : 60)
        + (tq ? Math.max(60, tq.offsetHeight || 60) : 60);
      return sidebar.clientHeight - other - handles.length * 4;
    },
  },
  {
    id: 'settings-sidebar-width',
    handle: '.resize-handle-settings',
    direction: 'horizontal',
    target: '.settings-sidebar',
    min: 150,
    max: 400,
    default: 220,
    reverse: false,
  },
];

// 运行时状态
let active = null;
let startPos = 0;
let startSize = 0;

function isHoriz(cfg) {
  return cfg.direction === 'horizontal';
}

/**
 * 从 localStorage 恢复所有已保存的尺寸
 */
export function loadAllSizes() {
  for (const cfg of HANDLERS) {
    const saved = localStorage.getItem(storageKey(cfg.id));
    if (saved === null) continue;
    const size = parseInt(saved, 10);
    if (isNaN(size)) continue;
    apply(cfg, clamp(cfg, size));
  }
}

function apply(cfg, size) {
  const el = document.querySelector(cfg.target);
  if (!el) return;
  const prop = isHoriz(cfg) ? 'width' : 'height';
  el.style[prop] = size + 'px';
  if (!isHoriz(cfg)) {
    el.style.flex = 'none';
  }
}

function clamp(cfg, size) {
  const max = typeof cfg.getMax === 'function' ? cfg.getMax() : cfg.max;
  return Math.max(cfg.min, Math.min(max, size));
}

function persist(cfg) {
  const el = document.querySelector(cfg.target);
  if (!el) return;
  const prop = isHoriz(cfg) ? 'width' : 'height';
  const size = el.style[prop];
  if (size) {
    localStorage.setItem(storageKey(cfg.id), parseInt(size, 10));
  }
}

// ── 拖拽事件 ──

function startResize(e, cfg) {
  if (e.button !== 0) return;
  e.preventDefault();

  const el = document.querySelector(cfg.target);
  if (!el) return;

  const rect = el.getBoundingClientRect();
  startPos = isHoriz(cfg) ? e.clientX : e.clientY;
  startSize = isHoriz(cfg) ? rect.width : rect.height;
  active = cfg;

  document.body.style.cursor = isHoriz(cfg) ? 'col-resize' : 'row-resize';
  document.body.style.userSelect = 'none';

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e) {
  if (!active) return;

  const currentPos = isHoriz(active) ? e.clientX : e.clientY;
  let delta = currentPos - startPos;
  if (active.reverse) delta = -delta;

  const newSize = clamp(active, startSize + delta);
  apply(active, newSize);
}

function onMouseUp() {
  if (!active) return;
  persist(active);
  active = null;

  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

// ── 初始化 ──

export function initAllHandles() {
  for (const cfg of HANDLERS) {
    const handle = document.querySelector(cfg.handle);
    if (!handle) continue;

    handle.addEventListener('mousedown', (e) => startResize(e, cfg));

    if (cfg.default !== null) {
      handle.addEventListener('dblclick', () => {
        apply(cfg, cfg.default);
        persist(cfg);
      });
    } else {
      handle.addEventListener('dblclick', () => {
        const el = document.querySelector(cfg.target);
        if (!el) return;
        const prop = isHoriz(cfg) ? 'width' : 'height';
        el.style[prop] = '';
        el.style.flex = '';
        localStorage.removeItem(storageKey(cfg.id));
      });
    }
  }
}
