import { getState, setState, fetchTasks, cancelBackendTask, addResultToCanvas } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
import { showToast } from '../toast.js';
import { addFailedTask } from './taskLog.js';

let pollTimer = null;
let processedIds = new Set();
let renderedIds = new Set();

// ── Render ──

function getStatusIcon(status) {
  switch (status) {
    case 'running': return '●';
    case 'pending': return '○';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '−';
    default: return '○';
  }
}

function getStatusText(status) {
  switch (status) {
    case 'running': return '正在生成...';
    case 'pending': return '等待中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    default: return status;
  }
}

function renderTaskQueue(tasks) {
  const container = $('#taskQueueList');
  if (!container) return;

  // Filter: show pending/running, plus recently completed/failed (not yet processed)
  const visible = tasks.filter(t => {
    if (processedIds.has(t.id)) return false;
    if (t.status === 'cancelled') return false;
    return true;
  });

  if (visible.length === 0) {
    container.innerHTML = '<div class="tq-empty">暂无任务</div>';
    return;
  }

  container.innerHTML = visible.map(t => {
    const promptShort = t.prompt.length > 28 ? escapeHtml(t.prompt.slice(0, 28)) + '…' : escapeHtml(t.prompt);
    const canCancel = t.status === 'pending' || t.status === 'running';

    return `<div class="tq-item" data-task-id="${t.id}" data-status="${t.status}">
      <div class="tq-status tq-status-${t.status}">${getStatusIcon(t.status)}</div>
      <div class="tq-body">
        <div class="tq-prompt" title="${escapeHtml(t.prompt)}">${promptShort}</div>
        <div class="tq-meta">${getStatusText(t.status)}</div>
        ${t.error ? `<div class="tq-error" title="${escapeHtml(t.error)}">${escapeHtml(t.error)}</div>` : ''}
      </div>
      ${canCancel ? `<button class="tq-cancel" data-task-id="${t.id}" title="取消任务">×</button>` : ''}
    </div>`;
  }).join('');
}

// ── Sync completed/failed tasks to canvas ──

async function syncToCanvas(tasks) {
  for (const task of tasks) {
    if (processedIds.has(task.id)) continue;

    // Find a matching generating placeholder on the canvas
    const match = getState().canvasItems.find(
      it => it.taskId === task.id && it.generating
    );

    if (!match) {
      // No matching canvas item — if task is completed/failed/cancelled, mark processed
      if (task.status === 'failed') {
        addFailedTask(task);
        processedIds.add(task.id);
      } else if (task.status === 'completed' && !task.image_url) {
        addFailedTask({ ...task, error: '响应中未找到图片' });
        processedIds.add(task.id);
      } else if (task.status !== 'pending' && task.status !== 'running') {
        processedIds.add(task.id);
      }
      continue;
    }

    // 实时更新 thinking 内容到占位符
    if (task.thinking && match.thinking !== task.thinking) {
      match.thinking = task.thinking;
      setState({ canvasItems: [...getState().canvasItems] });
      // 首次展示 thinking 时跳过本轮完成处理，让用户有足够时间看到思考内容
      // 下一轮轮询时 thinking 已同步，将正常处理完成/失败
      continue;
    }

    if (task.status === 'completed') {
      if (task.image_url) {
        await addResultToCanvas({
          status: 'ok',
          imageUrl: task.image_url,
          prompt: task.prompt,
          refImages: [],
          placeholderId: match.itemId
        });
        processedIds.add(task.id);
      } else {
        addFailedTask({ ...task, error: '响应中未找到图片' });
        await addResultToCanvas({
          status: 'error',
          error: '响应中未找到图片',
          prompt: task.prompt,
          refImages: [],
          placeholderId: match.itemId
        });
        processedIds.add(task.id);
      }
    } else if (task.status === 'failed') {
      addFailedTask(task);
      await addResultToCanvas({
        status: 'error',
        error: task.error || '生成失败',
        prompt: task.prompt,
        refImages: [],
        placeholderId: match.itemId
      });
      processedIds.add(task.id);
    } else if (task.status === 'cancelled') {
      // Remove generating placeholder
      const items = getState().canvasItems;
      const idx = items.findIndex(it => it.itemId === match.itemId);
      if (idx !== -1) {
        items.splice(idx, 1);
        setState({ canvasItems: [...items] });
      }
      // Also clean up pendingTasks in session so it won't reappear on refresh
      const session = getState().sessions[getState().currentSessionId];
      if (session && session.pendingTasks) {
        session.pendingTasks = session.pendingTasks.filter(pt => pt.taskId !== task.id);
      }
      processedIds.add(task.id);
    }
  }
}

// ── Polling ──

async function poll() {
  const tasks = await fetchTasks();
  if (!Array.isArray(tasks)) return;

  // Sync to canvas first
  await syncToCanvas(tasks);

  // Then re-render the queue
  renderTaskQueue(tasks);
}

function startPolling() {
  stopPolling();
  poll(); // immediate first poll
  pollTimer = setInterval(poll, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Init ──

export function initTaskQueue() {
  // Cancel button delegation
  const list = $('#taskQueueList');
  if (list) {
    list.addEventListener('click', async e => {
      const btn = e.target.closest('.tq-cancel');
      if (!btn) return;
      const taskId = btn.dataset.taskId;
      try {
        await cancelBackendTask(taskId);
        showToast('任务已取消', 'success');
      } catch (err) {
        showToast('取消失败: ' + err.message, 'error');
      }
    });
  }

  // Start polling
  startPolling();

  // Stop polling when page unloads
  window.addEventListener('pagehide', stopPolling);
}
