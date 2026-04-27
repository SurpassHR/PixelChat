import { fetchTasks } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { openExpandModal } from './expandModal.js';

let logEntries = [];
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

  if (logEntries.length === 0) {
    container.innerHTML = '<div class="tq-empty">暂无日志</div>';
    if (clearBtn) clearBtn.style.display = 'none';
    return;
  }

  if (clearBtn) clearBtn.style.display = '';

  container.innerHTML = logEntries.map((t, i) => {
    const isSuccess = t.type === 'success';
    const promptShort = (t.prompt || '').length > 28
      ? escapeHtml(t.prompt.slice(0, 28)) + '…'
      : escapeHtml(t.prompt);
    const metaParts = [t.model, timeAgo(t.created_at)].filter(Boolean);
    const metaText = metaParts.join(' · ');

    return `<div class="log-item ${isSuccess ? 'log-success' : 'log-error'}" data-log-idx="${i}">
      <div class="log-status">${isSuccess ? '✓' : '✗'}</div>
      <div class="log-body">
        <div class="log-prompt" title="${escapeHtml(t.prompt)}">${promptShort}</div>
        <div class="log-meta">${escapeHtml(metaText)}</div>
      </div>
    </div>`;
  }).join('');
}

function showDetail(entry) {
  if (detailOverlay) detailOverlay.remove();

  const isSuccess = entry.type === 'success';
  const time = new Date(entry.created_at * 1000).toLocaleString();
  const model = entry.model || '-';
  const provider = entry.provider || '-';
  const prompt = entry.prompt || '';

  detailOverlay = document.createElement('div');
  detailOverlay.className = 'log-detail-overlay';
  detailOverlay.innerHTML = `
    <div class="log-detail-content">
      <div class="log-detail-header">
        <h3 style="color:${isSuccess ? 'var(--success)' : 'var(--danger)'}">${isSuccess ? '任务详情' : '任务失败详情'}</h3>
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
        ${isSuccess ? `
        <div class="log-detail-field">
          <span class="log-detail-label">状态</span>
          <div class="log-detail-value log-detail-success">✓ 生成成功</div>
        </div>
        ` : `
        <div class="log-detail-field">
          <span class="log-detail-label">错误信息</span>
          <div class="log-detail-value log-detail-error">${escapeHtml(entry.error || '未知错误')}</div>
        </div>
        `}
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

function addLogEntry(task, type) {
  if (!task || !task.id) return;
  if (logEntries.some(t => t.id === task.id)) return;

  logEntries.unshift({
    id: task.id,
    type,
    prompt: task.prompt || '',
    error: task.error || '',
    model: task.model || '',
    provider: task.provider || '',
    created_at: task.created_at || Math.floor(Date.now() / 1000)
  });

  if (logEntries.length > 200) logEntries = logEntries.slice(0, 200);

  renderLogList();
}

export function addFailedTask(task) {
  if (!task || !task.id) return;
  if (task.status !== 'failed') return;
  addLogEntry(task, 'error');
}

export function addSuccessTask(task) {
  if (!task || !task.id) return;
  if (task.status !== 'completed' || !task.image_url) return;
  addLogEntry(task, 'success');
}

export async function initTaskLog() {
  try {
    const tasks = await fetchTasks();
    if (Array.isArray(tasks)) {
      const relevant = tasks.filter(t => t.status === 'failed' || t.status === 'completed');
      if (relevant.length > 0) {
        logEntries = relevant.map(t => ({
          id: t.id,
          type: t.status === 'completed' ? 'success' : 'error',
          prompt: t.prompt || '',
          error: t.error || '',
          model: t.model || '',
          provider: t.provider || '',
          created_at: t.created_at || Math.floor(Date.now() / 1000)
        }));
        logEntries.sort((a, b) => b.created_at - a.created_at);
        renderLogList();
      }
    }
  } catch (e) {
    console.log('[日志] 加载后端任务出错:', e.message);
  }

  const list = $('#taskLogList');
  if (list) {
    list.addEventListener('click', e => {
      const item = e.target.closest('.log-item');
      if (!item) return;
      const idx = parseInt(item.dataset.logIdx);
      if (idx >= 0 && idx < logEntries.length) {
        showDetail(logEntries[idx]);
      }
    });
  }

  const clearBtn = $('#clearLogBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      logEntries = [];
      renderLogList();
      if (detailOverlay) { detailOverlay.remove(); detailOverlay = null; }
    });
  }

  // Expand button
  const expandBtn = $('#expandLogBtn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      openExpandModal('日志', $('#taskLogList'));
    });
  }
}
