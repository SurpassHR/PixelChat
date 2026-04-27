import { initStore, getState, createSession, subscribe, setState } from './store.js';
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
