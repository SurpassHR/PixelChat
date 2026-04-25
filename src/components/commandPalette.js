import { getState, setState, subscribe } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { selectModel, fetchModels } from './modelSelector.js';

let _mode = 'commands';

const commands = [
  { id: 'switch-model', icon: '⚙', label: '切换模型', hint: '从列表中选择生成模型' },
  { id: 'new-session', icon: '＋', label: '新建会话', hint: '创建新的会话' },
  { id: 'toggle-reuse-prompt', icon: '📌', label: '切换提示词复用', hint: '发送后是否保留提示词' },
  { id: 'toggle-reuse-ref', icon: '🖼', label: '切换参考图复用', hint: '发送后是否保留参考图' },
  { id: 'focus-prompt', icon: '⌨', label: '聚焦输入框', hint: '将焦点移到提示词输入框' },
  { id: 'clear-canvas', icon: '🗑', label: '清空画板', hint: '删除当前会话所有图片' }
];

// --- Rendering ---

function renderItems(items) {
  const list = $('#commandList');
  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px;">无匹配项</div>';
    return;
  }
  list.innerHTML = items.join('');
}

function highlightFirst() {
  const first = $('#commandList .cmd-item');
  if (first) first.classList.add('highlighted');
}

function renderCommands(filtered) {
  _mode = 'commands';
  const items = filtered.map(cmd => `<div class="cmd-item" data-cmd="${cmd.id}">
    <div class="cmd-icon">${cmd.icon}</div>
    <div class="cmd-label">${escapeHtml(cmd.label)}</div>
    <div class="cmd-hint">${escapeHtml(cmd.hint)}</div>
  </div>`);
  renderItems(items);
  highlightFirst();
}

function renderModelList(filtered) {
  _mode = 'models';
  const { selectedModelId } = getState();

  const items = [
    `<div class="cmd-item" data-cmd="__back">
      <div class="cmd-icon">←</div>
      <div class="cmd-label">返回命令列表</div>
      <div class="cmd-hint">返回上一级</div>
    </div>`
  ];

  if (filtered.length === 0) {
    const { models } = getState();
    if (models.length === 0) {
      items.push('<div style="color:var(--text2);font-size:13px;padding:12px;">模型列表为空，点击"刷新模型列表"获取</div>');
    } else {
      items.push('<div style="color:var(--text2);font-size:13px;padding:12px;">无匹配模型</div>');
    }
  } else {
    filtered.forEach(m => {
      const active = m.id === selectedModelId;
      items.push(`<div class="cmd-item ${active ? 'highlighted' : ''}" data-cmd="__model" data-mid="${m.id}">
        <div class="cmd-icon">${active ? '✓' : '🤖'}</div>
        <div class="cmd-label">${escapeHtml(m.id)}</div>
        <div class="cmd-hint">${m.owner ? escapeHtml(m.owner) : '选择此模型'}</div>
      </div>`);
    });
  }

  items.push(`<div class="cmd-item" data-cmd="__refresh">
    <div class="cmd-icon">↻</div>
    <div class="cmd-label">刷新模型列表</div>
    <div class="cmd-hint">从 API 重新获取</div>
  </div>`);

  renderItems(items);
  highlightFirst();
}

// --- Filtering ---

function filterCurrent() {
  const q = $('#commandPaletteInput').value.toLowerCase().trim();
  if (_mode === 'models') {
    const { models } = getState();
    renderModelList(q ? models.filter(m => m.id.toLowerCase().includes(q)) : models);
  } else {
    renderCommands(q ? commands.filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) : commands);
  }
}

// --- Navigation ---

function navigateList(direction) {
  const items = $$('#commandList .cmd-item');
  if (items.length === 0) return;
  let idx = Array.from(items).findIndex(el => el.classList.contains('highlighted'));
  if (idx >= 0) items[idx].classList.remove('highlighted');
  if (idx < 0) idx = direction > 0 ? -1 : 0;
  idx = (idx + direction + items.length) % items.length;
  items[idx].classList.add('highlighted');
  items[idx].scrollIntoView({ block: 'nearest' });
}

function executeHighlighted() {
  const highlighted = $('#commandList .cmd-item.highlighted');
  const item = highlighted || $('#commandList .cmd-item');
  if (!item) return;

  const cmd = item.dataset.cmd;

  if (_mode === 'models') {
    if (cmd === '__back') enterCommandMode();
    else if (cmd === '__refresh') refreshAndShowModels();
    else if (cmd === '__model') { selectModel(item.dataset.mid); close(); }
    return;
  }

  const command = commands.find(c => c.id === cmd);
  if (!command) return;
  if (cmd === 'switch-model') { enterModelMode(); return; }
  close();
  switch (cmd) {
    case 'new-session': $('#newSessionBtn').click(); break;
    case 'toggle-reuse-prompt': {
      const cb = document.querySelector('#dropdownTogglePrompt input');
      if (cb) cb.checked = !cb.checked;
      setState({ reusePrompt: !getState().reusePrompt });
      break;
    }
    case 'toggle-reuse-ref': {
      const cb = document.querySelector('#dropdownToggleRef input');
      if (cb) cb.checked = !cb.checked;
      setState({ reuseRef: !getState().reuseRef });
      break;
    }
    case 'focus-prompt': $('#promptInput').focus(); break;
    case 'clear-canvas': {
      const el = $$('.menu-item[data-action="clearCanvas"]');
      if (el.length) el[0].click();
      break;
    }
  }
}

// --- Mode switching ---

function enterModelMode() {
  _mode = 'models';
  const input = $('#commandPaletteInput');
  input.value = '';
  input.placeholder = '输入关键词筛选模型...';
  $('#commandPaletteTitle').textContent = '选择模型';

  const { models } = getState();
  renderModelList(models);
  if (models.length === 0) fetchModels();
}

function enterCommandMode() {
  _mode = 'commands';
  const input = $('#commandPaletteInput');
  input.value = '';
  input.placeholder = '输入命令关键词...';
  $('#commandPaletteTitle').textContent = '命令面板';
  renderCommands(commands);
}

function refreshAndShowModels() {
  renderModelList([]);
  fetchModels();
}

// --- Open / Close ---

const overlay = $('#commandPaletteOverlay');

function open(mode = 'commands') {
  overlay.style.display = 'flex';
  if (mode === 'models') enterModelMode();
  else enterCommandMode();
  $('#commandPaletteInput').focus();
}

function close() {
  overlay.style.display = 'none';
}

// --- Init ---

export function initCommandPalette() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      e.preventDefault();
      open();
    }
  });

  document.addEventListener('keydown', e => {
    if (overlay.style.display === 'none') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (_mode === 'models') { enterCommandMode(); return; }
      close();
    }
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });

  $('#commandPaletteCloseBtn').addEventListener('click', close);

  $('#commandPaletteInput').addEventListener('input', filterCurrent);

  $('#commandPaletteInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateList(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); navigateList(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); executeHighlighted(); }
  });

  $('#commandList').addEventListener('click', e => {
    const item = e.target.closest('.cmd-item');
    if (!item) return;
    const cmd = item.dataset.cmd;

    if (_mode === 'models') {
      if (cmd === '__back') enterCommandMode();
      else if (cmd === '__refresh') refreshAndShowModels();
      else if (cmd === '__model') { selectModel(item.dataset.mid); close(); }
      return;
    }

    const command = commands.find(c => c.id === cmd);
    if (!command) return;
    if (cmd === 'switch-model') { enterModelMode(); return; }
    close();
    switch (cmd) {
      case 'new-session': $('#newSessionBtn').click(); break;
      case 'toggle-reuse-prompt': {
        const cb = document.querySelector('#dropdownTogglePrompt input');
        if (cb) cb.checked = !cb.checked;
        setState({ reusePrompt: !getState().reusePrompt });
        break;
      }
      case 'toggle-reuse-ref': {
        const cb = document.querySelector('#dropdownToggleRef input');
        if (cb) cb.checked = !cb.checked;
        setState({ reuseRef: !getState().reuseRef });
        break;
      }
      case 'focus-prompt': $('#promptInput').focus(); break;
      case 'clear-canvas': {
        const el = $$('.menu-item[data-action="clearCanvas"]');
        if (el.length) el[0].click();
        break;
      }
    }
  });

  // Re-render model list when models arrive from async fetch
  subscribe('models', () => {
    if (_mode === 'models' && overlay.style.display !== 'none') {
      renderModelList(getState().models);
    }
  });

  // Dropdown model edit opens palette in model mode
  const modelEdit = $('#dropdownModelEdit');
  const modelRow = $('#dropdownModelRow');
  const openModelMode = e => {
    e.stopPropagation();
    // Close dropdown first
    const dropdown = $('#optionsDropdown');
    if (dropdown) dropdown.style.display = 'none';
    const trigger = $('#optionsTrigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    open('models');
  };
  if (modelEdit) modelEdit.addEventListener('click', openModelMode);
  if (modelRow) modelRow.addEventListener('click', openModelMode);
}
