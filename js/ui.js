// 通用小工具：转义、格式化、图标、提示、弹窗

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');
export const fmtShort = (d) => (d ? String(d).slice(5, 10) : '—');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function relTime(ts) {
  if (!ts) return '';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return fmtDate(ts);
}

export function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

const PALETTE = ['#3d6b5c', '#5b6b9a', '#9a6b4d', '#7a5c8f', '#4d7f94', '#8f5c66', '#6b7a3d', '#94704d'];
export function avatarColor(id = '') {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const initials = (name = '?') => (/[\u4e00-\u9fa5]/.test(name) && name.length >= 2 ? name.slice(-2) : name.slice(0, 1).toUpperCase());
export const avatar = (p, size = '') =>
  `<span class="avatar ${size}" style="--c:${avatarColor(p?.id)}">${esc(initials(p?.name))}</span>`;

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  clip: svg('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  back: svg('<path d="m15 6-6 6 6 6"/>'),
  send: svg('<path d="M4 12h14M13 6l6 6-6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

// ---------- toast ----------
let toastBox;
export function toast(msg, type = 'info') {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    document.body.appendChild(toastBox);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => el.classList.add('out'), type === 'error' ? 4200 : 2400);
  setTimeout(() => el.remove(), type === 'error' ? 4600 : 2800);
}

// ---------- modal ----------
export function openModal({ title, body, wide = false, onMount, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="关闭">${icon.x}</button></div>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(ov);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    ov.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const first = ov.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
  onMount?.(ov.querySelector('.modal'), close);
  return { el: ov, close };
}

export function confirmDialog(message, okText = '确定删除') {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title: '请确认',
      body: `<p class="confirm-text">${esc(message)}</p>
        <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn danger" data-ok>${esc(okText)}</button></div>`,
      onMount(m, close) {
        m.querySelector('[data-ok]').addEventListener('click', () => { ok = true; close(); });
      },
      onClose: () => resolve(ok),
    });
  });
}

export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.text = btn.innerHTML; btn.disabled = true; if (text) btn.textContent = text; }
  else { btn.disabled = false; if (btn.dataset.text) btn.innerHTML = btn.dataset.text; }
}
