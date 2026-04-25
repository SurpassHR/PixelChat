import { getState, setState, subscribe, appendMessage, addResultToCanvas, addDroppedImage, addMaterial, addGeneratingPlaceholder, registerAbort } from '../store.js';
import { $, $$, escapeHtml } from '../domHelpers.js';
import { getApiConfig, generateImage } from '../api.js';
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
  const { base, key } = getApiConfig();
  const { selectedModelId, refImages, reusePrompt, reuseRef, batchSize } = getState();
  const prompt = $('#promptInput').value.trim();

  if (!selectedModelId) {
    setState({ statusText: '请先选择一个模型' });
    return;
  }
  if (!prompt) {
    setState({ statusText: '请输入提示词' });
    return;
  }

  setState({ statusText: `正在生成 ${batchSize} 张图片...` });

  const turnRefs = [...refImages];

  // Save batchSize to store for persistence
  setState({ batchSize });

  // Create generating placeholders and abort controllers
  const placeholders = [];
  for (let i = 0; i < batchSize; i++) {
    const genItem = addGeneratingPlaceholder(prompt, turnRefs);
    const controller = new AbortController();
    if (genItem?.itemId) {
      registerAbort(genItem.itemId, controller);
      placeholders.push({ placeholderId: genItem.itemId, controller });
    }
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

  // Launch all generations in parallel
  const results = await Promise.allSettled(
    placeholders.map(({ placeholderId, controller }) =>
      generateImage({
        base, key,
        model: selectedModelId,
        prompt,
        refImages: turnRefs,
        signal: controller.signal
      }).then(({ imageUrl }) => ({ placeholderId, imageUrl }))
    )
  );

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < results.length; i++) {
    const { placeholderId } = placeholders[i];
    const result = results[i];

    if (result.status === 'fulfilled') {
      const { imageUrl } = result.value;
      if (imageUrl) {
        await addResultToCanvas({
          status: 'ok', imageUrl, prompt, refImages: turnRefs, placeholderId
        });
        successCount++;
      } else {
        const errMsg = '响应中未找到图片URL';
        console.error('[生成失败]', errMsg);
        showToast(errMsg, 'error');
        await addResultToCanvas({
          status: 'error', error: errMsg, prompt, refImages: turnRefs, placeholderId
        });
        failCount++;
      }
    } else {
      if (result.reason?.name === 'AbortError') continue;
      const errMsg = result.reason?.message || '生成失败';
      console.error('[生成失败]', errMsg);
      showToast(errMsg, 'error');
      await addResultToCanvas({
        status: 'error', error: errMsg, prompt, refImages: turnRefs, placeholderId
      });
      failCount++;
    }
  }

  const total = successCount + failCount;
  if (successCount === total) {
    setState({ statusText: `生成完成（${total} 张）` });
  } else if (successCount > 0) {
    setState({ statusText: `完成 ${successCount}/${total} 张，${failCount} 张失败` });
  } else {
    setState({ statusText: '生成失败' });
  }
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
