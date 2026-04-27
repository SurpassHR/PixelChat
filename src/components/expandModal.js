let currentModal = null;

export function closeExpandModal() {
  if (!currentModal) return;
  const { listElement, originalParent, placeholder, overlay, onKey } = currentModal;
  originalParent.insertBefore(listElement, placeholder);
  placeholder.remove();
  overlay.remove();
  document.removeEventListener('keydown', onKey);
  currentModal = null;
}

export function openExpandModal(title, listElement) {
  if (!listElement) return;

  // 关闭已有 modal（会归还上次移动的列表元素）
  closeExpandModal();

  // 保存原始父节点并插入占位符
  const originalParent = listElement.parentNode;
  const placeholder = document.createElement('div');
  placeholder.style.display = 'none';
  originalParent.insertBefore(placeholder, listElement);

  // 构建 modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'expand-modal-overlay';
  overlay.innerHTML = `
    <div class="expand-modal-content">
      <div class="expand-modal-header">
        <h3>${title}</h3>
        <button class="modal-close expand-modal-close">×</button>
      </div>
      <div class="expand-modal-body"></div>
    </div>
  `;

  const body = overlay.querySelector('.expand-modal-body');
  body.appendChild(listElement);

  document.body.appendChild(overlay);

  const close = () => {
    originalParent.insertBefore(listElement, placeholder);
    placeholder.remove();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (currentModal && currentModal.overlay === overlay) {
      currentModal = null;
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.expand-modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  currentModal = { listElement, originalParent, placeholder, overlay, close, onKey };
}
