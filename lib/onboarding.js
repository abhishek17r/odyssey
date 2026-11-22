// Onboarding, the first run (1.11, the simplification plan): four short screens, about a minute.
//   1 Welcome (first time only)  2 Your Ithaca  3 Up to three habits, where you are, what stops you  4 Your first day
// The four-tendencies question is gone (unvalidated; barriers already pick the tactics).
// Opens full screen over the app; "Not now" closes it (it comes back next launch, or from Me).
// Editing later opens it again, filled in with your answers.

import { HABIT_TYPES, BARRIERS, TYPE_OF_GOAL, habitType } from './profile.js';
import { STRATEGIES, applyOnboarding, goalFor, tinyOf } from './strategies.js';
import { el, stepper } from './controls.js';
import { athena, galley } from './figures.js';

const EXAMPLES = ['someone who trains four days a week', 'calm and focused at work', 'a non-smoker', 'someone who finishes what they start'];
const BARRIERS_FOR = {
  smoking: ['urges', 'stress', 'tired', 'forget', 'motivation'],
  eating: ['urges', 'stress', 'time', 'tired', 'forget'],
  procrastination: ['start', 'distracted', 'boring', 'tired', 'motivation'],
  default: ['time', 'tired', 'forget', 'motivation', 'start', 'stress'],
};
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function openOnboarding({ state, todayKey, weekKey, onDone, onClose, light = false }) {
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
  // Light (the A/B's B side): three decisions, one habit; Athena asks for your Ithaca on day 3 and learns what stops you
  const MAX = light ? 1 : 3;
  const STEPS = prev?.onboardedAt ? ['ithaca', 'habits', 'week'] : light ? ['welcome', 'habits', 'week'] : ['welcome', 'ithaca', 'habits', 'week'];

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
    ({ welcome, ithaca, habits, week })[STEPS[step]]();
    body.scrollTop = keep;
  }

  // 1 · Welcome: what Odyssey is, before anything is asked
  function welcome() {
    body.append(
      el('div', { className: 'onbCast', innerHTML: `${galley(80)}${athena(60)}` }),
      el('h1', { textContent: 'Become who you set out to be, one day at a time.' }),
      el('p', { className: 'onbLead', textContent: 'Odyssey keeps your habits, tasks and focus in one place. Athena, your coach, adjusts your plan when life gets in the way, always with your OK. Every day you keep, your ship sails a little closer to Ithaca.' }),
      el('p', { className: 'onbNote', textContent: 'You decide. Athena helps.' }),
    );
    foot.append(primary('Begin', true, next));
  }

  // 2 · Your Ithaca
  function ithaca() {
    body.append(
      el('div', { className: 'onbCast', innerHTML: `${galley(72)}${athena(56)}` }),
      el('h1', { textContent: prev?.onboardedAt ? 'Your course' : 'Who do you want to be?' }),
      el('p', { className: 'onbLead', textContent: 'Not a goal for this week: the person at the end of the voyage. This is your Ithaca; Athena keeps it in mind.' }),
    );
    const input = el('textarea', { className: 'onbText', rows: 2, maxLength: 140, placeholder: 'Someone who…', value: A.identity });
    input.oninput = () => { A.identity = input.value; };
    const ex = el('div', { className: 'onbChips' });
    for (const e of EXAMPLES) ex.append(chip(e, false, () => { A.identity = e; input.value = e; }, 'quiet'));
    body.append(input, ex);
    foot.append(primary('Continue', true, next), skip());
  }

  // 3 · Up to three habits: pick, then where you are and what stops you, on the same screen
  function habits() {
    body.append(el('h1', { textContent: light ? 'Pick your first habit' : 'Where do you start?' }), el('p', { className: 'onbLead', textContent: light ? 'One is plenty to start. Then one tap: where you are today. You can add more any time.' : 'Pick up to three; fewer is better. For each, two taps: where you are today, and what usually stops you.' }));
    const grid = el('div', { className: 'onbGrid' });
    for (const t of HABIT_TYPES) {
      const on = A.picks.some((p) => p.type === t.id);
      const b = el('button', { type: 'button', className: `onbHabit ${on ? 'on' : ''}` }, el('span', { className: 'ohIcon', textContent: t.icon }), el('span', { textContent: t.label }));
      b.onclick = () => {
        if (on) A.picks = A.picks.filter((p) => p.type !== t.id);
        else if (A.picks.length < MAX) A.picks.push({ type: t.id, baseline: null, barriers: [] });
        else if (MAX === 1) A.picks = [{ type: t.id, baseline: null, barriers: [] }];
        draw();
      };
      b.disabled = MAX > 1 && !on && A.picks.length >= MAX;
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
      if (!light) card.append(el('label', { className: 'onbQ', textContent: 'What usually stops you?' }));
      const bs = el('div', { className: 'onbChips' });
      for (const id of BARRIERS_FOR[p.type] || BARRIERS_FOR.default) {
        const b = BARRIERS.find((x) => x.id === id);
        bs.append(chip(b.label, p.barriers.includes(id), () => { p.barriers = p.barriers.includes(id) ? p.barriers.filter((x) => x !== id) : [...p.barriers, id]; draw(); }));
      }
      if (!light) card.append(bs);
      if (p.type === 'smoking') card.append(el('p', { className: 'onbNote', textContent: 'Odyssey supports you alongside, not instead of, real help: a doctor or a quit line can double your chances.' }));
      body.append(card);
    }
  }

  // 4 · Your first day: the easy start, when you wake, the reminders, and Athena's hello
  function week() {
    body.append(el('h1', { textContent: 'Your first day' }), el('p', { className: 'onbLead', textContent: 'Deliberately easy. It grows once it sticks, and you can change any of it later in Plan.' }));
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
    const wake = el('input', { type: 'time', className: 'onbInput onbTime', value: A.wakeTime });
    wake.onchange = () => { A.wakeTime = wake.value || '07:00'; };
    body.append(el('label', { className: 'onbQ', textContent: 'When do you usually wake up?' }), wake,
      el('p', { className: 'onbNote', textContent: 'Reminders: at most 3 a day (a morning plan, a habit at its time, an evening check-in), each with its own switch in Me → Notifications.' }));
    if (A.identity.trim()) body.append(el('p', { className: 'onbVow', textContent: `Every one of these is a vote for ${A.identity.trim().replace(/^(i am|i'm|to be)\s+/i, '')}.` }));
    if (!prev?.onboardedAt) body.append(el('div', { className: 'onbHello', innerHTML: `${athena(36)}<p><b>Athena</b>Welcome aboard. Log the first one when it’s done; I’ll check in tonight.</p>` }));
    foot.append(primary(prev?.onboardedAt ? 'Save' : 'Start my voyage', A.picks.length > 0, () => {
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
