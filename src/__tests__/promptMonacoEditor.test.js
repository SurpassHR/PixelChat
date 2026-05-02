import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(__dirname, '../style.css');
const rawCss = readFileSync(cssPath, 'utf-8');

const htmlPath = resolve(__dirname, '../../index.html');
const rawHtml = readFileSync(htmlPath, 'utf-8');

describe('内联 Monaco 编辑器 — CSS', () => {
  it('不存在 .monaco-expand 样式', () => {
    expect(rawCss).not.toMatch(/\.monaco-expand\s*\{/);
  });

  it('不存在 @keyframes monacoExpand', () => {
    expect(rawCss).not.toMatch(/@keyframes\s+monacoExpand/);
  });

  it('不存在 @keyframes monacoCollapse', () => {
    expect(rawCss).not.toMatch(/@keyframes\s+monacoCollapse/);
  });

  it('不存在 .monaco-container 样式', () => {
    expect(rawCss).not.toMatch(/\.monaco-container\s*\{/);
  });

  it('不存在 .monaco-hint 样式', () => {
    expect(rawCss).not.toMatch(/\.monaco-hint\s*\{/);
  });

  it('不存在 .prompt-input-row textarea 样式', () => {
    expect(rawCss).not.toMatch(/\.prompt-input-row\s+textarea/);
  });

  it('#promptMonacoEditor 样式存在', () => {
    expect(rawCss).toMatch(/#promptMonacoEditor\s*\{/);
  });

  it('.prompt-input-row 使用 min-height 而非固定 height', () => {
    expect(rawCss).toMatch(/\.prompt-input-row\s*\{[^}]*min-height\s*:\s*52px/s);
  });
});

describe('内联 Monaco 编辑器 — HTML', () => {
  it('不存在 monaco-expand 元素', () => {
    expect(rawHtml).not.toContain('monacoExpand');
    expect(rawHtml).not.toContain('monacoContainer');
  });

  it('存在 #promptMonacoEditor 容器', () => {
    expect(rawHtml).toContain('id="promptMonacoEditor"');
  });

  it('不存在 textarea#promptInput', () => {
    expect(rawHtml).not.toContain('id="promptInput"');
  });
});
