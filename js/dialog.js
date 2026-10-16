// A small modal dialog. showDialog resolves with the id of the button the player picked.
import { $ } from './game.js';

let current = null;

export function showDialog({ title, body, actions = [{ id: 'ok', label: 'OK', primary: true }] }) {
  closeDialog('replaced');
  const modal = $('modal');
  $('modal-title').textContent = title;
  const box = $('modal-body');
  box.innerHTML = '';
  for (const part of Array.isArray(body) ? body : [body]) {
    if (typeof part === 'string') { const p = document.createElement('p'); p.textContent = part; box.appendChild(p); } else if (part) box.appendChild(part);
  }
  const row = $('modal-actions');
  row.innerHTML = '';
  return new Promise((resolve) => {
    current = (id) => { modal.classList.add('hidden'); current = null; resolve(id); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { if (a.onClick) a.onClick(b); if (!a.keepOpen && current) current(a.id); });
      row.appendChild(b);
    }
    modal.classList.remove('hidden');
    const first = row.querySelector('.primary') || row.querySelector('button');
    if (first) setTimeout(() => first.focus(), 0);
  });
}

export function closeDialog(id = 'closed') { if (current) current(id); }
export const dialogOpen = () => !!current;

// Convenience: yes / no question.
export async function confirmDialog(title, text, yes = 'Yes', no = 'Cancel', danger = false) {
  return (await showDialog({ title, body: text, actions: [{ id: 'no', label: no }, { id: 'yes', label: yes, primary: !danger, danger }] })) === 'yes';
}

// Shows a recovery code that the player must acknowledge.
export function showRecoveryCode(code, intro) {
  const wrap = document.createElement('div');
  const p = document.createElement('p'); p.textContent = intro || 'If you ever forget your password, this code is the only way back into your account. Save it somewhere safe, like a screenshot or a note.';
  const c = document.createElement('div'); c.className = 'code'; c.textContent = code;
  wrap.append(p, c);
  return showDialog({
    title: 'Save your recovery code', body: wrap,
    actions: [
      { id: 'copy', label: 'Copy code', keepOpen: true, onClick: async (b) => { try { await navigator.clipboard.writeText(code); b.textContent = 'Copied!'; } catch { b.textContent = 'Select the code to copy'; } } },
      { id: 'ok', label: "I've saved it", primary: true },
    ],
  });
}
