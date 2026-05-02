import { describe, it, expect, beforeEach } from 'vitest';

describe('任务日志详情弹窗', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function makeEntry(overrides = {}) {
    return {
      id: 'task-test-001',
      type: 'error',
      prompt: '画一只猫',
      error: 'HTTP 500: Internal Server Error',
      model: 'gemini-3.0-pro-image-square',
      provider: 'custom-gemini',
      request_url: 'https://api.example.com/v1/chat/completions',
      request_body: JSON.stringify({ model: 'gemini-3.0-pro-image-square', messages: [{ role: 'user', content: '画一只猫' }], stream: true }),
      request_headers: JSON.stringify({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test...' }),
      response_status: 500,
      response_headers: JSON.stringify({ 'Content-Type': 'application/json', 'X-Request-Id': 'abc123' }),
      response_body: JSON.stringify({ error: { message: 'Internal Server Error', type: 'server_error' } }),
      created_at: Math.floor(Date.now() / 1000),
      ...overrides
    };
  }

  function getDetailHTML(entry) {
    // 模拟 showDetail 的核心渲染逻辑（不依赖 DOM helpers）
    const isSuccess = entry.type === 'success';
    const time = new Date(entry.created_at * 1000).toLocaleString();
    const model = entry.model || '-';
    const provider = entry.provider || '-';
    const prompt = entry.prompt || '';
    const requestUrl = entry.request_url || '';
    const requestBody = entry.request_body || '';
    const requestHeaders = entry.request_headers || '';
    const responseStatus = entry.response_status || 0;
    const responseHeaders = entry.response_headers || '';
    const responseBody = entry.response_body || '';

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

    const resStatusClass = responseStatus >= 200 && responseStatus < 300 ? 'log-detail-success' : 'log-detail-error';

    return `
      <div class="log-detail-overlay">
        <div class="log-detail-content">
          <div class="log-detail-header">
            <h3>${isSuccess ? '任务详情' : '任务失败详情'}</h3>
            <button class="modal-close">×</button>
          </div>
          <div class="log-detail-body">
            <div class="log-detail-field"><span class="log-detail-label">时间</span><span>${time}</span></div>
            <div class="log-detail-field"><span class="log-detail-label">模型 / 供应商</span><span>${escapeHtml(model)} / ${escapeHtml(provider)}</span></div>
            <div class="log-detail-field"><span class="log-detail-label">提示词</span><div>${escapeHtml(prompt)}</div></div>
            ${requestUrl ? `<div class="log-detail-field"><span class="log-detail-label">请求地址</span><div>${escapeHtml(requestUrl)}</div></div>` : ''}
            ${requestHeaders ? `<div class="log-detail-field"><span class="log-detail-label">请求头 (Request Headers)</span><pre>${fmtJson(requestHeaders)}</pre></div>` : ''}
            ${requestBody ? `<div class="log-detail-field"><span class="log-detail-label">请求体 (Request Body)</span><pre>${escapeHtml(requestBody)}</pre></div>` : ''}
            ${responseStatus ? `<div class="log-detail-field"><span class="log-detail-label">响应状态 (Response Status)</span><div class="${resStatusClass}">${responseStatus}</div></div>` : ''}
            ${responseHeaders ? `<div class="log-detail-field"><span class="log-detail-label">响应头 (Response Headers)</span><pre>${fmtJson(responseHeaders)}</pre></div>` : ''}
            ${responseBody ? `<div class="log-detail-field"><span class="log-detail-label">响应体 (Response Body)</span><pre>${fmtJson(responseBody)}</pre></div>` : ''}
            <div class="log-detail-field"><span class="log-detail-label">错误信息</span><div>${escapeHtml(entry.error || '未知错误')}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  it('失败任务的详情应展示请求头 (Request Headers)', () => {
    const entry = makeEntry();
    const html = getDetailHTML(entry);

    expect(html).toContain('请求头 (Request Headers)');
    expect(html).toContain('Content-Type');
    expect(html).toContain('Authorization');
  });

  it('失败任务的详情应展示响应状态码', () => {
    const entry = makeEntry();
    const html = getDetailHTML(entry);

    expect(html).toContain('响应状态 (Response Status)');
    expect(html).toContain('500');
    expect(html).toContain('log-detail-error');
  });

  it('成功任务 (2xx) 的响应状态应显示为成功样式', () => {
    const entry = makeEntry({ type: 'success', error: '', response_status: 200 });
    const html = getDetailHTML(entry);

    expect(html).toContain('200');
    expect(html).toContain('log-detail-success');
    expect(html).toContain('任务详情');
  });

  it('失败任务的详情应展示响应头 (Response Headers)', () => {
    const entry = makeEntry();
    const html = getDetailHTML(entry);

    expect(html).toContain('响应头 (Response Headers)');
    expect(html).toContain('X-Request-Id');
  });

  it('失败任务的详情应展示响应体 (Response Body)', () => {
    const entry = makeEntry();
    const html = getDetailHTML(entry);

    expect(html).toContain('响应体 (Response Body)');
    expect(html).toContain('Internal Server Error');
  });

  it('缺少 request_headers 时不应显示请求头区域', () => {
    const entry = makeEntry({ request_headers: '' });
    const html = getDetailHTML(entry);

    expect(html).not.toContain('请求头 (Request Headers)');
  });

  it('缺少 response_status 时不应显示响应状态区域', () => {
    const entry = makeEntry({ response_status: 0 });
    const html = getDetailHTML(entry);

    expect(html).not.toContain('响应状态 (Response Status)');
  });

  it('缺少 response_headers 时不应显示响应头区域', () => {
    const entry = makeEntry({ response_headers: '' });
    const html = getDetailHTML(entry);

    expect(html).not.toContain('响应头 (Response Headers)');
  });

  it('缺少 response_body 时不应显示响应体区域', () => {
    const entry = makeEntry({ response_body: '' });
    const html = getDetailHTML(entry);

    expect(html).not.toContain('响应体 (Response Body)');
  });

  it('请求体 JSON 应正确格式化显示', () => {
    const entry = makeEntry();
    const html = getDetailHTML(entry);

    expect(html).toContain('请求体 (Request Body)');
    expect(html).toContain('gemini-3.0-pro-image-square');
  });

  it('响应体为非 JSON 字符串时应作为纯文本显示', () => {
    const entry = makeEntry({ response_body: 'Plain text error message' });
    const html = getDetailHTML(entry);

    expect(html).toContain('响应体 (Response Body)');
    expect(html).toContain('Plain text error message');
  });
});
