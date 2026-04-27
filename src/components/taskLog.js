import { fetchTasks } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';

let failedTasks = [];
let detailOverlay = null;

function timeAgo(ts) {
  const now = Date.now();
  const diff = now - ts * 1000;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  return new Date(ts * 1000).toLocaleDateString();
}

function renderLogList() {
  const container = $('#taskLogList');
  const clearBtn = $('#clearLogBtn');
  if (!container) return;

  if (failedTasks.length === 0) {
    container.innerHTML = '<div class="tq-empty">暂无日志</div>';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (clearBtn) clearBtn.style.display = '';

  container.innerHTML = failedTasks.map((t, i) => {
    const promptShort = (t.prompt || '').length > 28
      ? escapeHtml(t.prompt.slice(0, 28)) + '…'
      : escapeHtml(t.prompt);
    const errorShort = (t.error || '').length > 30
      ? escapeHtml(t.error.slice(0, 30)) + '…'
      : escapeHtml(t.error);

    return `<div class="log-item" data-log-idx="${i}">
      <div class="log-status">✗</div>
      <div class="log-body">
        <div class="log-prompt" title="${escapeHtml(t.prompt)}">${promptShort}</div>
        <div class="log-meta">${errorShort || '生成失败'} · ${t.model || ''} · ${timeAgo(t.created_at)}</div>
      </div>
    </div>`;
  }).join('');
}

function showDetail(task) {
  if (detailOverlay) detailOverlay.remove();

  const time = new Date(task.created_at * 1000).toLocaleString();
  const model = task.model || '-';
  const provider = task.provider || '-';
  const prompt = task.prompt || '';
  const error = task.error || '未知错误';

  detailOverlay = document.createElement('div');
  detailOverlay.className = 'log-detail-overlay';
  detailOverlay.innerHTML = `
    <div class="log-detail-content">
      <div class="log-detail-header">
        <h3>任务失败详情</h3>
        <button class="modal-close" id="logDetailClose">×</button>
      </div>
      <div class="log-detail-body">
        <div class="log-detail-field">
          <span class="log-detail-label">时间</span>
          <span class="log-detail-value" style="background:transparent;padding:0">${time}</span>
        </div>
        <div class="log-detail-field">
          <span class="log-detail-label">模型 / 供应商</span>
          <span class="log-detail-value" style="background:transparent;padding:0">${escapeHtml(model)} / ${escapeHtml(provider)}</span>
        </div>
        <div class="log-detail-field">
          <span class="log-detail-label">提示词</span>
          <div class="log-detail-value">${escapeHtml(prompt)}</div>
        </div>
        <div class="log-detail-field">
          <span class="log-detail-label">错误信息</span>
          <div class="log-detail-value log-detail-error">${escapeHtml(error)}</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(detailOverlay);

  const close = () => {
    if (detailOverlay) { detailOverlay.remove(); detailOverlay = null; }
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  detailOverlay.addEventListener('click', e => {
    if (e.target === detailOverlay || e.target.closest('#logDetailClose')) close();
  });
  document.addEventListener('keydown', onKey);
}

function clearLog() {
  failedTasks = [];
  renderLogList();
  if (detailOverlay) { detailOverlay.remove(); detailOverlay = null; }
}

export function addFailedTask(task) {
  if (!task || !task.id) return;
  if (task.status !== 'failed') return;
  if (failedTasks.some(t => t.id === task.id)) return;

  failedTasks.unshift({
    id: task.id,
    prompt: task.prompt || '',
    error: task.error || '',
    model: task.model || '',
    provider: task.provider || '',
    created_at: task.created_at || Math.floor(Date.now() / 1000)
  });

  // Keep max 200 entries
  if (failedTasks.length > 200) failedTasks = failedTasks.slice(0, 200);

  renderLogList();
}

export async function initTaskLog() {
  // Load existing failed tasks from backend on init
  try {
    const tasks = await fetchTasks();
    if (Array.isArray(tasks)) {
      const failed = tasks.filter(t => t.status === 'failed');
      if (failed.length > 0) {
        failedTasks = failed.map(t => ({
          id: t.id,
          prompt: t.prompt || '',
          error: t.error || '',
          model: t.model || '',
          provider: t.provider || '',
          created_at: t.created_at || Math.floor(Date.now() / 1000)
        }));
        // Sort newest first
        failedTasks.sort((a, b) => b.created_at - a.created_at);
        renderLogList();
      }
    }
  } catch (e) {
    console.log('[日志] 加载后端失败任务出错:', e.message);
  }

  // Click delegation for log list
  const list = $('#taskLogList');
  if (list) {
    list.addEventListener('click', e => {
      const item = e.target.closest('.log-item');
      if (!item) return;
      const idx = parseInt(item.dataset.logIdx);
      if (idx >= 0 && idx < failedTasks.length) {
        showDetail(failedTasks[idx]);
      }
    });
  }

  // Clear button
  const clearBtn = $('#clearLogBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearLog);
  }
}
