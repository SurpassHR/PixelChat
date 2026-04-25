export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function $(sel) {
  return document.querySelector(sel);
}

export function $$(sel, ctx) {
  return (ctx || document).querySelectorAll(sel);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
