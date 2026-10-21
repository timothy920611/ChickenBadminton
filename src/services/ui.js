import '../styles/common.css';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
export function exposeActions(actions) { Object.assign(window, actions); }
export function showPageError(error) {
  let panel = document.getElementById('pageError');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'pageError';
    panel.setAttribute('role', 'alert');
    document.body.prepend(panel);
  }
  panel.textContent = error?.message || String(error);
}

export function enableStartupControls() {
  document.querySelectorAll('[data-startup-disabled]').forEach(control => {
    control.disabled = false;
    control.removeAttribute('data-startup-disabled');
  });
}

// 所有動態內容均使用 textContent；不把使用者輸入當作 HTML 解析。
export function el(tag, className = '', text = null, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = String(text);
  node.append(...children.filter(Boolean));
  return node;
}
