// A small choice dialog: a title, a line of text and two or three buttons, centred over the app.
// → Promise of the chosen value (null when dismissed).

import { el } from './controls.js';

export function choose({ title, text = '', actions }) {
  return new Promise((resolve) => {
    const back = el('div', { className: 'dlgBack' });
    const box = el('div', { className: 'dlg', role: 'alertdialog', ariaLabel: title },
      el('b', { className: 'dlgTitle', textContent: title }),
      ...(text ? [el('p', { className: 'dlgText', textContent: text })] : []));
    const done = (v) => { back.classList.remove('in'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', key); resolve(v); };
    for (const a of actions) {
      const b = el('button', { type: 'button', className: `dlgBtn ${a.kind || ''}`, textContent: a.label });
      b.onclick = () => done(a.value ?? null);
      box.append(b);
    }
    const key = (e) => { if (e.key === 'Escape') done(null); };
    back.onclick = (e) => { if (e.target === back) done(null); };
    document.addEventListener('keydown', key);
    back.append(box);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('in'));
    box.querySelector('.dlgBtn')?.focus();
  });
}
