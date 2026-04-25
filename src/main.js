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

(async () => {
  // Initialize store (loads from backend SQLite)
  await initStore();

  // Create default session if none exists
  const { sessions, currentSessionId } = getState();
  if (!currentSessionId || !sessions[currentSessionId]) {
    await createSession();
  }

  // Initialize all components
  initSidebar();
  initPromptArea();
  initMaterialLibrary();
  initCanvas();
  initContextMenu();
  initModal();
  initModelSelector();
  initCommandPalette();

  // Subscribe to status text updates
  subscribe('statusText', () => {
    $('#statusText').textContent = getState().statusText;
  });

  // Set initial status
  setState({ statusText: '就绪' });
})();
