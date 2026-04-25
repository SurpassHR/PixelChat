import { getState, resolveIdbUrl } from '../store.js';
import { $, escapeHtml } from '../domHelpers.js';

const overlay = $('#modalOverlay');
const historyOverlay = $('#historyModalOverlay');

export async function openImageDetail(item) {
  if (!item) return;

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
}
