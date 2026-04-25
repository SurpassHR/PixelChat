import { getState, resolveIdbUrl } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';

const overlay = $('#modalOverlay');
const historyOverlay = $('#historyModalOverlay');

// Image transform state
let imgTransform = { scale: 1, rotation: 0, flipH: 1, flipV: 1, tx: 0, ty: 0 };
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragOrigTx = 0, dragOrigTy = 0;

function applyImageTransform(animate) {
  const img = $('#detailImage');
  const { scale, rotation, flipH, flipV, tx, ty } = imgTransform;

  img.classList.toggle('transitioning', !!animate);

  const sx = scale * flipH;
  const sy = scale * flipV;
  img.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy}) rotate(${rotation}deg)`;

  const zoomEl = document.getElementById('detailZoomLevel');
  if (zoomEl) zoomEl.textContent = `${Math.round(scale * 100)}%`;
}

function resetImageTransform() {
  imgTransform = { scale: 1, rotation: 0, flipH: 1, flipV: 1, tx: 0, ty: 0 };
  applyImageTransform(true);
}

// Zoom keeping a specific container-relative point fixed
function zoomAtPoint(newScale, cx, cy) {
  const container = document.getElementById('detailImageContainer');
  const f = newScale / imgTransform.scale;
  // cx,cy are relative to container top-left; transform-origin is at container center
  imgTransform.tx = imgTransform.tx * f + (1 - f) * (cx - container.clientWidth / 2);
  imgTransform.ty = imgTransform.ty * f + (1 - f) * (cy - container.clientHeight / 2);
  imgTransform.scale = newScale;
}

function handleImageWheel(e) {
  const container = document.getElementById('detailImageContainer');
  if (!container || container.offsetParent === null) return;

  e.preventDefault();

  const rect = container.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(10, imgTransform.scale * factor));
  zoomAtPoint(newScale, cx, cy);
  applyImageTransform(false);
}

function onDragStart(e) {
  // Only respond to left button on the image or container itself (not toolbar/buttons)
  if (e.button !== 0) return;
  const target = e.target;
  if (target !== e.currentTarget && target.tagName !== 'IMG') return;
  if (target.closest('.detail-image-toolbar')) return;

  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragOrigTx = imgTransform.tx;
  dragOrigTy = imgTransform.ty;
  e.currentTarget.style.cursor = 'grabbing';
  e.preventDefault();
}

function onDragMove(e) {
  if (!isDragging) return;
  imgTransform.tx = dragOrigTx + (e.clientX - dragStartX);
  imgTransform.ty = dragOrigTy + (e.clientY - dragStartY);
  applyImageTransform(false);
}

function onDragEnd(e) {
  if (!isDragging) return;
  isDragging = false;
  document.getElementById('detailImageContainer').style.cursor = '';
}

export async function openImageDetail(item) {
  if (!item) return;

  resetImageTransform();

  $('#modalTitle').textContent = '图片详情';
  $('#detailImage').src = await resolveIdbUrl(item.imageUrl);
  $('#detailImage').alt = '生成图片';

  // Prompt section
  const promptSection = $('#detailPromptSection');
  const detailPrompt = $('#detailPrompt');
  if (item.prompt) {
    promptSection.style.display = '';
    detailPrompt.textContent = item.prompt;
  } else {
    promptSection.style.display = 'none';
  }

  // Refs section
  const refsSection = $('#detailRefsSection');
  const detailRefs = $('#detailRefs');
  if (item.refImages && item.refImages.length > 0) {
    refsSection.style.display = '';
    const refHtml = await Promise.all(item.refImages.map(async img => {
      const src = await resolveIdbUrl(img.dataUrl);
      return `<img src="${src}" alt="${escapeHtml(img.name)}" title="${escapeHtml(img.name)}">`;
    }));
    detailRefs.innerHTML = refHtml.join('');
  } else {
    refsSection.style.display = 'none';
  }

  overlay.style.display = 'flex';
}

export function closeModal() {
  overlay.style.display = 'none';
}

export async function openPromptHistory() {
  const { sessions, currentSessionId } = getState();
  const session = sessions[currentSessionId];
  const body = $('#historyModalBody');

  if (!session || !session.messages || session.messages.length === 0) {
    body.innerHTML = '<div style="color:var(--text2);padding:12px;text-align:center;">暂无提示词历史</div>';
  } else {
    const htmlParts = [];

    for (const msg of session.messages) {
      if (msg.role === 'user') {
        const time = new Date(msg.timestamp || session.updatedAt || session.createdAt);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let part = `<div class="prompt-history-item">
          <div class="ph-time">${timeStr}</div>
          <div class="ph-prompt">${escapeHtml(msg.prompt)}</div>`;
        if (msg.refImages && msg.refImages.length > 0) {
          const refHtml = await Promise.all(msg.refImages.map(async img => {
            const src = await resolveIdbUrl(img.dataUrl);
            return `<img src="${src}" alt="${escapeHtml(img.name)}">`;
          }));
          part += `<div class="ph-refs">${refHtml.join('')}</div>`;
        }
        part += `</div>`;
        htmlParts.push(part);
      }
    }

    body.innerHTML = htmlParts.join('');

    // Now add result thumbnails by matching prompts
    let userIndex = 0;
    session.messages.forEach(msg => {
      if (msg.role === 'user') {
        const msgIndex = session.messages.indexOf(msg);
        const nextMsg = session.messages[msgIndex + 1];
        if (nextMsg && nextMsg.role === 'assistant' && nextMsg.status === 'ok') {
          const items = body.querySelectorAll('.prompt-history-item');
          if (items[userIndex]) {
            const resultDiv = document.createElement('div');
            resultDiv.className = 'ph-result';
            resolveIdbUrl(nextMsg.imageUrl).then(src => {
              resultDiv.innerHTML = `<img src="${src}" alt="结果">`;
            });
            items[userIndex].appendChild(resultDiv);
          }
        }
        userIndex++;
      }
    });
  }

  historyOverlay.style.display = 'flex';
}

export function closeHistoryModal() {
  historyOverlay.style.display = 'none';
}

export function initModal() {
  const imageContainer = document.getElementById('detailImageContainer');

  // Image detail modal
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
  $('#modalCloseBtn').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
  });

  // History modal
  historyOverlay.addEventListener('click', e => {
    if (e.target === historyOverlay) closeHistoryModal();
  });
  $('#historyModalCloseBtn').addEventListener('click', closeHistoryModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && historyOverlay.style.display !== 'none') closeHistoryModal();
  });

  // Download button in modal
  const downloadBtn = document.getElementById('detailDownloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const img = $('#detailImage');
      if (img.src) {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'image.png';
        a.click();
      }
    });
  }

  // Wheel zoom on image container
  if (imageContainer) {
    imageContainer.addEventListener('wheel', handleImageWheel, { passive: false });
  }

  // Drag to pan
  if (imageContainer) {
    imageContainer.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  // Zoom in / out buttons (centered)
  document.getElementById('detailZoomInBtn')?.addEventListener('click', () => {
    const container = document.getElementById('detailImageContainer');
    const rect = container.getBoundingClientRect();
    zoomAtPoint(Math.min(10, imgTransform.scale * 1.25), rect.width / 2, rect.height / 2);
    applyImageTransform(true);
  });
  document.getElementById('detailZoomOutBtn')?.addEventListener('click', () => {
    const container = document.getElementById('detailImageContainer');
    const rect = container.getBoundingClientRect();
    zoomAtPoint(Math.max(0.1, imgTransform.scale * 0.8), rect.width / 2, rect.height / 2);
    applyImageTransform(true);
  });

  // Rotation buttons
  document.getElementById('detailRotateLeftBtn')?.addEventListener('click', () => {
    imgTransform.rotation = (imgTransform.rotation - 90) % 360;
    applyImageTransform(true);
  });
  document.getElementById('detailRotateRightBtn')?.addEventListener('click', () => {
    imgTransform.rotation = (imgTransform.rotation + 90) % 360;
    applyImageTransform(true);
  });

  // Flip buttons
  document.getElementById('detailFlipHBtn')?.addEventListener('click', () => {
    imgTransform.flipH *= -1;
    applyImageTransform(true);
  });
  document.getElementById('detailFlipVBtn')?.addEventListener('click', () => {
    imgTransform.flipV *= -1;
    applyImageTransform(true);
  });

  // Reset button
  document.getElementById('detailResetBtn')?.addEventListener('click', resetImageTransform);

  // Copy prompt button
  document.getElementById('detailCopyBtn')?.addEventListener('click', async () => {
    const prompt = document.getElementById('detailPrompt')?.textContent;
    if (prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
        const btn = document.getElementById('detailCopyBtn');
        const orig = btn.textContent;
        btn.textContent = '✓ 已复制';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch {}
    }
  });
}
