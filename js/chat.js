// The chat panel: recent messages fade out during play; pressing Enter opens the box so you can type and scroll.
import { $ } from './game.js';

const SHOW_MS = 14000;
const MAX_LINES = 120;

export function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 78% 74%)`;
}

export function createChat({ onSend, onOpenChange }) {
  const root = $('chat'), log = $('chat-log'), form = $('chat-form'), input = $('chat-input');
  let open = false;
  const lines = [];

  function addLine(el, { old = false } = {}) {
    el.className += ' msg' + (old ? ' old' : '');
    log.appendChild(el);
    lines.push({ el, at: performance.now() });
    while (lines.length > MAX_LINES) lines.shift().el.remove();
    log.scrollTop = log.scrollHeight;
    root.classList.remove('hidden');
  }

  function say({ name, text, mine = false, old = false }) {
    const el = document.createElement('div');
    const who = document.createElement('b');
    who.textContent = name;
    who.style.color = mine ? '#ffd761' : nameColor(name);
    el.append(who, document.createTextNode(text));          // textContent only: chat is untrusted
    addLine(el, { old });
  }

  function system(text) {
    const el = document.createElement('div');
    el.className = 'sys';
    el.textContent = text;
    addLine(el);
  }

  function setOpen(v) {
    if (v === open) return;
    open = v;
    root.classList.toggle('open', v);
    form.classList.toggle('hidden', !v);
    if (v) { root.classList.remove('hidden'); input.value = ''; input.focus(); setTimeout(() => input.focus(), 0); } else input.blur();   // focus now so fast typists lose no letters
    onOpenChange?.(v);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (text) onSend(text);
    setOpen(false);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; setOpen(false); }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  return {
    say, system,
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() { return open; },
    clear() { log.innerHTML = ''; lines.length = 0; },
    show(v) { root.classList.toggle('hidden', !v); },
    // Fade old lines; call every frame or so.
    update(now) {
      if (open) return;
      for (const l of lines) l.el.classList.toggle('fade', now - l.at > SHOW_MS);
    },
  };
}
