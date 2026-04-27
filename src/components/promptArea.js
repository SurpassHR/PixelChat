import { getState, setState, subscribe, appendMessage, addDroppedImage, addMaterial, addGeneratingPlaceholder, submitTask } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { showToast } from '../toast.js';
import { selectModel, fetchModels, groupModelsByProvider } from './modelSelector.js';

function renderAttachments() {
  const container = $('#attachments');
  const { refImages } = getState();
  container.innerHTML = refImages
    .map((img, i) =>
      `<div class="attachment-item">
        <img src="${img.dataUrl}" alt="ref" title="${img.name}">
        <button class="remove" data-ridx="${i}">×</button>
      </div>`
    )
    .join('');
}

function addRefImage(name, dataUrl) {
  const { refImages } = getState();
  refImages.push({ name, dataUrl });
  setState({ refImages: [...refImages] });
  setState({ statusText: '已添加参考图' });
}

function removeRefImage(index) {
  const { refImages } = getState();
  refImages.splice(index, 1);
  setState({ refImages: [...refImages] });
}

async function generate() {
  const { selectedModelId, selectedProvider, refImages, reusePrompt, reuseRef, batchSize } = getState();
  const prompt = $('#promptInput').value.trim();

  if (!selectedModelId) {
    setState({ statusText: '请先选择一个模型' });
    return;
  }
  if (!prompt) {
    setState({ statusText: '请输入提示词' });
    return;
  }

  setState({ statusText: `正在提交 ${batchSize} 个任务...` });

  const turnRefs = [...refImages];

  // Save batchSize to store for persistence
  setState({ batchSize });

  // Submit tasks to backend queue in parallel
  const refs = turnRefs.map(r => ({ name: r.name, dataUrl: r.dataUrl }));
  const submissions = Array.from({ length: batchSize }, () =>
    submitTask({ prompt, model: selectedModelId, provider: selectedProvider, refs })
  );
  const results = await Promise.allSettled(submissions);

  const taskIds = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      taskIds.push(r.value.id);
    } else {
      showToast('提交任务失败: ' + (r.reason?.message || '未知错误'), 'error');
    }
  }

  if (taskIds.length === 0) {
    setState({ statusText: '提交任务失败' });
    return;
  }

  // Create generating placeholders linked to tasks
  for (const taskId of taskIds) {
    addGeneratingPlaceholder(prompt, turnRefs, taskId);
  }

  // Store user message
  await appendMessage({ role: 'user', prompt, refImages: turnRefs });

  // Clear input
  if (!reusePrompt) {
    $('#promptInput').value = '';
  }
  if (!reuseRef) {
    setState({ refImages: [] });
  }

  setState({ statusText: `已提交 ${taskIds.length} 个任务到队列` });
}

function syncSettingsState() {
  const { batchSize, reusePrompt, reuseRef, aspectRatio, selectedModelId } = getState();

  // 胶囊栏中的模型标签
  const tagName = $('#modelTagName');
  if (tagName) tagName.textContent = selectedModelId || '未选择';
  const tagMult = $('#modelTagMult');
  if (tagMult) tagMult.textContent = '×' + batchSize;
  const tagRatio = $('#modelTagRatio');
  if (tagRatio) tagRatio.textContent = aspectRatio;

  // 弹出面板中的模型名
  const popoverName = $('#popoverModelName');
  if (popoverName) popoverName.textContent = selectedModelId || '未选择';

  // 比例按钮
  $$('.ratio-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ratio === aspectRatio);
  });

  // 倍数按钮
  $$('.multiplier-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mult) === batchSize);
  });

  // 复用开关
  const promptCb = $('#popoverReusePrompt');
  if (promptCb) promptCb.checked = reusePrompt;
  const refCb = $('#popoverReuseRef');
  if (refCb) refCb.checked = reuseRef;
}

// --- 模型下拉框 ---

let modelDropdownOpen = false;
let modelDropdownHighlightIdx = -1;

function openModelDropdown() {
  modelDropdownOpen = true;
  const dropdown = $('#modelDropdown');
  dropdown.style.display = 'flex';
  renderModelDropdownItems();
  const search = $('#modelDropdownSearch');
  search.value = '';
  setTimeout(() => search.focus(), 50);
}

function closeModelDropdown() {
  modelDropdownOpen = false;
  $('#modelDropdown').style.display = 'none';
  modelDropdownHighlightIdx = -1;
}

function toggleModelDropdown() {
  if (modelDropdownOpen) closeModelDropdown();
  else openModelDropdown();
}

function renderModelDropdownItems(filter = '') {
  const { models, selectedModelId } = getState();
  const list = $('#modelDropdownList');
  const q = filter.toLowerCase().trim();

  const filtered = q ? models.filter(m => m.id.toLowerCase().includes(q)) : models;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="model-dropdown-empty">${models.length === 0 ? '模型列表为空，请点击下方刷新' : '无匹配模型'}</div>`;
    modelDropdownHighlightIdx = -1;
    return;
  }

  const groups = groupModelsByProvider(filtered);
  const providerNames = Object.keys(groups).sort();

  let html = '';
  for (const provider of providerNames) {
    html += `<div class="model-dropdown-group-label">${escapeHtml(provider)}</div>`;
    for (const m of groups[provider]) {
      const active = m.id === selectedModelId;
      html += `<div class="model-dropdown-item${active ? ' highlighted' : ''}" data-mid="${escapeHtml(m.id)}">
        <span class="md-check">${active ? '✓' : ''}</span>
        <span class="md-name">${escapeHtml(m.id)}</span>
        <span class="md-owner">${escapeHtml(m.owner || provider)}</span>
      </div>`;
    }
  }

  list.innerHTML = html;

  // Set initial highlight
  modelDropdownHighlightIdx = -1;
  const items = $$('#modelDropdownList .model-dropdown-item');
  if (selectedModelId && !q) {
    const idx = Array.from(items).findIndex(el => el.dataset.mid === selectedModelId);
    if (idx >= 0) {
      modelDropdownHighlightIdx = idx;
      items[idx].classList.add('highlighted');
    }
  }
  if (modelDropdownHighlightIdx < 0 && items.length > 0) {
    modelDropdownHighlightIdx = 0;
    items[0].classList.add('highlighted');
  }
}

function navigateModelDropdown(direction) {
  const items = $$('#modelDropdownList .model-dropdown-item');
  if (items.length === 0) return;

  if (modelDropdownHighlightIdx >= 0 && modelDropdownHighlightIdx < items.length) {
    items[modelDropdownHighlightIdx].classList.remove('highlighted');
  }

  modelDropdownHighlightIdx = (modelDropdownHighlightIdx + direction + items.length) % items.length;
  items[modelDropdownHighlightIdx].classList.add('highlighted');
  items[modelDropdownHighlightIdx].scrollIntoView({ block: 'nearest' });
}

function executeModelDropdownSelection() {
  const items = $$('#modelDropdownList .model-dropdown-item');
  if (modelDropdownHighlightIdx >= 0 && modelDropdownHighlightIdx < items.length) {
    const mid = items[modelDropdownHighlightIdx].dataset.mid;
    if (mid) {
      selectModel(mid);
      closeModelDropdown();
    }
  }
}

export function initPromptArea() {
  const popover = $('#settingsPopover');
  const modelTag = $('#modelTag');

  // --- 生成操作 ---
  $('#sendBtn').addEventListener('click', generate);

  $('#promptInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generate();
    }
  });

  // --- 初始同步 ---
  syncSettingsState();

  // --- 弹出面板开/关 ---
  modelTag.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popover.style.display !== 'none';
    popover.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) modelTag.classList.add('open');
    else {
      modelTag.classList.remove('open');
      closeModelDropdown();
    }
  });

  // 点击面板外关闭
  document.addEventListener('click', e => {
    if (!e.target.closest('.settings-popover') && !e.target.closest('.model-tag')) {
      popover.style.display = 'none';
      modelTag.classList.remove('open');
      closeModelDropdown();
    }
    // 点击下拉框外关闭下拉框（但保留 popover）
    if (modelDropdownOpen && !e.target.closest('.model-dropdown') && !e.target.closest('.popover-model-row')) {
      closeModelDropdown();
    }
  });

  // --- Tab 切换（图片/视频） ---
  $$('.popover-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.popover-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // --- 比例按钮 ---
  $$('.ratio-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ratio = btn.dataset.ratio;
      if (ratio) {
        setState({ aspectRatio: ratio });
        syncSettingsState();
      }
    });
  });

  // --- 倍数按钮（映射到 batchSize） ---
  $$('.multiplier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mult = parseInt(btn.dataset.mult);
      if (mult) {
        setState({ batchSize: mult });
        syncSettingsState();
      }
    });
  });

  // --- 弹出面板中的模型行切换下拉框 ---
  const popoverModelRow = $('#popoverModelRow');
  if (popoverModelRow) {
    popoverModelRow.addEventListener('click', e => {
      e.stopPropagation();
      toggleModelDropdown();
    });
  }

  // --- 模型下拉框事件 ---
  const dropdownSearch = $('#modelDropdownSearch');
  dropdownSearch.addEventListener('input', e => {
    renderModelDropdownItems(e.target.value);
  });

  dropdownSearch.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateModelDropdown(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); navigateModelDropdown(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); executeModelDropdownSelection(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeModelDropdown(); }
  });

  $('#modelDropdownList').addEventListener('click', e => {
    const item = e.target.closest('.model-dropdown-item');
    if (!item) return;
    selectModel(item.dataset.mid);
    closeModelDropdown();
  });

  $('#modelDropdownRefresh').addEventListener('click', () => {
    fetchModels();
  });

  // --- 复用开关 ---
  const promptToggle = $('#popoverReusePrompt');
  if (promptToggle) {
    promptToggle.addEventListener('change', () => {
      setState({ reusePrompt: promptToggle.checked });
    });
  }
  const refToggle = $('#popoverReuseRef');
  if (refToggle) {
    refToggle.addEventListener('change', () => {
      setState({ reuseRef: refToggle.checked });
    });
  }

  // --- + 按钮添加参考图 ---
  const fileInput = $('#attachFileInput');
  $('#attachBtn').addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        addRefImage(file.name, ev.target.result);
      };
      reader.readAsDataURL(file);
    });
    fileInput.value = '';
  });

  // --- 状态订阅 ---
  subscribe('batchSize', syncSettingsState);
  subscribe('reusePrompt', syncSettingsState);
  subscribe('reuseRef', syncSettingsState);
  subscribe('aspectRatio', syncSettingsState);
  subscribe('selectedModelId', () => {
    syncSettingsState();
    if (modelDropdownOpen) renderModelDropdownItems($('#modelDropdownSearch').value);
  });
  subscribe('models', () => {
    if (modelDropdownOpen) renderModelDropdownItems($('#modelDropdownSearch').value);
  });

  // --- 附件移除 ---
  $('#attachments').addEventListener('click', e => {
    const btn = e.target.closest('.remove');
    if (btn) removeRefImage(parseInt(btn.dataset.ridx));
  });

  // --- 粘贴处理器 ---
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const name = file.name || '粘贴图片 ' + new Date().toLocaleTimeString();
        const reader = new FileReader();
        reader.onload = async ev => {
          const dataUrl = ev.target.result;
          await addDroppedImage(dataUrl);
          await addMaterial(name, dataUrl);
          setState({ statusText: '已添加图片到画布和素材库' });
        };
        reader.readAsDataURL(file);
      }
    }
  });

  // --- 拖放目标 ---
  const promptArea = $('#promptArea');
  promptArea.addEventListener('dragover', e => {
    e.preventDefault();
    promptArea.classList.add('drag-over');
  });
  promptArea.addEventListener('dragleave', e => {
    if (!promptArea.contains(e.relatedTarget)) {
      promptArea.classList.remove('drag-over');
    }
  });
  promptArea.addEventListener('drop', async e => {
    e.preventDefault();
    promptArea.classList.remove('drag-over');
    const data = e.dataTransfer.getData('text/plain') ||
                 e.dataTransfer.getData('application/json');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.dataUrl) {
          let finalUrl = parsed.dataUrl;
          if (finalUrl.startsWith('blob:')) {
            try {
              const res = await fetch(finalUrl);
              const blob = await res.blob();
              finalUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            } catch {}
          }
          addRefImage(parsed.name || '参考图', finalUrl);
        }
      } catch {
        if (data.startsWith('data:image')) {
          addRefImage('参考图', data);
        }
      }
    }
  });

  // --- 参考图变化订阅 ---
  subscribe('refImages', renderAttachments);
}
