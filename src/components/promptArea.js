import { getState, setState, subscribe, appendMessage, addDroppedImage, addMaterial, addGeneratingPlaceholder, submitTask } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { showToast } from '../toast.js';

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

function syncDropdownState() {
  const { batchSize, reusePrompt, reuseRef } = getState();

  // Update batch badge
  const badge = $('#triggerBatchBadge');
  if (badge) badge.textContent = '×' + batchSize;

  // Update batch option buttons
  $$('.batch-opt').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.batch) === batchSize);
  });

  // Update reuse checkboxes
  const promptCb = document.querySelector('#dropdownTogglePrompt input');
  if (promptCb) promptCb.checked = reusePrompt;
  const refCb = document.querySelector('#dropdownToggleRef input');
  if (refCb) refCb.checked = reuseRef;
}

export function initPromptArea() {
  // Generate button
  $('#generateBtn').addEventListener('click', generate);

  // Enter to send
  $('#promptInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generate();
    }
  });

  // Sync initial dropdown state
  syncDropdownState();

  // Dropdown toggle
  const trigger = $('#optionsTrigger');
  const dropdown = $('#optionsDropdown');
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    trigger.setAttribute('aria-expanded', !isOpen);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.options-menu')) {
      dropdown.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  // Batch size buttons
  $('#dropdownBatchRow').addEventListener('click', e => {
    const btn = e.target.closest('.batch-opt');
    if (!btn) return;
    const val = parseInt(btn.dataset.batch);
    if (val) {
      setState({ batchSize: val });
      syncDropdownState();
    }
  });

  // Reuse prompt toggle
  const promptToggle = document.querySelector('#dropdownTogglePrompt input');
  if (promptToggle) {
    promptToggle.addEventListener('change', () => {
      setState({ reusePrompt: promptToggle.checked });
    });
  }

  // Reuse ref toggle
  const refToggle = document.querySelector('#dropdownToggleRef input');
  if (refToggle) {
    refToggle.addEventListener('change', () => {
      setState({ reuseRef: refToggle.checked });
    });
  }

  // Subscribe to state changes for UI sync
  subscribe('batchSize', syncDropdownState);
  subscribe('reusePrompt', syncDropdownState);
  subscribe('reuseRef', syncDropdownState);

  // Remove attachment delegation
  $('#attachments').addEventListener('click', e => {
    const btn = e.target.closest('.remove');
    if (btn) removeRefImage(parseInt(btn.dataset.ridx));
  });

  // Paste handler - add pasted images to canvas and material library
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
          setState({ statusText: `已添加图片到画布和素材库` });
        };
        reader.readAsDataURL(file);
      }
    }
  });

  // Drag & drop target for prompt area
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
          // Blob URLs can't be sent to external APIs; convert to data URL
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
        // Try as URL
        if (data.startsWith('data:image')) {
          addRefImage('参考图', data);
        }
      }
    }
  });

  // Subscribe to refImages changes
  subscribe('refImages', renderAttachments);
}
