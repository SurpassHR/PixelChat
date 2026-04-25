import { getState, subscribe, setState, createSession, deleteSession, switchSession } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';

// --- Session list ---

function renderSessionList() {
  const container = $('#sessionList');
  const { sessions, currentSessionId } = getState();
  const entries = Object.values(sessions).sort(
    (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
  );

  if (entries.length === 0) {
    container.innerHTML =
      '<div style="color:var(--text2);font-size:13px;padding:8px;text-align:center;">暂无聊天记录</div>';
    return;
  }

  container.innerHTML = entries
    .map(s => {
      const active = s.id === currentSessionId ? 'active' : '';
      const time = new Date(s.updatedAt || s.createdAt);
      const timeStr =
        time.toLocaleDateString() + ' ' +
        time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const count = (s.messages || []).length;
      return `<div class="session-item ${active}" data-sid="${s.id}">
        <button class="delete-session" data-sid="${s.id}" title="删除会话">×</button>
        <div class="s-title">${escapeHtml(s.title)}</div>
        <div class="s-time">${timeStr}</div>
        <div class="s-count">${count} 条记录</div>
      </div>`;
    })
    .join('');
}

// --- Init ---

export function initSidebar() {
  // Session list delegation
  $('#sessionList').addEventListener('click', e => {
    const delBtn = e.target.closest('.delete-session');
    if (delBtn) {
      e.stopPropagation();
      deleteSession(delBtn.dataset.sid);
      return;
    }
    const item = e.target.closest('.session-item');
    if (item) switchSession(item.dataset.sid);
  });

  // New session button
  $('#newSessionBtn').addEventListener('click', createSession);

  // Subscribe to store changes
  subscribe('sessions', renderSessionList);

  // Initial render
  renderSessionList();
}
