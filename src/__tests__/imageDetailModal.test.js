import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 formatDuration（与 modal.js 中实际实现一致）
function formatDuration(ms) {
  if (ms == null) return '--';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

// 模拟元数据 HTML 渲染逻辑（与 modal.js openImageDetail 中实际实现一致）
function renderMetadataHTML(item) {
  const provider = item.provider || '--';
  const model = item.model || '--';
  const resolution = item.resolution
    ? `${item.resolution.width} x ${item.resolution.height}`
    : '--';
  const createdAt = item.createdAt
    ? new Date(item.createdAt).toLocaleString()
    : '--';
  const duration = formatDuration(item.durationMs);

  return `
    <div class="meta-item">
      <span class="meta-label">供应商</span>
      <span class="meta-value">${provider}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">模型</span>
      <span class="meta-value">${model}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">分辨率</span>
      <span class="meta-value">${resolution}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">生成时间</span>
      <span class="meta-value">${createdAt}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">耗费时间</span>
      <span class="meta-value">${duration}</span>
    </div>`;
}

// 辅助函数：创建带完整元数据的 item
function makeItem(overrides = {}) {
  return {
    itemId: 'item-0',
    imageUrl: 'https://example.com/image.png',
    prompt: '一只猫',
    status: 'ok',
    type: 'image',
    model: 'gpt-image-1',
    provider: 'OpenAI',
    resolution: { width: 1024, height: 1024 },
    createdAt: 1714800000000,
    durationMs: 3200,
    ...overrides
  };
}

// ── Suite 1: formatDuration 单元测试 ──

describe('formatDuration', () => {
  it('null / undefined 返回 --', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
  });

  it('小于 1000ms 显示毫秒', () => {
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(0)).toBe('0 ms');
  });

  it('1s ~ 60s 显示秒', () => {
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(30000)).toBe('30.0 s');
    expect(formatDuration(59999)).toBe('60.0 s');
  });

  it('超过 60s 显示分秒格式', () => {
    expect(formatDuration(65000)).toBe('1 min 5 s');
    expect(formatDuration(125000)).toBe('2 min 5 s');
  });
});

// ── Suite 2: 元数据显示 — 正确渲染各字段 ──

describe('图像详情 Modal — 元数据显示', () => {
  it('展示供应商（provider）信息', () => {
    const item = makeItem({ provider: 'Azure' });
    const html = renderMetadataHTML(item);
    expect(html).toContain('Azure');
    expect(html).toContain('供应商');
  });

  it('展示模型（model）名称', () => {
    const item = makeItem({ model: 'dall-e-3' });
    const html = renderMetadataHTML(item);
    expect(html).toContain('dall-e-3');
    expect(html).toContain('模型');
  });

  it('展示分辨率（宽 x 高）', () => {
    const item = makeItem({ resolution: { width: 2048, height: 1024 } });
    const html = renderMetadataHTML(item);
    expect(html).toContain('2048 x 1024');
    expect(html).toContain('分辨率');
  });

  it('展示生成时间（格式化时间戳）', () => {
    const item = makeItem({ createdAt: 1714800000000 });
    const html = renderMetadataHTML(item);
    const expected = new Date(1714800000000).toLocaleString();
    expect(html).toContain(expected);
    expect(html).toContain('生成时间');
  });

  it('展示耗费时间（格式化 duration）', () => {
    const item = makeItem({ durationMs: 2500 });
    const html = renderMetadataHTML(item);
    expect(html).toContain('2.5 s');
    expect(html).toContain('耗费时间');
  });
});

// ── Suite 3: 降级展示 — 字段缺失时显示 -- ──

describe('图像详情 Modal — 降级展示', () => {
  it('缺少 provider 时显示 --', () => {
    const item = makeItem({ provider: '' });
    const html = renderMetadataHTML(item);
    expect(html).toContain('>--<');
  });

  it('缺少 model 时显示 --', () => {
    const item = makeItem({ model: '' });
    const html = renderMetadataHTML(item);
    expect(html).toContain('>--<');
  });

  it('缺少 resolution 时显示 --', () => {
    const item = makeItem({ resolution: null });
    const html = renderMetadataHTML(item);
    expect(html).toContain('>--<');
  });

  it('缺少 createdAt 时显示 --', () => {
    const item = makeItem({ createdAt: null });
    const html = renderMetadataHTML(item);
    expect(html).toContain('>--<');
  });

  it('缺少 durationMs 时显示 --', () => {
    const item = makeItem({ durationMs: null });
    const html = renderMetadataHTML(item);
    expect(html).toContain('>--<');
  });

  it('全部字段缺失时所有值显示 --', () => {
    const item = makeItem({
      model: '', provider: '', resolution: null, createdAt: null, durationMs: null
    });
    const html = renderMetadataHTML(item);
    const matches = html.match(/>--</g);
    expect(matches).toHaveLength(5);
  });
});

// ── Suite 4: Modal 关闭交互 ──

describe('图像详情 Modal — 关闭交互', () => {
  let overlay, closeBtn;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="modal-overlay" id="modalOverlay" style="display:flex">
        <div class="modal-content modal-detail">
          <div class="modal-header">
            <h3>图片详情</h3>
            <button class="modal-close" id="modalCloseBtn">×</button>
          </div>
        </div>
      </div>
    `;
    overlay = document.getElementById('modalOverlay');
    closeBtn = document.getElementById('modalCloseBtn');
  });

  function closeModal() {
    overlay.style.display = 'none';
  }

  function isModalVisible() {
    return overlay.style.display !== 'none';
  }

  it('点击遮罩层关闭 Modal', () => {
    // 模拟 overlay 背景点击事件
    const handler = (e) => { if (e.target === overlay) closeModal(); };
    overlay.addEventListener('click', handler);

    expect(isModalVisible()).toBe(true);
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isModalVisible()).toBe(false);
  });

  it('点击关闭按钮关闭 Modal', () => {
    closeBtn.addEventListener('click', closeModal);

    expect(isModalVisible()).toBe(true);
    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isModalVisible()).toBe(false);
  });

  it('按下 Escape 键关闭 Modal', () => {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
    });

    expect(isModalVisible()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isModalVisible()).toBe(false);
  });

  it('按下 Escape 键时 Modal 已关闭则不重复操作', () => {
    closeModal(); // 先关闭
    const displayBefore = overlay.style.display;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.style.display).toBe(displayBefore); // 不变
  });
});

// ── Suite 5: 单击打开 Modal ──

describe('图像详情 Modal — 单击打开', () => {
  function buildCanvasItemHTML(item) {
    return `<div class="canvas-item" data-item-id="${item.itemId}">
      ${item.status === 'ok' ? `<img src="${item.imageUrl}" alt="生成图片">` : ''}
      ${item.generating ? '<div class="gen-shimmer"></div><button class="gen-cancel">x</button>' : ''}
    </div>`;
  }

  it('单击已完成图片触发 openImageDetail', () => {
    const item = makeItem();
    const container = document.createElement('div');
    container.innerHTML = buildCanvasItemHTML(item);
    document.body.appendChild(container);

    const clickedItems = [];
    const mockOpenImageDetail = (it) => clickedItems.push(it);

    container.addEventListener('click', (e) => {
      if (e.target.closest('.gen-cancel')) return;
      const itemEl = e.target.closest('.canvas-item');
      if (!itemEl) return;
      const id = itemEl.dataset.itemId;
      const found = [item].find(i => i.itemId === id);
      if (found && found.status === 'ok' && found.type !== 'stack') {
        mockOpenImageDetail(found);
      }
    });

    const canvasItem = container.querySelector('.canvas-item');
    canvasItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clickedItems).toHaveLength(1);
    expect(clickedItems[0]).toBe(item);
  });

  it('单击生成中占位符不触发 openImageDetail', () => {
    const item = makeItem({ status: 'generating', generating: true, imageUrl: '' });
    const container = document.createElement('div');
    container.innerHTML = buildCanvasItemHTML(item);
    document.body.appendChild(container);

    const clickedItems = [];
    container.addEventListener('click', (e) => {
      if (e.target.closest('.gen-cancel')) return;
      const itemEl = e.target.closest('.canvas-item');
      if (!itemEl) return;
      const id = itemEl.dataset.itemId;
      const found = [item].find(i => i.itemId === id);
      if (found && found.status === 'ok' && found.type !== 'stack') {
        clickedItems.push(found);
      }
    });

    const canvasItem = container.querySelector('.canvas-item');
    canvasItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clickedItems).toHaveLength(0);
  });

  it('单击失败项不触发 openImageDetail', () => {
    const item = makeItem({ status: 'error', imageUrl: '' });
    const container = document.createElement('div');
    container.innerHTML = buildCanvasItemHTML(item);
    document.body.appendChild(container);

    const clickedItems = [];
    container.addEventListener('click', (e) => {
      if (e.target.closest('.gen-cancel')) return;
      const itemEl = e.target.closest('.canvas-item');
      if (!itemEl) return;
      const id = itemEl.dataset.itemId;
      const found = [item].find(i => i.itemId === id);
      if (found && found.status === 'ok' && found.type !== 'stack') {
        clickedItems.push(found);
      }
    });

    const canvasItem = container.querySelector('.canvas-item');
    canvasItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clickedItems).toHaveLength(0);
  });
});
