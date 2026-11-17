// Onboarding: five short screens (about 90 seconds) that set your course.
//   1 Your Ithaca  2 Focus habits  3 About each habit  4 You and your day  5 Your first week
// Opens full screen over the app; "Not now" closes it (it comes back next launch, or from Me).
// Editing later opens it again, filled in with your answers.

import { HABIT_TYPES, BARRIERS, TENDENCIES, MOTIVATIONS, TYPE_OF_GOAL, habitType } from './profile.js';
import { STRATEGIES, applyOnboarding, goalFor, tinyOf } from './strategies.js';
import { el, stepper } from './controls.js';

const EXAMPLES = ['someone who trains four days a week', 'calm and focused at work', 'a non-smoker', 'someone who finishes what they start'];
const BARRIERS_FOR = {
  smoking: ['urges', 'stress', 'tired', 'forget', 'motivation'],
  eating: ['urges', 'stress', 'time', 'tired', 'forget'],
  procrastination: ['start', 'distracted', 'boring', 'tired', 'motivation'],
  default: ['time', 'tired', 'forget', 'motivation', 'start', 'stress'],
};
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function openOnboarding({ state, todayKey, weekKey, onDone, onClose }) {
  // answers, pre-filled from an earlier onboarding or from the habits already planned
  const prev = state.profile;
  const planned = (state.weeks?.[weekKey]?.goals || []).map((g) => TYPE_OF_GOAL[g.id]).filter(Boolean);
  const A = {
    identity: prev?.identity || '',
    picks: prev?.habits?.length
      ? prev.habits.map((h) => ({ type: h.type, baseline: h.baseline, barriers: [...(h.barriers || [])], count: undefined, name: h.type === 'custom' ? state.weeks?.[weekKey]?.goals.find((g) => g.id === h.goalId)?.name : undefined }))
      : [...new Set(planned)].slice(0, 3).map((type) => ({ type, baseline: null, barriers: [] })),
    tendency: prev?.tendency || null,
    motivation: prev?.motivation || null,
    wakeTime: prev?.wakeTime || '07:00',
  };
  let step = 0;
  const STEPS = ['ithaca', 'habits', 'about', 'you', 'week'];

  const root = el('div', { className: 'onb', role: 'dialog', ariaLabel: 'Set your course' });
  const head = el('div', { className: 'onbHead' });
  const body = el('div', { className: 'onbBody' });
  const foot = el('div', { className: 'onbFoot' });
  root.append(head, body, foot);
  document.body.append(root);
  document.body.classList.add('onboarding');
  requestAnimationFrame(() => root.classList.add('in'));

  const close = (done) => {
    root.classList.remove('in');
    document.body.classList.remove('onboarding');
    setTimeout(() => root.remove(), 250);
    if (!done) onClose?.();
  };

  const chip = (label, on, onClick, cls = '') => {
    const b = el('button', { type: 'button', className: `onbChip ${on ? 'on' : ''} ${cls}`, textContent: label });
    b.onclick = onClick;
    return b;
  };
  const primary = (label, ok, go) => {
    const b = el('button', { type: 'button', className: 'primary onbGo', textContent: label, disabled: !ok });
    b.onclick = go;
    return b;
  };
  const next = () => { step = Math.min(STEPS.length - 1, step + 1); draw(); };

  let shownStep = -1;
  function draw() {
    const keep = shownStep === step ? body.scrollTop : 0; // answering on the same screen keeps your place
    shownStep = step;
    head.innerHTML = '';
    body.innerHTML = '';
    foot.innerHTML = '';
    const back = el('button', { type: 'button', className: 'onbBack', textContent: step ? '‹ Back' : '' });
    back.disabled = !step;
    back.onclick = () => { step = Math.max(0, step - 1); draw(); };
    const dots = el('div', { className: 'onbDots' });
    STEPS.forEach((_, i) => dots.append(el('i', { className: i === step ? 'on' : i < step ? 'done' : '' })));
    const later = el('button', { type: 'button', className: 'onbLater', textContent: prev?.onboardedAt ? 'Close' : 'Not now' });
    later.onclick = () => close(false);
    head.append(back, dots, later);
    ({ ithaca, habits, about, you, week })[STEPS[step]]();
    body.scrollTop = keep;
  }

  // 1 · Your Ithaca
  function ithaca() {
    body.append(
      el('div', { className: 'onbSail', textContent: '⛵' }),
      el('h1', { textContent: prev?.onboardedAt ? 'Your course' : 'Every day, a step toward Ithaca' }),
      el('p', { className: 'onbLead', textContent: 'Odyssey helps you build the habits you keep meaning to, a small step at a time. First: where are you sailing?' }),
      el('label', { className: 'onbQ', textContent: 'Who do you want to become?' }),
    );
    const input = el('textarea', { className: 'onbText', rows: 2, maxLength: 140, placeholder: 'Someone who…', value: A.identity });
    input.oninput = () => { A.identity = input.value; };
    const ex = el('div', { className: 'onbChips' });
    for (const e of EXAMPLES) ex.append(chip(e, false, () => { A.identity = e; input.value = e; }, 'quiet'));
    body.append(input, ex);
    foot.append(primary('Continue', true, next), skip());
  }

  // 2 · Focus habits (up to three)
  function habits() {
    body.append(el('h1', { textContent: 'What do you want to work on?' }), el('p', { className: 'onbLead', textContent: 'Pick up to three. Fewer is better: you can add more later.' }));
    const grid = el('div', { className: 'onbGrid' });
    for (const t of HABIT_TYPES) {
      const on = A.picks.some((p) => p.type === t.id);
      const b = el('button', { type: 'button', className: `onbHabit ${on ? 'on' : ''}` }, el('span', { className: 'ohIcon', textContent: t.icon }), el('span', { textContent: t.label }));
      b.onclick = () => {
        if (on) A.picks = A.picks.filter((p) => p.type !== t.id);
        else if (A.picks.length < 3) A.picks.push({ type: t.id, baseline: null, barriers: [] });
        draw();
      };
      b.disabled = !on && A.picks.length >= 3;
      grid.append(b);
    }
    body.append(grid);
    const custom = A.picks.find((p) => p.type === 'custom');
    if (custom) {
      const name = el('input', { type: 'text', className: 'onbInput', maxLength: 40, placeholder: 'Name it, e.g. Journaling', value: custom.name || '' });
      name.oninput = () => { custom.name = name.value; goBtn.disabled = !ready(); };
      body.append(el('label', { className: 'onbQ', textContent: 'Your own habit' }), name);
    }
    const ready = () => A.picks.length > 0 && (!custom || (custom.name || '').trim());
    const goBtn = primary('Continue', ready(), next);
    foot.append(goBtn);
  }

  // 3 · About each habit: where you are, what stops you
  function about() {
    body.append(el('h1', { textContent: 'Where you are now' }), el('p', { className: 'onbLead', textContent: 'Two taps per habit. This sets an easy start.' }));
    for (const p of A.picks) {
      const s = STRATEGIES[p.type] || STRATEGIES.custom;
      const t = habitType(p.type);
      const card = el('section', { className: 'onbCard' });
      card.append(el('div', { className: 'onbCardHead', textContent: `${t.icon}  ${p.type === 'custom' ? (p.name || t.label) : t.label}` }), el('label', { className: 'onbQ', textContent: s.question }));
      const opts = el('div', { className: 'onbChips' });
      for (const [id, label] of s.options) opts.append(chip(label, p.baseline === id, () => { p.baseline = id; draw(); }));
      card.append(opts);
      if (s.count) {
        if (p.count == null) p.count = s.count.default;
        card.append(el('label', { className: 'onbQ', textContent: s.count.label }), stepper({ value: p.count, step: 1, min: 0, max: 80, unit: 'a day', onChange: (v) => { p.count = v ?? 0; } }));
      }
      card.append(el('label', { className: 'onbQ', textContent: 'What usually stops you?' }));
      const bs = el('div', { className: 'onbChips' });
      for (const id of BARRIERS_FOR[p.type] || BARRIERS_FOR.default) {
        const b = BARRIERS.find((x) => x.id === id);
        bs.append(chip(b.label, p.barriers.includes(id), () => { p.barriers = p.barriers.includes(id) ? p.barriers.filter((x) => x !== id) : [...p.barriers, id]; draw(); }));
      }
      card.append(bs);
      if (p.type === 'smoking') card.append(el('p', { className: 'onbNote', textContent: 'Odyssey supports you alongside, not instead of, real help: a doctor or a quit line can double your chances.' }));
      body.append(card);
    }
    foot.append(primary('Continue', true, next), skip());
  }

  // 4 · You and your day
  function you() {
    body.append(el('h1', { textContent: 'You and your day' }), el('p', { className: 'onbLead', textContent: 'Three quick ones, so Odyssey speaks your language.' }));
    body.append(el('label', { className: 'onbQ', textContent: 'A friend asks you to commit to something you don’t feel like doing. You…' }));
    const tg = el('div', { className: 'onbList' });
    for (const t of TENDENCIES) tg.append(chip(t.label, A.tendency === t.id, () => { A.tendency = t.id; draw(); }, 'wide'));
    body.append(tg, el('label', { className: 'onbQ', textContent: 'What keeps you going?' }));
    const mg = el('div', { className: 'onbChips' });
    for (const m of MOTIVATIONS) mg.append(chip(m.label, A.motivation === m.id, () => { A.motivation = m.id; draw(); }));
    const wake = el('input', { type: 'time', className: 'onbInput onbTime', value: A.wakeTime });
    wake.onchange = () => { A.wakeTime = wake.value || '07:00'; };
    body.append(mg, el('label', { className: 'onbQ', textContent: 'When do you usually wake up?' }), wake);
    foot.append(primary('Continue', true, next), skip());
  }

  // 5 · Your first week
  function week() {
    body.append(el('h1', { textContent: 'Your first week' }), el('p', { className: 'onbLead', textContent: 'Deliberately easy. It grows once it sticks. You can change any of it in Week, then Plan.' }));
    const have = new Set((state.weeks?.[weekKey]?.goals || []).map((g) => g.id));
    for (const p of A.picks) {
      const g = goalFor(p.type, { baseline: p.baseline, wake: A.wakeTime, count: p.count, todayKey, name: p.name });
      const m = g.metrics[0];
      const how = m.kind === 'daysPerWeek' ? `${m.target} days a week${m.days?.length ? ` · ${m.days.map((d) => DOW3[d]).join(' ')}` : ''}`
        : m.kind === 'perDayMax' ? `At most ${m.target} a day${g.quitDay ? ` · quit day ${new Date(`${g.quitDay}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`
          : `${m.target} ${m.unit} a day`;
      body.append(el('section', { className: 'onbCard plan' },
        el('div', { className: 'onbCardHead', textContent: `${g.icon}  ${g.name}` }),
        el('div', { className: 'onbPlanLine', textContent: have.has(g.id) ? 'Already in your plan: your targets stay' : how }),
        el('div', { className: 'onbPlanTiny', textContent: tinyOf(g) }),
        g.intention ? el('div', { className: 'onbPlanTiny', textContent: `When: ${g.intention}${g.cueTime ? ` (${g.cueTime})` : ''}` }) : null));
    }
    if (A.identity.trim()) body.append(el('p', { className: 'onbVow', textContent: `Every one of these is a vote for ${A.identity.trim().replace(/^(i am|i'm|to be)\s+/i, '')}.` }));
    foot.append(primary(prev?.onboardedAt ? 'Save' : 'I’ll take my first step today', A.picks.length > 0, () => {
      const result = applyOnboarding(state, A, todayKey, weekKey);
      close(true);
      onDone(result);
    }));
  }

  function skip() {
    const b = el('button', { type: 'button', className: 'onbSkip', textContent: 'Skip' });
    b.onclick = next;
    return b;
  }

  draw();
  return { close: () => close(false) };
}
