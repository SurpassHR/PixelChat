import { getState, setState, subscribe, appendMessage, addResultToCanvas, addDroppedImage, addMaterial, addGeneratingPlaceholder, registerAbort } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';
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
  const { selectedModelId, refImages, reusePrompt, reuseRef } = getState();
  const prompt = $('#promptInput').value.trim();

  if (!selectedModelId) {
    setState({ statusText: '请先选择一个模型' });
    return;
  }
  if (!prompt) {
    setState({ statusText: '请输入提示词' });
    return;
  }

  setState({ statusText: '正在生成...' });

  const turnRefs = [...refImages];

  // Add generating placeholder to canvas
  const genItem = addGeneratingPlaceholder(prompt, turnRefs);
  const placeholderId = genItem?.itemId;

  // Create abort controller for cancellation
  const controller = new AbortController();
  if (placeholderId) registerAbort(placeholderId, controller);

  // Store user message
  await appendMessage({ role: 'user', prompt, refImages: turnRefs });

  // Clear input
  if (!reusePrompt) {
    $('#promptInput').value = '';
  }
  if (!reuseRef) {
    setState({ refImages: [] });
  }

  try {
    const { imageUrl } = await generateImage({
      base, key,
      model: selectedModelId,
      prompt,
      refImages: turnRefs,
      signal: controller.signal
    });

    if (imageUrl) {
      await addResultToCanvas({
        status: 'ok',
        imageUrl,
        prompt,
        refImages: turnRefs,
        placeholderId
      });
      setState({ statusText: '生成完成' });
    } else {
      const errMsg = '响应中未找到图片URL';
      console.error('[生成失败]', errMsg);
      showToast(errMsg, 'error');
      await addResultToCanvas({
        status: 'error',
        error: errMsg,
        prompt,
        refImages: turnRefs,
        placeholderId
      });
      setState({ statusText: errMsg });
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      setState({ statusText: '已取消生成' });
      return;
    }
    console.error('[生成失败]', e.message);
    showToast(e.message, 'error');
    await addResultToCanvas({
      status: 'error',
      error: e.message,
      prompt,
      refImages: turnRefs,
      placeholderId
    });
    setState({ statusText: '生成失败' });
  }
}

function toggleReuse() {
  const { reusePrompt } = getState();
  const next = !reusePrompt;
  setState({ reusePrompt: next });
  const toggle = $('#reuseToggle');
  toggle.classList.toggle('active', next);
  toggle.title = next ? '复用提示词（开启）— 发送后提示词将保留' : '复用提示词（关闭）— 发送后清空输入框';
}

function toggleReuseRef() {
  const { reuseRef } = getState();
  const next = !reuseRef;
  setState({ reuseRef: next });
  const toggle = $('#reuseRefToggle');
  toggle.classList.toggle('active', next);
  toggle.title = next ? '复用参考图（开启）— 发送后参考图将保留' : '复用参考图（关闭）— 发送后清空参考图';
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

  // Reuse toggle
  $('#reuseToggle').addEventListener('click', toggleReuse);
  $('#reuseRefToggle').addEventListener('click', toggleReuseRef);

  // Init button states from saved values
  const { reusePrompt, reuseRef } = getState();
  if (reusePrompt) $('#reuseToggle').classList.add('active');
  if (reuseRef) $('#reuseRefToggle').classList.add('active');

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
