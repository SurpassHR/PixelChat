import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cssPath = resolve(__dirname, '../style.css');
const rawCss = readFileSync(cssPath, 'utf-8');

const htmlPath = resolve(__dirname, '../../index.html');
const rawHtml = readFileSync(htmlPath, 'utf-8');

const jsPath = resolve(__dirname, '../components/promptArea.js');
const rawJs = readFileSync(jsPath, 'utf-8');

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

  it('.prompt-input-row 使用 align-items: flex-end + 对称 padding（按钮视觉居中）', () => {
    expect(rawCss).toMatch(/\.prompt-input-row\s*\{[^}]*align-items\s*:\s*flex-end/s);
    expect(rawCss).toMatch(/\.prompt-input-row\s*\{[^}]*padding\s*:\s*7px\s+4px\s+7px\s+8px/s);
  });

  it('#promptMonacoEditor CSS 中不设置静态 height（由 JS 管理）', () => {
    expect(rawCss).not.toMatch(/#promptMonacoEditor\s*\{[^}]*height\s*:/s);
  });

  it('#promptMonacoEditor 设置 overflow: hidden（收起时不显示滚动条）', () => {
    expect(rawCss).toMatch(/#promptMonacoEditor\s*\{[^}]*overflow\s*:\s*hidden/s);
  });

  it('#promptMonacoEditor 设置 transition: height 0.2s ease-out（平滑过渡）', () => {
    expect(rawCss).toMatch(/#promptMonacoEditor\s*\{[^}]*transition\s*:\s*height\s+0\.2s\s+ease-out/s);
  });

  it('#promptMonacoEditor 设置 align-self: center（收起时居中），modelTag 用 margin-bottom 锁定居中位置', () => {
    expect(rawCss).toMatch(/#promptMonacoEditor\s*\{[^}]*align-self\s*:\s*center/s);
    expect(rawCss).toMatch(/\.model-tag\s*\{[^}]*margin-bottom\s*:\s*5px/s);
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

describe('内联 Monaco 编辑器 — JS 展开/收起逻辑', () => {
  it('存在 _monacoExpanded 状态变量', () => {
    expect(rawJs).toMatch(/let\s+_monacoExpanded\s*=\s*false/);
  });

  it('updateInlineEditorHeight 接受 expanded 参数', () => {
    expect(rawJs).toMatch(/function\s+updateInlineEditorHeight\s*\(\s*expanded\s*\)/);
  });

  it('expanded=true 时使用 getContentHeight() 计算高度（计入 word wrap 折行）', () => {
    expect(rawJs).toMatch(/contentHeight\s*=\s*_monacoEditor\.getContentHeight\s*\(\s*\)/);
    expect(rawJs).toMatch(/Math\.min\s*\(\s*contentHeight\s*,\s*maxHeight\s*\)/);
  });

  it('expanded=false 时高度为 30px', () => {
    expect(rawJs).toMatch(/height\s*=\s*30/);
  });

  it('收起时 editor alignSelf 为 center（居中），展开时切换 flex-end', () => {
    expect(rawJs).toMatch(/alignSelf\s*=\s*'flex-end'/);
    expect(rawJs).toMatch(/alignSelf\s*=\s*'center'/);
  });

  it('监听 onDidFocusEditorWidget 展开编辑器', () => {
    expect(rawJs).toMatch(/onDidFocusEditorWidget\s*\(\s*\(\)\s*=>\s*\{/);
    expect(rawJs).toMatch(/updateInlineEditorHeight\s*\(\s*true\s*\)/);
  });

  it('监听 onDidBlurEditorWidget 收起编辑器', () => {
    expect(rawJs).toMatch(/onDidBlurEditorWidget\s*\(\s*\(\)\s*=>\s*\{/);
    expect(rawJs).toMatch(/updateInlineEditorHeight\s*\(\s*false\s*\)/);
  });

  it('内容变化时仅在展开状态下重新计算高度', () => {
    expect(rawJs).toMatch(/if\s*\(\s*_monacoExpanded\s*\)\s*\{/);
  });

  it('移除 Enter 提交 addAction', () => {
    expect(rawJs).not.toMatch(/id\s*:\s*'submit-prompt'/);
  });

  it('移除 Escape 失焦 addAction', () => {
    expect(rawJs).not.toMatch(/id\s*:\s*'blur-editor'/);
  });

  it('layout() 传入显式宽高尺寸', () => {
    expect(rawJs).toMatch(/layout\s*\(\s*\{\s*width\s*:\s*container\.clientWidth\s*,\s*height\s*:\s*height\s*\}\s*\)/);
  });
});

describe('内联 Monaco 编辑器 — 自动折行配置', () => {
  it('wordWrap 选项设为 on', () => {
    expect(rawJs).toMatch(/wordWrap\s*:\s*'on'/);
  });

  it('wrappingIndent 设为 same', () => {
    expect(rawJs).toMatch(/wrappingIndent\s*:\s*'same'/);
  });

  it('automaticLayout 设为 true 以自动响应容器尺寸变化', () => {
    expect(rawJs).toMatch(/automaticLayout\s*:\s*true/);
  });

  it('wrappingStrategy 设为 advanced 以正确处理 CJK 换行', () => {
    expect(rawJs).toMatch(/wrappingStrategy\s*:\s*'advanced'/);
  });

  it('水平滚动条设置为最小尺寸避免水平滚动', () => {
    expect(rawJs).toMatch(/horizontalScrollbarSize\s*:\s*4/);
  });
});
