// Reusable input controls: stepper (− value +), check button, emoji scale, side drawer, toast.
// Plain DOM, no framework. Styles live in styles.css (".stepper", ".checkBtn", ".scale", ".drawer", ".toast").

export function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

const fmtNum = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));

// A step that suits the unit: half hours, 5 minutes, whole times / days.
export const stepFor = (unit) => (unit === 'hours' ? 0.5 : unit === 'min' ? 5 : 1);

/**
 * − [value] +   value may be null (not logged). Typing works too.
 * opts: { value, step, min, max, unit, placeholder, disabled, size: 'sm'|'md'|'lg', onChange(v) }
 */
export function stepper({ value = null, step = 1, min = 0, max = Infinity, unit = '', placeholder = '–', disabled = false, size = 'md', onChange = () => {} }) {
  let v = value;
  const input = el('input', { type: 'text', inputMode: 'decimal', value: fmtNum(v), placeholder, disabled, ariaLabel: unit || 'value' });
  const minus = el('button', { type: 'button', className: 'stepBtn', textContent: '−', disabled, title: `−${step}` });
  const plus = el('button', { type: 'button', className: 'stepBtn', textContent: '+', disabled, title: `+${step}` });
  const box = el('div', { className: `stepper ${size}` }, minus, el('div', { className: 'stepVal' }, input, unit ? el('span', { className: 'stepUnit', textContent: unit }) : null), plus);
  const set = (nv, fire = true) => {
    v = nv == null ? null : Math.min(max, Math.max(min, Math.round(nv * 100) / 100));
    input.value = fmtNum(v);
    minus.disabled = disabled || v == null ? disabled : v <= min;
    box.classList.toggle('empty', v == null);
    box.classList.remove('bump');
    void box.offsetWidth; // restart the little bump animation
    box.classList.add('bump');
    if (fire) onChange(v);
  };
  minus.onclick = () => set(v == null ? min : v - step);
  plus.onclick = () => set(v == null ? (min > 0 ? min : step) : v + step);
  input.onchange = () => {
    const t = input.value.trim().replace(',', '.');
    set(t === '' ? null : Number.isFinite(Number(t)) ? Number(t) : v);
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); plus.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); minus.click(); }
    if (e.key === 'Enter') input.blur();
  };
  set(v, false);
  box.classList.remove('bump');
  box.setValue = (nv) => set(nv, false);
  box.setDisabled = (d) => { disabled = d; input.disabled = d; plus.disabled = d; minus.disabled = d || v == null || v <= min; };
  return box;
}

// Round check button: state true (done) / false (skipped) / null (open).
export function checkBtn({ state = null, onChange = () => {}, title = 'Mark done' }) {
  const b = el('button', { type: 'button', className: 'checkBtn', title, ariaLabel: title });
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>';
  const draw = (s) => { b.classList.toggle('on', s === true); b.classList.toggle('off', s === false); b.ariaPressed = String(s === true); };
  draw(state);
  b.onclick = () => { state = state === true ? null : true; draw(state); b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 350); onChange(state); };
  b.setState = (s) => { state = s; draw(s); };
  return b;
}

// A row of options to tap, e.g. emoji 1–5. options: [{ value, label, hint }]
export function scale({ options, value = null, onChange = () => {}, className = '' }) {
  const box = el('div', { className: `scale ${className}` });
  const draw = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(value)));
  for (const o of options) {
    const b = el('button', { type: 'button', title: o.hint || '' });
    b.dataset.v = o.value;
    b.innerHTML = `<span class="sEmoji">${o.label}</span>${o.hint ? `<span class="sHint">${o.hint}</span>` : ''}`;
    b.onclick = () => { value = o.value; draw(); onChange(value); };
    box.append(b);
  }
  draw();
  return box;
}

// Side drawer: openDrawer(title, contentEl) → { close }. Esc / backdrop closes.
let current = null;
export function openDrawer(title, content, { onClose } = {}) {
  current?.close(true);
  const back = el('div', { className: 'drawerBack' });
  const closeBtn = el('button', { type: 'button', className: 'ghost drawerX', textContent: '✕', title: 'Close (Esc)' });
  const panel = el('aside', { className: 'drawer', role: 'dialog', ariaLabel: title },
    el('div', { className: 'drawerHead' }, el('h2', { textContent: title }), closeBtn), el('div', { className: 'drawerBody' }, content));
  document.body.append(back, panel);
  requestAnimationFrame(() => { back.classList.add('in'); panel.classList.add('in'); });
  const key = (e) => { if (e.key === 'Escape') close(); };
  function close(instant = false) {
    document.removeEventListener('keydown', key);
    back.classList.remove('in'); panel.classList.remove('in');
    const rm = () => { back.remove(); panel.remove(); };
    instant ? rm() : setTimeout(rm, 220);
    if (current?.panel === panel) current = null;
    onClose?.();
  }
  back.onclick = () => close();
  closeBtn.onclick = () => close();
  document.addEventListener('keydown', key);
  current = { close, panel };
  return current;
}
export const drawerOpen = () => !!current;

// A short message at the bottom of the screen.
let toastTimer = null;
export function toast(text, kind = 'ok') {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { className: 'toast' }); document.body.append(t); }
  t.textContent = text;
  t.className = `toast ${kind} in`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('in'), 1600);
}

// Done: a pop, a green glow and a burst of sparkles from `from` (e.g. the tick). Used by habits and tasks.
import { owlCheer } from './figures.js';
const CHEERS = ['Well done', 'A vote cast', 'Kleos earned', 'Onward', 'That’s the way'];
export function celebrate(card, from = card) {
  owlCheer(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  card.dataset.fx = Date.now();
  card.classList.remove('celebrate'); void card.offsetWidth; card.classList.add('celebrate');
  const r = from.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    const sp = el('span', { className: 'spark', textContent: ['✦', '✧', '•', '★'][i % 4] });
    const a = (Math.PI * 2 * i) / 10;
    sp.style.left = `${r.left - c.left + r.width / 2}px`;
    sp.style.top = `${r.top - c.top + r.height / 2}px`;
    sp.style.setProperty('--dx', `${Math.cos(a) * (30 + (i % 3) * 10)}px`);
    sp.style.setProperty('--dy', `${Math.sin(a) * (30 + (i % 3) * 10)}px`);
    card.append(sp);
    setTimeout(() => sp.remove(), 800);
  }
  navigator.vibrate?.(15);
}

// Skipped / over a limit: a short shake.
export function shake(card) {
  card.dataset.fx = Date.now();
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
}

// An iOS-style on/off switch.
export function toggle({ checked = false, onChange = () => {}, label = '' }) {
  const l = el('label', { className: 'switch' });
  const cb = el('input', { type: 'checkbox', checked, ariaLabel: label });
  cb.onchange = () => onChange(cb.checked);
  l.append(cb, el('span'));
  return l;
}

// Swipe a row left to reveal Delete (iOS style). Tap Delete → onDelete(). A tap elsewhere closes it.
export function swipeToDelete(row, onDelete, label = 'Delete') {
  row.classList.add('swipeRow');
  const btn = el('button', { type: 'button', className: 'swipeDel', textContent: label });
  btn.onclick = (e) => { e.stopPropagation(); onDelete(); };
  row.append(btn);
  let x0 = null, y0 = 0, dx = 0, moved = false;
  const W = 88;
  const set = (v, anim) => { row.style.transition = anim ? 'transform .2s ease' : 'none'; row.style.transform = v ? `translateX(${v}px)` : ''; };
  row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; moved = false; }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!moved && Math.abs(my) > Math.abs(mx)) { x0 = null; return; } // a scroll, not a swipe
    moved = true;
    row.classList.add('swiping');
    dx = Math.min(0, Math.max(-W - 20, mx + (row.classList.contains('open') ? -W : 0)));
    set(dx, false);
  }, { passive: true });
  row.addEventListener('touchend', () => {
    if (x0 == null) return;
    x0 = null;
    const open = dx < -W / 2;
    row.classList.toggle('open', open);
    set(open ? -W : 0, true);
    if (!open) setTimeout(() => row.classList.remove('swiping'), 220);
    setTimeout(() => { moved = false; }, 80); // swallow only the click that ends the swipe
  });
  row.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
    if (row.classList.contains('open') && e.target !== btn) { e.stopPropagation(); row.classList.remove('open'); set(0, true); setTimeout(() => row.classList.remove('swiping'), 220); }
  }, true);
}

// Swipe a row: left reveals action buttons (e.g. Tomorrow · Move · Delete); right, past a threshold, runs onRight
// (e.g. mark done). Rows being dragged to reorder (class 'lifted') don't swipe.
export function swipeActions(row, { actions = [], onRight = null, rightLabel = 'Done' }) {
  row.classList.add('swipeRow');
  const BW = 74;
  const W = BW * actions.length;
  const acts = el('div', { className: 'swipeActs', style: `width:${W}px;right:-${W + 8}px` });
  for (const a of actions) {
    const b = el('button', { type: 'button', className: `swipeAct ${a.cls || ''}`, textContent: a.label });
    b.onclick = (e) => { e.stopPropagation(); close(); a.fn(); };
    acts.append(b);
  }
  row.append(acts);
  const done = onRight ? el('div', { className: 'swipeDone', textContent: `✓ ${rightLabel}`, ariaHidden: 'true' }) : null;
  if (done) row.append(done);
  let x0 = null, y0 = 0, dx = 0, moved = false;
  const set = (v, anim) => { row.style.transition = anim ? 'transform .2s ease' : 'none'; row.style.transform = v ? `translateX(${v}px)` : ''; };
  const close = () => { row.classList.remove('open'); set(0, true); setTimeout(() => row.classList.remove('swiping', 'swipingR'), 220); };
  row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; moved = false; }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    if (x0 == null || row.classList.contains('lifted')) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!moved && Math.abs(my) > Math.abs(mx)) { x0 = null; return; } // a scroll, not a swipe
    if (!moved && Math.abs(mx) < 6) return;
    moved = true;
    const base = row.classList.contains('open') ? -W : 0;
    dx = Math.min(onRight && !base ? 120 : 0, Math.max(-W - 20, mx + base));
    row.classList.toggle('swiping', dx < 0);
    row.classList.toggle('swipingR', dx > 0);
    if (done) done.classList.toggle('ready', dx > 80);
    set(dx, false);
  }, { passive: true });
  row.addEventListener('touchend', () => {
    if (x0 == null) return;
    x0 = null;
    if (!moved) return;
    if (onRight && dx > 80) { set(0, true); setTimeout(() => row.classList.remove('swipingR'), 220); onRight(); }
    else {
      const open = dx < -W / 2;
      row.classList.toggle('open', open);
      set(open ? -W : 0, true);
      if (!open) setTimeout(() => row.classList.remove('swiping', 'swipingR'), 220);
    }
    setTimeout(() => { moved = false; }, 80); // swallow only the click that ends the swipe
  });
  row.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; return; }
    if (row.classList.contains('open') && !acts.contains(e.target)) { e.stopPropagation(); close(); }
  }, true);
}

// Hold a row (about half a second) to pick it up, then drag it up or down; onDrop(ids in the new order).
// rowSel: which children of `list` move. Works by touch; a quick swipe or scroll never starts it.
export function dragReorder(list, rowSel, onDrop) {
  let timer = null, row = null, y0 = 0, x0 = 0, base = 0, lifted = false;
  const rows = () => [...list.querySelectorAll(`:scope > ${rowSel}`)];
  const end = () => {
    clearTimeout(timer);
    timer = null;
    if (!lifted) { row = null; return; }
    lifted = false;
    row.classList.remove('lifted');
    row.style.transform = '';
    row.style.transition = '';
    document.body.classList.remove('reordering');
    const ids = rows().map((r) => r.dataset.id);
    row = null;
    onDrop(ids);
  };
  list.addEventListener('touchstart', (e) => {
    const r = e.target.closest(rowSel);
    if (!r || r.parentElement !== list || e.target.closest('button, input, textarea, a')) return;
    row = r; y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; base = y0;
    timer = setTimeout(() => {
      if (!row) return;
      lifted = true;
      row.classList.add('lifted');
      row.style.transition = 'none';
      document.body.classList.add('reordering');
      navigator.vibrate?.(15);
    }, 450);
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!row) return;
    const y = e.touches[0].clientY, x = e.touches[0].clientX;
    if (!lifted) { if (Math.abs(y - y0) > 8 || Math.abs(x - x0) > 8) { clearTimeout(timer); row = null; } return; }
    e.preventDefault(); // hold the page still while dragging
    let dy = y - base;
    const prev = row.previousElementSibling, next = row.nextElementSibling;
    if (dy < 0 && prev?.matches(rowSel) && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { list.insertBefore(row, prev); base -= prev.offsetHeight; dy = y - base; }
    else if (dy > 0 && next?.matches(rowSel) && y > next.getBoundingClientRect().top + next.offsetHeight / 2) { list.insertBefore(next, row); base += next.offsetHeight; dy = y - base; }
    row.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  list.addEventListener('touchend', end);
  list.addEventListener('touchcancel', end);
}

// A toast with an Undo button (a few seconds to change your mind).
export function undoToast(text, onUndo) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { className: 'toast ok in undoToast' }, el('span', { textContent: text }));
  const b = el('button', { type: 'button', textContent: 'Undo' });
  b.onclick = async () => { t.remove(); await onUndo(); };
  t.append(b);
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}
