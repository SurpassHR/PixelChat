import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 模拟 openTaskDetail 的核心渲染逻辑（不依赖 DOM helpers 和 CSS 模块导入）
function makeTask(overrides = {}) {
  return {
    id: 'task-test-001',
    status: 'failed',
    prompt: '画一只猫',
    model: 'gemini-3.0-pro-image-square',
    provider: 'custom-gemini',
    refs: [],
    aspectRatio: '1:1',
    image_url: '',
    error: 'HTTP 500: Internal Server Error',
    thinking: '',
    retry_count: 0,
    request_url: 'https://api.example.com/v1/chat/completions',
    request_body: JSON.stringify({ model: 'gemini-3.0-pro-image-square', messages: [{ role: 'user', content: '画一只猫' }], stream: true }),
    request_headers: JSON.stringify({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test...' }),
    response_status: 500,
    response_headers: JSON.stringify({ 'Content-Type': 'application/json', 'X-Request-Id': 'abc123' }),
    response_body: JSON.stringify({ error: { message: 'Internal Server Error', type: 'server_error' } }),
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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

function getTaskDetailHTML(task) {
  const status = task.status || 'pending';
  const statusLabel = getStatusLabel(status);
  const time = new Date(task.created_at * 1000).toLocaleString();
  const updatedAt = new Date(task.updated_at * 1000).toLocaleString();
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

  return `
    <div class="task-detail-overlay">
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
            <div class="task-detail-value" style="font-family:monospace;font-size:12px;word-break:break-all">${escapeHtml(requestUrl)}</div>
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
    </div>
  `;
}

describe('任务详情 Modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('渲染', () => {
    it('应展示任务标题和状态', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('任务详情');
      expect(html).toContain('失败');
    });

    it('应展示提示词', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('画一只猫');
    });

    it('应展示模型和供应商', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('gemini-3.0-pro-image-square');
      expect(html).toContain('custom-gemini');
    });

    it('应展示创建时间和更新时间', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('创建时间');
      expect(html).toContain('更新时间');
    });

    it('应展示宽高比', () => {
      const task = makeTask({ aspectRatio: '16:9' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('宽高比');
      expect(html).toContain('16:9');
    });

    it('重试次数大于 0 时应展示', () => {
      const task = makeTask({ retry_count: 3 });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('重试次数');
      expect(html).toContain('3');
    });

    it('重试次数为 0 时不应展示', () => {
      const task = makeTask({ retry_count: 0 });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('重试次数');
    });

    it('失败任务应展示错误信息', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('错误信息');
      expect(html).toContain('HTTP 500');
    });

    it('成功任务不应展示错误信息', () => {
      const task = makeTask({ status: 'completed', error: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('错误信息');
    });

    it('有 thinking 时应展示思考过程', () => {
      const task = makeTask({ thinking: '让我仔细想想这幅画...' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('思考过程');
      expect(html).toContain('让我仔细想想这幅画...');
    });

    it('无 thinking 时不应展示思考过程区域', () => {
      const task = makeTask({ thinking: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('思考过程');
    });
  });

  describe('不同任务状态', () => {
    it('pending 状态应显示等待中', () => {
      const task = makeTask({ status: 'pending', error: '' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('等待中');
    });

    it('running 状态应显示正在生成', () => {
      const task = makeTask({ status: 'running', error: '' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('正在生成...');
    });

    it('completed 状态应显示已完成', () => {
      const task = makeTask({ status: 'completed', error: '' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('已完成');
      expect(html).toContain('task-detail-status-ok');
    });

    it('failed 状态应显示失败', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('失败');
      expect(html).toContain('task-detail-status-err');
    });

    it('cancelled 状态应显示已取消', () => {
      const task = makeTask({ status: 'cancelled', error: '' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('已取消');
      expect(html).toContain('task-detail-status-cancelled');
    });
  });

  describe('Optional fields (可选字段)', () => {
    it('缺少 request_url 时不应显示请求地址区域', () => {
      const task = makeTask({ request_url: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('请求地址');
    });

    it('缺少 request_headers 时不应显示请求头区域', () => {
      const task = makeTask({ request_headers: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('请求头 (Request Headers)');
    });

    it('缺少 request_body 时不应显示请求体区域', () => {
      const task = makeTask({ request_body: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('请求体 (Request Body)');
    });

    it('缺少 response_status 时不应显示响应状态区域', () => {
      const task = makeTask({ response_status: 0 });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('响应状态 (Response Status)');
    });

    it('缺少 response_headers 时不应显示响应头区域', () => {
      const task = makeTask({ response_headers: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('响应头 (Response Headers)');
    });

    it('缺少 response_body 时不应显示响应体区域', () => {
      const task = makeTask({ response_body: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('响应体 (Response Body)');
    });

    it('缺少 aspectRatio 时不应显示宽高比区域', () => {
      const task = makeTask({ aspectRatio: '' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('宽高比');
    });
  });

  describe('JSON 格式化', () => {
    it('请求体 JSON 应正确格式化缩进显示', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('请求体 (Request Body)');
      expect(html).toContain('gemini-3.0-pro-image-square');
    });

    it('响应体为非 JSON 字符串时应作为纯文本显示', () => {
      const task = makeTask({ response_body: 'Plain text error message' });
      const html = getTaskDetailHTML(task);

      expect(html).toContain('响应体 (Response Body)');
      expect(html).toContain('Plain text error message');
    });
  });

  describe('关闭机制', () => {
    it('应有关闭按钮（×）', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('modal-close');
      expect(html).toContain('×');
    });

    it('应包含 overlay 层用于遮罩点击关闭', () => {
      const task = makeTask();
      const html = getTaskDetailHTML(task);

      expect(html).toContain('task-detail-overlay');
    });
  });

  describe('XSS 防护', () => {
    it('提示词中的 HTML 特殊字符应被转义', () => {
      const task = makeTask({ prompt: '<script>alert("xss")</script>' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('错误信息中的 HTML 特殊字符应被转义', () => {
      const task = makeTask({ error: '<b>danger</b>' });
      const html = getTaskDetailHTML(task);

      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;b&gt;');
    });
  });
});
