export function showToast(msg, type = 'error', duration = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type;
  void el.offsetWidth;
  el.classList.add('show');

  clearTimeout(el._timer);
  el._timer = null;

  if (duration > 0) {
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
  }

  el.onclick = () => el.classList.remove('show');
}
