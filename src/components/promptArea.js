import { getState, setState, subscribe, appendMessage, addDroppedImage, addMaterial, addGeneratingPlaceholder, submitTask, MODEL_FAMILIES, getModelId, selectFamilyRatioResolution, saveCurrentSessionDraft, resolveBackendUrl } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { showToast } from '../toast.js';
import { selectModel, fetchModels } from './modelSelector.js';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

// Configure Monaco workers for Vite
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

// Define Darkroom Luminary theme for Monaco
monaco.editor.defineTheme('darkroom', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'e0e0e0' },
    { token: 'comment', foreground: '6b5b3a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'e8b86d', fontStyle: 'bold' },
    { token: 'string', foreground: 'c49a4a' },
    { token: 'number', foreground: 'd4a84b' },
    { token: 'type', foreground: 'c9953e' },
  ],
  colors: {
    'editor.background': '#080808',
    'editor.foreground': '#e0e0e0',
    'editor.lineHighlightBackground': '#1a1815',
    'editor.selectionBackground': '#3d2e0f',
    'editorCursor.foreground': '#e8b86d',
    'editorLineNumber.foreground': '#8b691480',
    'editorLineNumber.activeForeground': '#e8b86d',
    'editor.selectionHighlightBackground': '#3d2e0f40',
    'editor.inactiveSelectionBackground': '#3d2e0f30',
    'editorWidget.background': '#1a1815',
    'editorWidget.border': '#e8b86d20',
    'input.background': '#1a1815',
    'input.border': '#e8b86d20',
    'focusBorder': '#e8b86d40',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#e8b86d10',
    'scrollbarSlider.hoverBackground': '#e8b86d20',
    'scrollbarSlider.activeBackground': '#e8b86d30',
  }
});

function renderAttachments() {
  const container = $('#attachments');
  const { refImages } = getState();
  container.innerHTML = refImages
    .map((img, i) => {
      const src = img.dataUrl ? resolveBackendUrl(img.dataUrl) : '';
      return `<div class="attachment-item">
        <div class="attachment-thumb"><img src="${src}" alt="ref" title="${img.name}"></div>
        <button class="remove" data-ridx="${i}">×</button>
      </div>`;
    })
    .join('');
}

async function addRefImage(name, dataUrl) {
  let finalDataUrl = dataUrl;
  // 如果不是 base64，尝试转换为 base64
  if (dataUrl && typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
    try {
      const fullUrl = dataUrl.startsWith('/') ? getStorageBase() + dataUrl : dataUrl;
      const response = await fetch(fullUrl);
      const blob = await response.blob();
      finalDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error('转换参考图为 base64 失败:', e);
      finalDataUrl = null;
    }
  }
  if (!finalDataUrl) return;
  const { refImages } = getState();
  refImages.push({ name, dataUrl: finalDataUrl });
  setState({ refImages: [...refImages] });
  setState({ statusText: '已添加参考图' });
}

function removeRefImage(index) {
  const { refImages } = getState();
  refImages.splice(index, 1);
  setState({ refImages: [...refImages] });
}

// Module-scoped Monaco state (shared with initPromptArea)
let _monacoEditor = null;
let _monacoVisible = false;

async function generate() {
  const { selectedModelId, selectedProvider, refImages, reusePrompt, reuseRef, batchSize, aspectRatio } = getState();

  // Sync Monaco content before generating, then collapse
  if (_monacoVisible && _monacoEditor) {
    $('#promptInput').value = _monacoEditor.getValue();
    // Collapse Monaco immediately (no animation for responsiveness)
    const expand = $('#monacoExpand');
    if (expand) { expand.style.display = 'none'; expand.classList.remove('collapsing'); }
    $('#promptInput').style.opacity = '';
    _monacoVisible = false;
  }

  const prompt = $('#promptInput').value.trim();

  if (!selectedModelId) {
    setState({ statusText: '请先选择一个模型' });
    return;
  }
  if (!prompt) {
    setState({ statusText: '请输入提示词' });
    return;
  }

  // Activate generating glow
  const inputRow = document.querySelector('.prompt-input-row');
  if (inputRow) inputRow.classList.add('generating');

  setState({ statusText: `正在提交 ${batchSize} 个任务...` });

  const turnRefs = [...refImages];

  // 将参考图中的相对路径转换为 base64，确保后端能正确识别
  const enrichedRefs = await Promise.all(turnRefs.map(async (img) => {
    let dataUrl = img.dataUrl;
    if (dataUrl && typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
      try {
        // 尝试从后端获取图片的 base64 数据
        const fullUrl = dataUrl.startsWith('/') ? getStorageBase() + dataUrl : dataUrl;
        const response = await fetch(fullUrl);
        const blob = await response.blob();
        dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.error('转换参考图为 base64 失败:', e);
        dataUrl = null;
      }
    }
    return { name: img.name, dataUrl };
  }));

  // Save batchSize to store for persistence
  setState({ batchSize });

  // Submit tasks to backend queue in parallel
  const refs = enrichedRefs;
  const submissions = Array.from({ length: batchSize }, () =>
    submitTask({ prompt, model: selectedModelId, provider: selectedProvider, refs, aspectRatio })
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
  const { batchSize, reusePrompt, reuseRef, aspectRatio, selectedFamilyId, selectedResolution, simpleMode, selectedModelId, models } = getState();

  // 胶囊栏中的模型标签 — 根据简易模式决定显示内容
  let modelDisplayName = '';
  if (simpleMode && selectedModelId) {
    // 简易模式：显示选中的模型 ID
    modelDisplayName = selectedModelId;
  } else if (selectedFamilyId) {
    const family = MODEL_FAMILIES.find(f => f.id === selectedFamilyId);
    modelDisplayName = family ? family.label : selectedFamilyId;
  } else {
    modelDisplayName = '未选择';
  }
  const tagName = $('#modelTagName');
  if (tagName) tagName.textContent = modelDisplayName;
  const tagMult = $('#modelTagMult');
  if (tagMult) tagMult.textContent = '×' + batchSize;
  const tagRatio = $('#modelTagRatio');
  if (tagRatio) tagRatio.textContent = aspectRatio;

  // 弹出面板中的模型名（旧元素兼容）
  const popoverName = $('#popoverModelName');
  if (popoverName) popoverName.textContent = simpleMode && selectedModelId ? selectedModelId : (selectedFamilyId ? (MODEL_FAMILIES.find(f => f.id === selectedFamilyId)?.label || selectedFamilyId) : '未选择');

  // 比例按钮
  $$('.ratio-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ratio === aspectRatio);
  });

  // 倍数按钮
  $$('.multiplier-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mult) <= batchSize);
  });

  // 系列按钮
  $$('.family-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.family === selectedFamilyId);
  });

  // 分辨率按钮 — 根据当前 family+ratio 动态启用/禁用
  renderResolutionButtons();

  // 复用开关
  const promptCb = $('#popoverReusePrompt');
  if (promptCb) promptCb.checked = reusePrompt;
  const refCb = $('#popoverReuseRef');
  if (refCb) refCb.checked = reuseRef;

  // 根据提供商模板更新UI（比例/分辨率行显示与否）
  updatePopoverByProvider();
}

// 根据当前 family + ratio 渲染分辨率按钮状态
function renderResolutionButtons() {
  const { selectedFamilyId, aspectRatio, selectedResolution } = getState();
  const family = MODEL_FAMILIES.find(f => f.id === selectedFamilyId);
  const resList = family ? (family.ratios[aspectRatio] || []) : [];

  $$('.resolution-btn').forEach(btn => {
    const res = btn.dataset.res;
    const available = resList.includes(res);
    btn.classList.toggle('active', res === selectedResolution && available);
    if (!available) {
      btn.setAttribute('disabled', '');
      btn.style.display = 'none';
    } else {
      btn.removeAttribute('disabled');
      btn.style.display = '';
    }
  });
}

// 提供商UI模板映射
const PROVIDER_UI_TEMPLATES = {
  // Google Gemini: 显示完整面板（比例/分辨率/模型系列）
  google: 'full',
  // OpenAI GPT: 仅显示模型选择框
  openai: 'simple',
};

// 获取当前提供商的UI模板类型
function getProviderTemplate(providerName) {
  if (!providerName) return 'full'; // 默认显示完整面板
  const lowerName = providerName.toLowerCase();
  if (lowerName.includes('gemini')) return PROVIDER_UI_TEMPLATES.google;
  if (lowerName.includes('gpt') || lowerName.includes('openai')) return PROVIDER_UI_TEMPLATES.openai;
  // 可以根据需要增加更多映射规则
  return 'full';
}

// 根据简易模式开关更新弹窗UI显示
function updatePopoverByProvider() {
  const { simpleMode } = getState();
  
  console.log('[updatePopoverByProvider] 简易模式状态:', simpleMode);

  // 获取需要控制显示/隐藏的元素
  const ratioGrid = document.querySelector('.ratio-grid');
  const ratioSection = ratioGrid ? ratioGrid.closest('.popover-section') : null;
  const resolutionRow = $('#resolutionRow');
  const familyRow = $('#familyRow');
  const modelSelectWrapper = $('#modelSelectWrapper');
  
  console.log('[updatePopoverByProvider] 元素存在性:', {
    ratioSection: !!ratioSection,
    resolutionRow: !!resolutionRow,
    familyRow: !!familyRow,
    modelSelectWrapper: !!modelSelectWrapper
  });

  if (simpleMode) {
    // 简易模式：隐藏比例/分辨率/模型系列按钮，显示下拉框
    if (ratioSection) ratioSection.style.display = 'none';
    if (resolutionRow) resolutionRow.style.display = 'none';
    if (familyRow) familyRow.style.display = 'none';
    if (modelSelectWrapper) modelSelectWrapper.style.display = '';
    console.log('[popover] 简易模式：隐藏比例/分辨率/模型系列按钮，显示下拉框');
  } else {
    // 完整模式：显示所有选项，隐藏下拉框
    if (ratioSection) ratioSection.style.display = '';
    if (resolutionRow) resolutionRow.style.display = '';
    if (familyRow) familyRow.style.display = '';
    if (modelSelectWrapper) modelSelectWrapper.style.display = 'none';
    console.log('[popover] 完整模式：显示比例/分辨率/模型系列按钮，隐藏下拉框');
  }
}

export function initPromptArea() {
  const popover = $('#settingsPopover');
  const modelTag = $('#modelTag');
  const promptInput = $('#promptInput');
  const monacoExpand = $('#monacoExpand');
  const monacoContainer = $('#monacoContainer');

  // --- Monaco editor management ---
  function openMonaco() {
    if (_monacoVisible) return;
    _monacoVisible = true;
    monacoExpand.style.display = 'flex';
    monacoExpand.classList.remove('collapsing');

    if (!_monacoEditor) {
      _monacoEditor = monaco.editor.create(monacoContainer, {
        value: promptInput.value,
        language: 'markdown',
        theme: 'darkroom',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
        lineHeight: 22,
        minimap: { enabled: false },
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        padding: { top: 12, bottom: 12 },
        scrollbar: {
          verticalScrollbarSize: 4,
          horizontalScrollbarSize: 4,
        },
        suggest: { showWords: false, showSnippets: false },
        quickSuggestions: false,
        parameterHints: { enabled: false },
      });
    } else {
      _monacoEditor.setValue(promptInput.value);
      _monacoEditor.layout();
    }

    promptInput.style.opacity = '0';
    _monacoEditor.focus();
  }

  function closeMonaco() {
    if (!_monacoVisible) return;
    _monacoVisible = false;

    if (_monacoEditor) {
      const newPrompt = _monacoEditor.getValue();
      promptInput.value = newPrompt;
      // 同步到 store
      const currentPrompt = getState().promptDraft;
      if (newPrompt !== currentPrompt) {
        console.log('[closeMonaco] Monaco 关闭，同步提示词, 新内容长度:', newPrompt.length);
        setState({ promptDraft: newPrompt });
        saveCurrentSessionDraft();
      }
    }

    monacoExpand.classList.add('collapsing');
    const onAnimEnd = () => {
      monacoExpand.style.display = 'none';
      monacoExpand.classList.remove('collapsing');
      monacoExpand.removeEventListener('animationend', onAnimEnd);
    };
    monacoExpand.addEventListener('animationend', onAnimEnd);
    promptInput.style.opacity = '';
  }

  // --- 生成操作 ---
  $('#sendBtn').addEventListener('click', generate);

  // --- Prompt input events ---
  promptInput.addEventListener('focus', () => {
    openMonaco();
  });

  promptInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !_monacoVisible) {
      e.preventDefault();
      generate();
    }
  });

  // Monaco keyboard: ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _monacoVisible) {
      // Check if Monaco's own suggest widget is open
      if (document.querySelector('.monaco-editor .suggest-widget.visible')) return;
      e.preventDefault();
      closeMonaco();
    }
  });

  // --- 初始同步 ---
  syncSettingsState();
  // 额外确保第一次更新 UI（基于当前提供商）
  updatePopoverByProvider();

  // --- 弹出面板开/关（带动画） ---
  function openPopover() {
    // 打开前确保 UI 基于当前提供商正确显示
    updatePopoverByProvider();
    popover.style.display = 'flex';
    popover.classList.remove('popover-exit');
    void popover.offsetWidth;
    popover.classList.add('popover-enter');
    modelTag.classList.add('open');
  }

  function closePopover() {
    if (popover.style.display === 'none') return;
    popover.classList.remove('popover-enter');
    popover.classList.add('popover-exit');
    modelTag.classList.remove('open');
    const onAnimEnd = () => {
      popover.style.display = 'none';
      popover.classList.remove('popover-exit');
      popover.removeEventListener('animationend', onAnimEnd);
    };
    popover.addEventListener('animationend', onAnimEnd);
  }

  function isPopoverOpen() {
    return popover.classList.contains('popover-enter') ||
      (!popover.classList.contains('popover-exit') && popover.style.display === 'flex');
  }

  modelTag.addEventListener('click', e => {
    e.stopPropagation();
    if (isPopoverOpen()) closePopover();
    else openPopover();
  });

  // 点击面板外关闭
  document.addEventListener('click', e => {
    if (!e.target.closest('.settings-popover') && !e.target.closest('.model-tag')) {
      closePopover();
    }
    // 点击 Monaco 展开区域外关闭 Monaco
    if (_monacoVisible && !e.target.closest('.monaco-expand') && e.target !== promptInput) {
      closeMonaco();
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
        const { selectedFamilyId, selectedResolution } = getState();
        if (selectedFamilyId) {
          selectFamilyRatioResolution(selectedFamilyId, ratio, selectedResolution);
        } else {
          setState({ aspectRatio: ratio });
        }
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

  // --- 模型系列按钮 ---
  $$('.family-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const familyId = btn.dataset.family;
      if (!familyId) return;
      const family = MODEL_FAMILIES.find(f => f.id === familyId);
      if (!family) return;
      const { aspectRatio, selectedResolution } = getState();
      // 当前比例对所选系列不可用时，自动选第一个可用比例
      let ratio = aspectRatio;
      if (!family.ratios[ratio]) {
        ratio = Object.keys(family.ratios)[0];
      }
      let resolution = selectedResolution;
      const resList = family.ratios[ratio];
      if (!resList.includes(resolution)) {
        resolution = resList[0];
      }
      selectFamilyRatioResolution(familyId, ratio, resolution);
      syncSettingsState();
    });
  });

  // --- 分辨率按钮 ---
  $$('#resolutionRow .resolution-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const res = btn.dataset.res;
      if (!res || btn.hasAttribute('disabled')) return;
      const { selectedFamilyId, aspectRatio } = getState();
      if (selectedFamilyId) {
        selectFamilyRatioResolution(selectedFamilyId, aspectRatio, res);
        syncSettingsState();
      } else {
        setState({ selectedResolution: res });
      }
    });
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

  // --- 简易模式开关 ---
  const simpleModeToggle = $('#popoverSimpleMode');
  if (simpleModeToggle) {
    const { simpleMode } = getState();
    simpleModeToggle.checked = simpleMode;
    simpleModeToggle.addEventListener('change', () => {
      setState({ simpleMode: simpleModeToggle.checked });
    });
  }

  // --- 简易模式下自定义模型下拉框 ---
  const customModelSelector = $('#customModelSelector');
  const customModelTrigger = $('#customModelTrigger');
  const customModelDropdown = $('#customModelDropdown');
  const customModelSearch = $('#customModelSearch');
  const customModelList = $('#customModelList');
  const customModelRefresh = $('#customModelRefresh');
  
  let isDropdownOpen = false;
  
  // 渲染自定义模型列表（带分组、搜索）
  function renderCustomModelList(filterText = '') {
    if (!customModelList) return;
    const { models, selectedModelId } = getState();
    if (!models || models.length === 0) {
      customModelList.innerHTML = '<div class="model-dropdown-empty">暂无可用模型</div>';
      return;
    }
    
    // 按 provider 分组
    const groups = {};
    models.forEach(model => {
      const provider = model.provider || '其他';
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(model);
    });
    
    // 过滤
    const lowerFilter = filterText.toLowerCase();
    let hasResults = false;
    let html = '';
    
    Object.keys(groups).sort().forEach(provider => {
      const filteredModels = groups[provider].filter(model => 
        !filterText || model.id.toLowerCase().includes(lowerFilter)
      );
      if (filteredModels.length === 0) return;
      hasResults = true;
      html += `<div class="model-dropdown-group-label">${escapeHtml(provider)}</div>`;
      filteredModels.forEach(model => {
        const isSelected = (model.id === selectedModelId);
        html += `
          <div class="model-dropdown-item ${isSelected ? 'highlighted' : ''}" data-mid="${escapeHtml(model.id)}">
            <span class="md-name">${escapeHtml(model.id)}</span>
            <span class="md-owner">${escapeHtml(model.provider || '')}</span>
          </div>
        `;
      });
    });
    
    if (!hasResults) {
      html = '<div class="model-dropdown-empty">未找到匹配的模型</div>';
    }
    customModelList.innerHTML = html;
    
    // 绑定点击事件
    customModelList.querySelectorAll('.model-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const modelId = item.getAttribute('data-mid');
        if (!modelId) return;
        const { models } = getState();
        const selectedModel = models.find(m => m.id === modelId);
        if (selectedModel) {
          setState({
            selectedModelId: modelId,
            selectedProvider: selectedModel.provider
          });
          // 更新触发按钮显示文字
          if (customModelTrigger) {
            const nameSpan = customModelTrigger.querySelector('.trigger-name');
            if (nameSpan) nameSpan.textContent = modelId;
          }
        }
        closeDropdown();
      });
    });
  }
  
  function openDropdown() {
    if (!customModelDropdown) return;
    // 重新渲染确保最新数据
    renderCustomModelList(customModelSearch ? customModelSearch.value : '');
    customModelDropdown.style.display = 'flex';
    isDropdownOpen = true;
    if (customModelSearch) {
      customModelSearch.focus();
      customModelSearch.value = '';
      renderCustomModelList('');
    }
  }
  
  function closeDropdown() {
    if (!customModelDropdown) return;
    customModelDropdown.style.display = 'none';
    isDropdownOpen = false;
  }
  
  function toggleDropdown() {
    if (isDropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }
  
  // 触发按钮点击
  if (customModelTrigger) {
    customModelTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }
  
  // 搜索输入事件
  if (customModelSearch) {
    customModelSearch.addEventListener('input', (e) => {
      renderCustomModelList(e.target.value);
    });
  }
  
  // 刷新按钮
  if (customModelRefresh) {
    customModelRefresh.addEventListener('click', async () => {
      const { fetchModels } = await import('./modelSelector.js');
      await fetchModels();
      renderCustomModelList(customModelSearch ? customModelSearch.value : '');
    });
  }
  
  // 点击外部关闭下拉框
  document.addEventListener('click', (e) => {
    if (isDropdownOpen && customModelSelector && !customModelSelector.contains(e.target)) {
      closeDropdown();
    }
  });
  
  // 订阅 models 变化时更新触发按钮文字和下拉列表
  const updateTriggerName = () => {
    if (!customModelTrigger) return;
    const { selectedModelId } = getState();
    if (selectedModelId) {
      const nameSpan = customModelTrigger.querySelector('.trigger-name');
      if (nameSpan) nameSpan.textContent = selectedModelId;
    }
  };
  subscribe('models', () => {
    if (isDropdownOpen) {
      renderCustomModelList(customModelSearch ? customModelSearch.value : '');
    }
    updateTriggerName();
  });
  subscribe('selectedModelId', updateTriggerName);
  
  // 初始化显示
  updateTriggerName();
  if (customModelList) {
    renderCustomModelList('');
  }
  
  // 注意：原来的 modelSelectWrapper 仍然控制显示隐藏，但内容已替换为自定义结构
  const modelSelectWrapper = $('#modelSelectWrapper');

  // --- + 按钮添加参考图 ---
  const fileInput = $('#attachFileInput');
  $('#attachBtn').addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async ev => {
        await addRefImage(file.name, ev.target.result);
      };
      reader.readAsDataURL(file);
    }
    fileInput.value = '';
  });

  // --- 状态订阅 ---
  subscribe('batchSize', syncSettingsState);
  subscribe('reusePrompt', syncSettingsState);
  subscribe('reuseRef', syncSettingsState);
  subscribe('aspectRatio', syncSettingsState);
  subscribe('selectedModelId', syncSettingsState);
  subscribe('selectedFamilyId', syncSettingsState);
  subscribe('selectedResolution', syncSettingsState);
  subscribe('models', syncSettingsState);
  subscribe('simpleMode', () => {
    updatePopoverByProvider();
    syncSettingsState();
  });
  subscribe('statusText', (newStatus) => {
    if (!newStatus) return;
    // Remove generating glow when idle or error
    if (newStatus === '就绪' || newStatus.includes('失败') || newStatus.includes('错误')) {
      const row = document.querySelector('.prompt-input-row');
      if (row) row.classList.remove('generating');
    }
  });

  // --- 附件移除 ---
  $('#attachments').addEventListener('click', e => {
    const btn = e.target.closest('.remove');
    if (btn) removeRefImage(parseInt(btn.dataset.ridx));
  });

  // --- 粘贴处理器 ---
  document.addEventListener('paste', async e => {
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
          await addRefImage(parsed.name || '参考图', finalUrl);
        }
      } catch {
        if (data.startsWith('data:image')) {
          await addRefImage('参考图', data);
        }
      }
    }
  });

  // --- 参考图变化订阅 ---
  subscribe('refImages', renderAttachments);
  // 立即渲染一次，确保已有的参考图被显示
  renderAttachments();
  
  // 监听自定义事件，数据加载完成后强制刷新（兜底）
  window.addEventListener('ref-images-loaded', () => {
    renderAttachments();
  });
  
  // 提示词草稿恢复与同步
  const { promptDraft } = getState();
  console.log('[initPromptArea] 初始化时 promptDraft:', promptDraft);
  if (promptDraft) {
    $('#promptInput').value = promptDraft;
    if (_monacoEditor) _monacoEditor.setValue(promptDraft);
    console.log('[initPromptArea] 已恢复提示词:', promptDraft.substring(0, 50));
  }
  
  // 监听提示词输入变化，同步到 store.promptDraft 并保存草稿
  const syncPromptDraft = () => {
    const newPrompt = $('#promptInput').value;
    const currentPrompt = getState().promptDraft;
    if (newPrompt !== currentPrompt) {
      console.log('[syncPromptDraft] 提示词变化，保存中... 新内容长度:', newPrompt.length);
      setState({ promptDraft: newPrompt });
      saveCurrentSessionDraft();
    }
  };
  $('#promptInput').addEventListener('input', syncPromptDraft);
  
  // 在 closeMonaco 时同步内容
  const originalCloseMonaco = closeMonaco;
  window._closeMonaco = originalCloseMonaco;
}
