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
