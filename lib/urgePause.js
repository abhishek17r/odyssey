// The urge pause (urge surfing): a guided minute when a craving hits. Breathe with the circle, notice the
// urge rise, peak and pass, then say how it went. Nothing is judged; riding one out earns Kleos.

import { el } from './controls.js';

const STEPS = [
  [0, 'Notice the urge. Where do you feel it?'],
  [12, 'Breathe in as the circle grows, out as it shrinks.'],
  [28, 'Urges rise, peak and pass, like a wave.'],
  [44, 'You don’t have to act on it. Just watch it.'],
];
const LENGTH = 60;

export function openUrgePause({ goal, onDone }) {
  const root = el('div', { className: 'urge', role: 'dialog', ariaLabel: 'Pause the urge' });
  const text = el('p', { className: 'urgeText', textContent: STEPS[0][1] });
  const count = el('div', { className: 'urgeCount', textContent: String(LENGTH) });
  const circle = el('div', { className: 'urgeCircle' }, count);
  const rode = el('button', { type: 'button', className: 'primary', textContent: 'I rode it out' });
  const gave = el('button', { type: 'button', className: 'urgeGave', textContent: 'I gave in' });
  const close = el('button', { type: 'button', className: 'urgeClose', textContent: 'Close', ariaLabel: 'Close' });
  const btns = el('div', { className: 'urgeBtns' }, rode, gave);
  root.append(close, el('div', { className: 'urgeTitle', textContent: `Pause the urge · ${goal.name}` }), circle, text, btns);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('in'));

  const start = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    count.textContent = String(Math.max(0, LENGTH - s));
    const line = [...STEPS].reverse().find(([at]) => s >= at)[1];
    if (text.textContent !== line) text.textContent = line;
    if (s >= LENGTH) {
      clearInterval(tick);
      count.textContent = '✓';
      text.textContent = 'A minute. How did it go?';
      root.classList.add('done');
    }
  }, 250);

  const finish = (outcome) => {
    clearInterval(tick);
    root.classList.remove('in');
    setTimeout(() => root.remove(), 250);
    if (outcome) onDone(outcome);
  };
  rode.onclick = () => finish('resisted');
  gave.onclick = () => finish('gave');
  close.onclick = () => finish(null);
}
