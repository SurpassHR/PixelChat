import { escapeHtml } from '../domHelpers.js';

let detailOverlay = null;

function fmtJson(raw) {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return escapeHtml(JSON.stringify(parsed, null, 2));
  } catch {
    return escapeHtml(raw);
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'running': return '正在生成...';
    case 'pending': return '等待中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    default: return status;
  }
}

export function closeTaskDetail() {
  if (detailOverlay) {
    detailOverlay.remove();
    detailOverlay = null;
  }
  document.removeEventListener('keydown', onKey);
}

let onKey = null;

export function openTaskDetail(task) {
  closeTaskDetail();

  const status = task.status || 'pending';
  const statusLabel = getStatusLabel(status);
  const time = new Date(task.created_at * 1000).toLocaleString();
  const updatedAt = new Date((task.updated_at || task.created_at) * 1000).toLocaleString();
  const model = task.model || '-';
  const provider = task.provider || '-';
  const prompt = task.prompt || '';
  const error = task.error || '';
  const thinking = task.thinking || '';
  const requestUrl = task.request_url || '';
  const requestBody = task.request_body || '';
  const requestHeaders = task.request_headers || '';
  const responseStatus = task.response_status || 0;
  const responseHeaders = task.response_headers || '';
  const responseBody = task.response_body || '';
  const retryCount = task.retry_count ?? 0;
  const aspectRatio = task.aspectRatio || '';

  const statusClass = status === 'completed' ? 'task-detail-status-ok'
    : status === 'failed' ? 'task-detail-status-err'
    : status === 'cancelled' ? 'task-detail-status-cancelled'
    : '';

  detailOverlay = document.createElement('div');
  detailOverlay.className = 'task-detail-overlay';
  detailOverlay.innerHTML = `
    <div class="task-detail-content">
      <div class="task-detail-header">
        <h3>任务详情 <span class="${statusClass}">${escapeHtml(statusLabel)}</span></h3>
        <button class="modal-close" id="taskDetailClose">×</button>
      </div>
      <div class="task-detail-body">
        <div class="task-detail-field">
          <span class="task-detail-label">提示词</span>
          <div class="task-detail-value">${escapeHtml(prompt)}</div>
        </div>
        <div class="task-detail-field">
          <span class="task-detail-label">状态</span>
          <span class="task-detail-value ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="task-detail-field">
          <span class="task-detail-label">模型 / 供应商</span>
          <span class="task-detail-value">${escapeHtml(model)} / ${escapeHtml(provider)}</span>
        </div>
        ${aspectRatio ? `
        <div class="task-detail-field">
          <span class="task-detail-label">宽高比</span>
          <span class="task-detail-value">${escapeHtml(aspectRatio)}</span>
        </div>
        ` : ''}
        <div class="task-detail-field">
          <span class="task-detail-label">创建时间</span>
          <span class="task-detail-value">${time}</span>
        </div>
        <div class="task-detail-field">
          <span class="task-detail-label">更新时间</span>
          <span class="task-detail-value">${updatedAt}</span>
        </div>
        ${retryCount > 0 ? `
        <div class="task-detail-field">
          <span class="task-detail-label">重试次数</span>
          <span class="task-detail-value">${retryCount}</span>
        </div>
        ` : ''}
        ${error ? `
        <div class="task-detail-field">
          <span class="task-detail-label">错误信息</span>
          <div class="task-detail-value task-detail-error">${escapeHtml(error)}</div>
        </div>
        ` : ''}
        ${thinking ? `
        <div class="task-detail-field">
          <span class="task-detail-label">思考过程</span>
          <pre class="task-detail-thinking">${escapeHtml(thinking)}</pre>
        </div>
        ` : ''}
        ${requestUrl ? `
        <div class="task-detail-field">
          <span class="task-detail-label">请求地址</span>
          <div class="task-detail-value task-detail-url">${escapeHtml(requestUrl)}</div>
        </div>
        ` : ''}
        ${requestHeaders ? `
        <div class="task-detail-field">
          <span class="task-detail-label">请求头 (Request Headers)</span>
          <pre class="task-detail-json">${fmtJson(requestHeaders)}</pre>
        </div>
        ` : ''}
        ${requestBody ? `
        <div class="task-detail-field">
          <span class="task-detail-label">请求体 (Request Body)</span>
          <pre class="task-detail-json">${escapeHtml(requestBody)}</pre>
        </div>
        ` : ''}
        ${responseStatus ? `
        <div class="task-detail-field">
          <span class="task-detail-label">响应状态 (Response Status)</span>
          <div class="task-detail-value task-detail-status-${responseStatus >= 200 && responseStatus < 300 ? 'ok' : 'err'}">${responseStatus}</div>
        </div>
        ` : ''}
        ${responseHeaders ? `
        <div class="task-detail-field">
          <span class="task-detail-label">响应头 (Response Headers)</span>
          <pre class="task-detail-json">${fmtJson(responseHeaders)}</pre>
        </div>
        ` : ''}
        ${responseBody ? `
        <div class="task-detail-field">
          <span class="task-detail-label">响应体 (Response Body)</span>
          <pre class="task-detail-json">${fmtJson(responseBody)}</pre>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(detailOverlay);

  const close = () => {
    if (detailOverlay) { detailOverlay.remove(); detailOverlay = null; }
    document.removeEventListener('keydown', onKey);
  };

  onKey = (e) => { if (e.key === 'Escape') close(); };

  detailOverlay.addEventListener('click', e => {
    if (e.target === detailOverlay || e.target.closest('#taskDetailClose')) close();
  });
  document.addEventListener('keydown', onKey);
}
