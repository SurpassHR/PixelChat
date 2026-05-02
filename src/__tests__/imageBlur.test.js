import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(__dirname, '../style.css');
const rawCss = readFileSync(cssPath, 'utf-8');

describe('Ctrl+H 图片模糊功能', () => {
  function setupBlurTest(containerClass) {
    const style = document.createElement('style');
    style.textContent = rawCss;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.className = containerClass;
    const img = document.createElement('img');
    container.appendChild(img);
    document.body.appendChild(container);

    document.body.classList.add('images-blurred');
    return { container, img };
  }

  beforeEach(() => {
    document.head.querySelectorAll('style').forEach(s => s.remove());
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('素材库图像应该在 images-blurred 状态下被模糊', () => {
    const { img } = setupBlurTest('mat2-thumb');
    const computed = window.getComputedStyle(img);
    expect(computed.filter).toBe('blur(20px)');
  });

  it('canvas 图像应该在 images-blurred 状态下被模糊', () => {
    const { img } = setupBlurTest('canvas-item');
    const computed = window.getComputedStyle(img);
    expect(computed.filter).toBe('blur(20px)');
  });

  it('参考图片应该在 images-blurred 状态下被模糊', () => {
    const { img } = setupBlurTest('attachment-item');
    const computed = window.getComputedStyle(img);
    expect(computed.filter).toBe('blur(20px)');
  });

  it('attachment-thumb 应裁剪溢出并保持圆角', () => {
    const style = document.createElement('style');
    style.textContent = rawCss;
    document.head.appendChild(style);

    const thumb = document.createElement('div');
    thumb.className = 'attachment-thumb';
    document.body.appendChild(thumb);

    const computed = window.getComputedStyle(thumb);
    expect(computed.overflow).toBe('hidden');
    // jsdom 可能不解析 var(--radius)，验证 CSS 源文件中规则存在
    expect(rawCss).toMatch(/\.attachment-thumb\s*\{[^}]*border-radius\s*:\s*var\(--radius\)/s);
  });

  it('attachment-item 不应裁剪溢出，保证删除按钮完整显示', () => {
    const style = document.createElement('style');
    style.textContent = rawCss;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.className = 'attachment-item';
    document.body.appendChild(container);

    const computed = window.getComputedStyle(container);
    expect(computed.overflow).not.toBe('hidden');
  });
});
