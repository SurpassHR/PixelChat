import { initStore, getState, createSession, subscribe, setState, forceSaveSessions } from './store.js';
import { $ } from './domHelpers.js';
import { initSidebar } from './components/sidebar.js';
import { initPromptArea } from './components/promptArea.js';
import { initMaterialLibrary } from './components/materialLibrary.js';
import { initCanvas } from './components/canvas.js';
import { initContextMenu } from './components/contextMenu.js';
import { initModal } from './components/modal.js';
import { initModelSelector } from './components/modelSelector.js';
import { initCommandPalette } from './components/commandPalette.js';
import { initSettingsModal } from './components/settingsModal.js';
import { initTaskQueue } from './components/taskQueue.js';
import { initTaskLog } from './components/taskLog.js';
import { loadAllSizes, initAllHandles } from './resize.js';

(async () => {
  // 页面关闭前确保数据保存：先同步写 localStorage（不依赖网络），再尝试后端
  window.addEventListener('beforeunload', () => {
    try {
      const { sessions } = getState();
      if (sessions && Object.keys(sessions).length > 0) {
        localStorage.setItem('image-gen-sessions', JSON.stringify(sessions));
      }
    } catch { /* 忽略 */ }
    // sendBeacon 在页面卸载时比 fetch 更可靠
    try {
      const { sessions } = getState();
      const blob = new Blob([JSON.stringify(sessions)], { type: 'application/json' });
      navigator.sendBeacon(
        (import.meta.env.VITE_STORAGE_BASE || 'http://127.0.0.1:5001').replace(/\/+$/, '') + '/api/sessions',
        blob
      );
    } catch { /* 忽略 */ }
  });

  // Initialize store (loads from backend SQLite)
  await initStore();

  // Create default session if none exists
  const { sessions, currentSessionId } = getState();
  if (!currentSessionId || !sessions[currentSessionId]) {
    await createSession();
  }

  // 加载保存的侧边栏宽度（必须在组件初始化之前应用，以避免布局闪烁）
  loadAllSizes();

  // Initialize all components
  initSidebar();
  initPromptArea();
  initMaterialLibrary();
  initCanvas();
  initContextMenu();
  initModal();
  initModelSelector();
  initCommandPalette();
  initSettingsModal();
  initTaskQueue();
  initTaskLog();

  // 初始化拖拽手柄（必须在 DOM 完全就绪后）
  initAllHandles();

  // Subscribe to status text updates
  subscribe('statusText', () => {
    $('#statusText').textContent = getState().statusText;
  });

  // Set initial status
  setState({ statusText: '就绪' });
})();
