// Habit playbooks: a coach per kind of habit. Pure functions, no chrome.* calls, so it can be tested in Node.
//
// Every habit has a TYPE, which sets how it is counted and coached:
//   build — do it more: a weekly target (days a week) or a daily / weekly amount, counted up
//   cut   — do it less: a daily limit that can step down over time; a slip never resets anything
//   rule  — keep a rule: yes or no each day, one rule at a time, always gentle
// Some habits have a named PLAYBOOK on top (Gym, Focus, Smoking, Scrolling, Diet). Anything else gets the
// default playbook of its type, with the same sections.
//
// What a playbook adds to a goal in the week's plan (copied week to week with the plan):
//   playbook: 'gym' | 'focus' | 'smoking' | 'scrolling' | 'diet' | 'build' | 'cut' | 'rule'
//   why: 'Strong enough to carry my kids at 60'   tiny: smallest version that counts   tone: 'gentle' | 'direct'
//   ifthen: [{ when, then }]
//   smoking: { start, pace (weeks per step, 0 = hold), price (₹ each), since (dayKey the plan started) }
//   ladder: [{ rule, from (dayKey), to (dayKey | null) }]   (diet / rule: the rule ladder; the last has no `to`)
//   baseline: usual amount a day when it was added (cut habits)
// Per day: days[d].log[goalId] = [{ at (ms), n, tag? }] (cut habits: each one logged, and what set it off)
//          days[d].pb[goalId] = { part, feel } (gym: the session)

import {
  PRESETS, weekKeyOf, weekDays, dateKey, parseKey, addDays, metricKey, planOf, isPaused, round1,
} from './score.js';

const val = (state, k, key) => state.days?.[k]?.values?.[key];
const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dow = (k) => DOW[parseKey(k).getDay()];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// ---------- types and playbooks ----------

export const TYPES = {
  build: { id: 'build', label: 'Build up', icon: '↑', what: 'Do it more: a target per week, counted up.',
    gets: ['A weekly target, so one off day doesn’t break it', 'A smallest version that still counts', 'Your run, “at this pace”, never miss twice'] },
  cut: { id: 'cut', label: 'Cut down', icon: '↓', what: 'Do it less: a limit that steps down over time.',
    gets: ['A daily limit, lowered at a pace you set', 'A pause for urges, and what set each one off', 'Slips are logged; nothing resets'] },
  rule: { id: 'rule', label: 'Keep a rule', icon: '✓', what: 'A yes or no each day, one rule at a time.',
    gets: ['A rule ladder: the next opens when this one sticks', 'Gentle always: no loss warnings'] },
};

const SHARED = {
  build: [
    ['Count the week, not the day', 'A target per week, so one off day doesn’t break anything.'],
    ['The smallest version counts', 'On a bad day the tiny version is a win. It keeps the habit alive.'],
    ['Never miss twice', 'One miss gets a plan for tomorrow, not a lecture. Two in a row is the one to avoid.'],
    ['Tie it to something you already do', '“After I …, I …” is easier to keep than a time alone.'],
  ],
  cut: [
    ['Step down, not all at once', 'Lower the limit a little at a time. Your body and routine adjust.'],
    ['Know your moments', 'Tag what set it off. A plan for those moments beats willpower.'],
    ['Ride the wave', 'Urges peak and pass in minutes. The pause gets you through one.'],
    ['Slips are data', 'A slip never resets the plan. Being honest in the log is the habit.'],
  ],
  rule: [
    ['One rule at a time', 'A single clear rule beats a big plan. Add the next only when this one is easy.'],
    ['Kept or not, nothing more', 'No points, no scores to chase. Just whether you kept it.'],
    ['Plan for the hard days', 'Weekends, travel and parties can have their own gentler version.'],
  ],
};

export const HABIT_PLAYBOOKS = {
  gym: {
    id: 'gym', type: 'build', name: 'Gym', icon: '🏋️', line: 'Sessions a week. Rest days never break the run.',
    rules: [
      ['Count the week, not the day', 'Rest days are part of training. Only the weekly target counts.'],
      ['The 20-minute rule', 'A short session still counts. Showing up matters more than the workout.'],
      ['Never miss twice', 'One miss gets a plan for tomorrow, not a lecture.'],
      ['Little by little', 'Tap “heavier” when you add weight or reps. Most weeks should have one.'],
      ['An easy week every sixth', 'A planned light week protects joints and motivation. It keeps the run.'],
    ],
    ifthen: [['it’s time to go', 'my bag is already packed'], ['I’m too tired', 'I go for 20 minutes, then decide'], ['the gym is closed', '25 minutes at home: push-ups, squats, plank']],
    parts: ['Legs', 'Upper', 'Cardio', 'Mobility'],
    feels: [['up', 'Heavier than last time'], ['same', 'Same'], ['easy', 'Easier day']],
    now: [['You log it', 'One tap here or on Today, with what you trained and how it felt.']],
    later: [['Apple Health workouts', 'A workout on your watch ticks this by itself.'], ['Health Connect (Android)', 'The same, from Google Fit, Samsung Health and others.'], ['Lock-screen widget', 'Log a session without opening the app.']],
  },
  focus: {
    id: 'focus', type: 'build', name: 'Focus', icon: '🧠', line: 'Deep-work hours, protected and counted.',
    rules: [
      ['One block, one task', 'Name what you’ll work on before you start. Switching ends the block.'],
      ['Guard your best hours', 'Put the hardest work where your focus lasts longest.'],
      ['Log what broke it', 'Phone, people, tired or stuck. Athena spots the pattern.'],
      ['Rest is part of it', 'A short break after each block. Four hours is a full day of deep work.'],
    ],
    ifthen: [['a block starts', 'my phone goes in a drawer'], ['I get stuck', 'I write the next tiny step and keep going 5 minutes'], ['someone interrupts', 'I ask “can it wait 20 minutes?”']],
    now: [['Focus timer', 'Every session you run here counts by itself.']],
    later: [['Calendar blocks', 'Your protected hours go on your calendar so others see them.'], ['iPhone Focus mode', 'Starting a block silences notifications.'], ['Lock-screen timer', 'The block counts down on your lock screen.']],
  },
  smoking: {
    id: 'smoking', type: 'cut', name: 'Smoking', icon: '🚭', line: 'Step down each week. See money and health come back.',
    rules: [
      ['Step down, not cold turkey', 'One less a day each step. Your body adjusts and cravings shrink with it.'],
      ['Know your moments', 'Tag what set it off. Plans beat willpower in moments you can see coming.'],
      ['Ride the wave', 'Cravings peak and pass in a few minutes. The pause gets you through one.'],
      ['Slips are data', 'A slip never resets the plan. Being honest in the log is the habit.'],
    ],
    ifthen: [['I finish my chai', 'I walk for 3 minutes first'], ['a stressful call ends', 'cold water and 10 breaths'], ['friends light up', 'I hold something else: gum, a pen']],
    tags: ['After chai', 'Stress', 'After a meal', 'With friends', 'Bored'],
    // WHO, “Tobacco: health benefits of smoking cessation”
    timeline: [[0, '20 min', 'Heart rate and blood pressure drop'], [1, '12 h', 'Carbon monoxide in your blood back to normal'], [14, '2–12 weeks', 'Circulation and lung function improve'],
      [30, '1–9 months', 'Less coughing and breathlessness'], [365, '1 year', 'Heart disease risk about half a smoker’s']],
    help: 'Want more help? A doctor can talk you through nicotine replacement, which makes quitting much more likely to stick. India’s free quitline: 1800-11-2356.',
    now: [['You log it', 'One tap per cigarette, with what set it off.']],
    later: [['Lock-screen and watch button', 'Count one without unlocking.'], ['Apple Health', 'Resting heart rate and walking stamina as you cut down.']],
  },
  scrolling: {
    id: 'scrolling', type: 'cut', name: 'Scrolling', icon: '📱', line: 'A daily limit, a pause before you open, time won back.',
    rules: [
      ['A limit, not a ban', 'Scrolling isn’t bad. Scrolling you didn’t choose is.'],
      ['Pause before, not guilt after', 'A minute’s gap before opening breaks the autopilot.'],
      ['Swap, don’t just stop', 'Every pause offers one thing to do instead.'],
      ['Fix the worst hour first', 'Usually late at night. One rule there beats a lower limit.'],
    ],
    ifthen: [['it’s 10:30 pm', 'my phone charges outside the bedroom'], ['I open an app out of habit', 'I take the one-minute pause first']],
    swaps: ['Read 5 pages', 'Walk 5 minutes', 'Text a friend', 'Stretch'],
    now: [['You log it', 'Minutes, in a tap or two, here or on Today.'], ['iPhone Shortcut (works today)', 'An automation on “app is opened” can bring up the pause. Screen Time minutes stay private to iOS.']],
    later: [['Screen Time limits (iPhone)', 'Odyssey sets the limit and is told when you pass it. iOS still never shares the minutes.'], ['App shield', 'A pause screen in front of chosen apps, built in. Needs Apple’s approval.'], ['Usage time (Android)', 'Minutes per app, with your permission.']],
  },
  diet: {
    id: 'diet', type: 'rule', name: 'Diet', icon: '🥗', line: 'One food rule at a time. No calorie counting.', gentle: true,
    rules: [
      ['One rule at a time', 'A single clear rule beats a diet. Add the next only when this one is easy.'],
      ['Kept or not, nothing more', 'No calories, no points, no “cheat days”. Just whether you kept the rule.'],
      ['Plan for the hard days', 'Weekends, travel and parties get their own gentler version.'],
      ['No talk about your body', 'Athena never comments on weight, shape or “burning it off”.'],
    ],
    ifthen: [['I want something sweet at night', 'fruit or a cup of tea'], ['there’s cake at work', 'a small piece at lunch, not later']],
    ladder: ['Water before every meal', 'No sugar after 8 pm', 'Vegetables with lunch', 'Home dinner most nights', 'Protein at every meal'],
    help: 'This playbook never uses loss warnings, streak alarms or calorie numbers. If food feels like a struggle, a doctor or counsellor can help; Tele-MANAS is free on 14416.',
    now: [['You log it', 'One tick a day: kept the rule or not.']],
    later: [['Apple Health weight', 'Only if you ask for it, and only as a 4-week trend.']],
  },
  build: { id: 'build', type: 'build', name: 'Build up', icon: '⭐', line: '', rules: SHARED.build, ifthen: [],
    now: [['You log it', 'One tap here or on Today.']], later: [['Apple Health and widgets', 'Where it fits, logged for you.']] },
  cut: { id: 'cut', type: 'cut', name: 'Cut down', icon: '⭐', line: '', rules: SHARED.cut, ifthen: [], tags: ['Stress', 'Bored', 'Tired', 'With others', 'Habit'],
    now: [['You log it', 'One tap each time, with what set it off.']], later: [['Lock-screen button', 'Count one without unlocking.']] },
  rule: { id: 'rule', type: 'rule', name: 'Keep a rule', icon: '⭐', line: '', rules: SHARED.rule, ifthen: [], gentle: true,
    now: [['You log it', 'One tick a day: kept or not.']], later: [] },
};
export const NAMED = ['gym', 'focus', 'smoking', 'scrolling', 'diet'];

// built-in and onboarding habits → their playbook
const BY_ID = { gym: 'gym', hiit: 'gym', work: 'focus', smoke: 'smoking', scrolling: 'scrolling', eat: 'diet', snacking: 'cut', job: 'build', read: 'build', meditate: 'build', sleep: 'rule' };

export function playbookIdOf(g) {
  if (g?.playbook && HABIT_PLAYBOOKS[g.playbook]) return g.playbook;
  const base = String(g?.id || '').replace(/-\d+$/, '');
  if (BY_ID[base]) return BY_ID[base];
  const kinds = (g?.metrics || []).map((m) => m.kind);
  return kinds[0] === 'perDayMax' ? 'cut' : 'build';
}
export const playbookOf = (g) => HABIT_PLAYBOOKS[playbookIdOf(g)];
export const typeOf = (g) => playbookOf(g).type;
export const isGentle = (g, settings = {}) => !!playbookOf(g).gentle || (g.tone || settings.tone || 'direct') === 'gentle';

// What a name sounds like: a named playbook, or a type. → { playbook, type }
const GUESS = [
  [/\b(gym|lift|weights?|workout|train(ing)?|strength)\b/i, 'gym'],
  [/\b(smok|cigar|beedi|bidi|nicotine)/i, 'smoking'],
  [/\b(scroll|reels?|instagram|insta|tiktok|youtube|social|phone|screen)/i, 'scrolling'],
  [/\b(focus|deep work|study|studying|coding|write|writing)\b/i, 'focus'],
  [/\b(diet|sugar|junk|eat|eating|food|meal|snack)/i, 'diet'],
];
const CUT_WORDS = /\b(less|stop|quit|no more|fewer|cut|vap|alcohol|drink|beer|wine|caffeine|coffee|porn|gaming|games?|nail|swear|chewing|gutkha|pan masala|late night)/i;
const RULE_WORDS = /\b(no |never|always|before|after|by \d|in bed by|wake|bed ?time|lights out)/i;
export function guessType(name) {
  const s = String(name || '');
  if (/^\s*(no|never|always)\b/i.test(s)) return { playbook: null, type: 'rule' };
  for (const [re, pb] of GUESS) if (re.test(s)) return { playbook: pb, type: HABIT_PLAYBOOKS[pb].type };
  if (CUT_WORDS.test(s)) return { playbook: null, type: 'cut' };
  if (RULE_WORDS.test(s)) return { playbook: null, type: 'rule' };
  return { playbook: null, type: 'build' };
}

// ---------- making a habit from setup answers ----------

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'habit';
const preset = (id) => structuredClone(PRESETS.find((p) => p.id === id));

// a = { name?, why, target, tiny, unit, usual, price, pace, rule, block, apps } → a goal for the plan
export function makeHabit(pbId, a, todayKey, takenIds = []) {
  const pb = HABIT_PLAYBOOKS[pbId];
  const why = (a.why || '').trim() || undefined;
  const uniq = (id) => { let x = id, i = 2; while (takenIds.includes(x)) x = `${id}-${i++}`; return x; };
  let g;
  if (pbId === 'gym') {
    g = preset('gym');
    g.metrics[0].target = Number(a.target) || 3;
    g.tiny = a.tiny || '20 minutes counts';
    g.estimateMin = Number(String(g.tiny).match(/\d+/)?.[0]) || 20;
  } else if (pbId === 'focus') {
    g = preset('work');
    g.name = 'Focus';
    g.metrics[0].target = Number(a.target) || 2;
    g.tiny = a.tiny || 'One 25-minute block';
    if (a.block) g.block = a.block;
  } else if (pbId === 'smoking') {
    const usual = Math.max(1, Math.round(Number(a.usual) || 10));
    const pace = a.pace == null ? 1 : Number(a.pace);
    g = { id: 'smoke', name: 'Smoking', icon: '🚭', preset: false, tags: ['health'],
      metrics: [{ id: 'times_dmax', kind: 'perDayMax', unit: 'times', target: pace ? usual - 1 : usual }],
      smoking: { start: usual, pace, price: Number(a.price) || 18, since: todayKey }, tiny: 'Wait 3 minutes before each one', baseline: usual };
  } else if (pbId === 'scrolling') {
    const lim = Number(a.target) || 45;
    g = { id: 'scrolling', name: 'Scrolling', icon: '📱', preset: false, tags: ['health'],
      metrics: [{ id: 'min', kind: 'perDayMax', unit: 'min', target: lim }], baseline: Number(a.usual) || null, apps: a.apps || '', tiny: 'One minute’s pause before opening' };
  } else if (pbId === 'diet') {
    const rule = (a.rule || pb.ladder[1]).trim();
    g = { id: 'eat', name: rule, icon: '🥗', preset: false, tags: ['health'], metrics: [{ id: 'days_w', kind: 'daysPerWeek', unit: 'days', target: Number(a.target) || 5 }],
      rule, ladder: [{ rule, from: todayKey, to: null }], tiny: 'One meal at a time' };
  } else if (pbId === 'cut') {
    const unit = a.unit === 'min' ? 'min' : 'times';
    const usual = Math.max(0, Math.round(Number(a.usual) || (unit === 'min' ? 60 : 5)));
    g = { id: `own-${slug(a.name)}`, name: a.name.trim(), icon: '⭐', preset: false, tags: [],
      metrics: [{ id: unit === 'min' ? 'min' : 'times_dmax', kind: 'perDayMax', unit, target: Number.isFinite(Number(a.target)) && a.target !== '' && a.target != null ? Number(a.target) : Math.max(0, Math.round(usual * 0.8)) }],
      baseline: usual, tiny: 'Wait a few minutes first' };
  } else if (pbId === 'rule') {
    const rule = (a.name || a.rule || 'My rule').trim();
    g = { id: `own-${slug(rule)}`, name: rule, icon: '⭐', preset: false, tags: [], metrics: [{ id: 'days_w', kind: 'daysPerWeek', unit: 'days', target: Number(a.target) || 5 }],
      rule, ladder: [{ rule, from: todayKey, to: null }] };
  } else {
    g = { id: `own-${slug(a.name)}`, name: (a.name || 'My habit').trim(), icon: '⭐', preset: false, tags: [],
      metrics: [{ id: 'days_w', kind: 'daysPerWeek', unit: 'days', target: Number(a.target) || 4 }], tiny: a.tiny || 'Two minutes counts' };
    if (a.when) g.when = a.when;
  }
  const base = g.id;
  g.id = uniq(g.id);
  g.preset = (pbId === 'gym' || pbId === 'focus') && g.id === base;
  g.playbook = pbId;
  if (why) g.why = why;
  g.ifthen = [];
  return g;
}

// ---------- the numbers a playbook talks about ----------

const firstMetric = (g) => g.metrics?.[0];
const weekEnd = (wk) => weekDays(wk)[6];
const goalInWeek = (state, wk, g) => state.weeks?.[wk]?.goals?.find((x) => x.id === g.id) || null;

// Weeks in a row the weekly target was met (days a week / weekly sum), ending last week; this week adds one
// once it's met. Paused weeks are skipped.
export function weekRun(g, state, todayKey) {
  const m = firstMetric(g);
  if (!m || !['daysPerWeek', 'perWeekSum', 'perDayMin'].includes(m.kind)) return { run: 0, thisWeek: false };
  const met = (wk) => {
    const gg = goalInWeek(state, wk, g);
    if (!gg) return null;
    const mm = gg.metrics.find((x) => x.id === m.id) || m;
    const days = weekDays(wk).filter((k) => k <= todayKey);
    const key = metricKey(gg, mm);
    if (days.every((k) => isPaused(state, k))) return 'skip';
    const t = Number(mm.target) || 0;
    if (mm.kind === 'daysPerWeek') return days.filter((k) => val(state, k, key) === true).length >= t;
    if (mm.kind === 'perWeekSum') return sum(days.map((k) => Number(val(state, k, key)) || 0)) >= t;
    // daily minimum: most working days on target (5 of 7)
    return days.filter((k) => Number(val(state, k, key)) >= t).length >= Math.min(5, days.length);
  };
  const cur = weekKeyOf(todayKey);
  let run = 0;
  for (let wk = shift(cur, -7), i = 0; i < 104; wk = shift(wk, -7), i++) {
    const r = met(wk);
    if (r === 'skip') continue;
    if (!r) break;
    run++;
  }
  const thisWeek = met(cur) === true;
  return { run: run + (thisWeek ? 1 : 0), thisWeek };
}

// Days in a row within the limit, before today (logged days only; paused days hold it).
export function underRun(g, state, todayKey) {
  const m = firstMetric(g);
  if (!m) return 0;
  const key = metricKey(g, m);
  let n = 0;
  for (let d = 1; d < 400; d++) {
    const k = shift(todayKey, -d);
    if (isPaused(state, k)) continue;
    const v = val(state, k, key);
    if (v == null || v === '' || Number(v) > limitOn(g, k)) break;
    n++;
  }
  return n;
}

// Days the rule was kept in the last n days (and how many were logged).
export function keptIn(g, state, todayKey, n = 7) {
  const m = firstMetric(g);
  const key = metricKey(g, m);
  const days = Array.from({ length: n }, (_, i) => shift(todayKey, -i - 1));
  return { kept: days.filter((k) => val(state, k, key) === true).length, of: n };
}

// Smoking: the limit for a day, from the step-down plan.
export function limitOn(g, dayKey) {
  const m = firstMetric(g);
  const s = g.smoking;
  if (!s?.pace || !s.since) return Number(m?.target) || 0;
  const weeks = Math.floor((parseKey(dayKey) - parseKey(s.since)) / (7 * 864e5));
  return Math.max(0, s.start - 1 - Math.floor(Math.max(0, weeks) / s.pace));
}
// The day the plan reaches 0.
export function zeroDay(g) {
  const s = g.smoking;
  if (!s?.pace || !s.since) return null;
  return shift(s.since, (s.start - 1) * s.pace * 7);
}
// Money not spent since the plan began (or this month): (start − smoked) × price on each logged day.
export function moneyKept(g, state, todayKey, { month = false } = {}) {
  const s = g.smoking;
  const m = firstMetric(g);
  if (!s?.price || !m) return 0;
  const key = metricKey(g, m);
  const from = month ? todayKey.slice(0, 8) + '01' : s.since;
  let total = 0;
  for (let k = from < s.since ? s.since : from; k <= todayKey; k = shift(k, 1)) {
    const v = val(state, k, key);
    if (v == null || v === '') continue;
    total += Math.max(0, s.start - Number(v)) * s.price;
  }
  return total;
}

// Average a day over logged days in [from, to].
function avgLogged(g, state, from, to) {
  const m = firstMetric(g);
  const key = metricKey(g, m);
  const vs = [];
  for (let k = from; k <= to; k = shift(k, 1)) { const v = val(state, k, key); if (v != null && v !== '') vs.push(Number(v) || 0); }
  return vs.length ? sum(vs) / vs.length : null;
}

// Sessions (days done) in the last n days.
function doneIn(g, state, todayKey, n, offset = 0) {
  const m = firstMetric(g);
  const key = metricKey(g, m);
  return Array.from({ length: n }, (_, i) => shift(todayKey, -i - offset)).filter((k) => val(state, k, key) === true).length;
}
function allDone(g, state) {
  const m = firstMetric(g);
  const key = metricKey(g, m);
  return Object.keys(state.days || {}).filter((k) => state.days[k]?.values?.[key] === true).length;
}
const fmtUnit = (m, x) => (m.unit === 'hours' ? `${round1(x)} h` : m.unit === 'min' ? `${Math.round(x)} min` : `${round1(x)}`);
const toMin = (m, x) => (m.unit === 'hours' ? x * 60 : x);

// "At this pace": where the habit is heading. → text | null
export function atThisPace(g, state, todayKey) {
  const p = paceOf(g, state, todayKey);
  return p ? (p.year ? `${p.html} by next ${p.year}` : p.html) : null;
}
const nameIn = (g) => (/[A-Z]/.test(g.name.slice(1)) ? g.name : g.name.toLowerCase());
// → { html, year? } | null (year: the month name a year from now, for "by next November")
export function paceOf(g, state, todayKey) {
  const pb = playbookIdOf(g);
  const m = firstMetric(g);
  if (!m) return null;
  if (pb === 'smoking') {
    const z = zeroDay(g);
    if (!z || z <= todayKey) return null;
    return { html: `smoke-free by <b>${parseKey(z).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b>` };
  }
  if (m.kind === 'daysPerWeek' && typeOf(g) === 'build') {
    const per4 = doneIn(g, state, todayKey, 28);
    if (per4 < 3) return null;
    const total = allDone(g, state);
    const next = parseKey(todayKey); next.setFullYear(next.getFullYear() + 1);
    const ahead = Math.round(total + (per4 / 4) * 52);
    return { html: `<b>${ahead} ${nameIn(g)} days</b>`, year: next.toLocaleDateString(undefined, { month: 'long' }) };
  }
  if (m.kind === 'perDayMax' && (m.unit === 'min' || m.unit === 'hours')) {
    const base = g.baseline ?? avgLogged(g, state, shift(todayKey, -56), shift(todayKey, -29));
    const now = avgLogged(g, state, shift(todayKey, -28), shift(todayKey, -1));
    if (base == null || now == null || base <= now) return null;
    const h = Math.round((toMin(m, base - now) * 365) / 60);
    return h >= 5 ? { html: `<b>${h} hours</b> back from ${nameIn(g)} in a year` } : null;
  }
  return null;
}

// ---------- stakes: one line for a habit's row today ----------
// → { text, tone: 'gain' | 'risk' | 'calm' } | null. values: today's values as on screen (draft).

export function stakeLine(g, state, todayKey, values = state.days?.[todayKey]?.values || {}, hour = new Date().getHours()) {
  const m = firstMetric(g);
  if (!m || isPaused(state, todayKey)) return null;
  const pbId = playbookIdOf(g);
  const type = typeOf(g);
  const gentle = isGentle(g, state.settings);
  const key = metricKey(g, m);
  const v = values[key];
  const wk = weekKeyOf(todayKey);
  const days = weekDays(wk);
  const t = Number(m.target) || 0;

  if (type === 'rule') {
    const { kept } = keptIn(g, state, todayKey, 7);
    if (v === true) return { text: `Kept today · ${kept + 1} of the last 8 days`, tone: 'gain' };
    return kept ? { text: `Kept ${kept} of the last 7 days`, tone: 'calm' } : null;
  }

  if (m.kind === 'daysPerWeek') {
    const before = days.filter((k) => k < todayKey && val(state, k, key) === true).length;
    const done = before + (v === true ? 1 : 0);
    const need = t - done;
    const after = days.filter((k) => k > todayKey);
    const { run } = weekRun(g, state, todayKey);
    if (need <= 0) return { text: run >= 2 ? `Week’s target reached · ${plural(run, 'week')} in a row` : 'Week’s target reached', tone: 'gain' };
    if (v === true) return { text: `Done today · ${need} more by ${dow(days[6])}`, tone: 'gain' };
    if (v === false) return need <= after.length ? { text: `${need} more by ${dow(days[6])} still keeps the week`, tone: 'calm' } : null;
    const runBit = run >= 2 ? ` and a ${run}-week run` : '';
    if (need > after.length + 1) return { text: `${t} isn’t in reach this week. Every session still counts.`, tone: 'calm' };
    if (need === after.length + 1) {
      return gentle ? { text: `Today keeps the week’s target${runBit} in reach`, tone: 'risk' }
        : { text: `Skip today and the week’s target${runBit} is gone`, tone: 'risk' };
    }
    if (need === after.length) {
      const names = after.map((k) => dow(k).slice(0, 3));
      return gentle ? { text: `Today makes the rest of the week easier`, tone: 'risk' }
        : { text: `Skip today and ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} all` : names[0]} ha${names.length > 1 ? 've' : 's'} to happen`, tone: 'risk' };
    }
    if (run >= 2) return { text: `${plural(run, 'week')} in a row · ${need} more by ${dow(days[6])}`, tone: 'calm' };
    return null;
  }

  if (m.kind === 'perDayMax') {
    const n = Number(v) || 0;
    const lim = limitOn(g, todayKey);
    const run = underRun(g, state, todayKey);
    if (n > lim) return { text: `Over by ${fmtUnit(m, n - lim)} today. Tomorrow starts clean; nothing resets.`, tone: 'calm' };
    const left = lim - n;
    if (run >= 3 && lim > 0 && left <= Math.max(1, lim * 0.25) && v != null) {
      return gentle ? { text: `${fmtUnit(m, left)} left today · ${run} days under your limit`, tone: 'risk' }
        : { text: `${fmtUnit(m, left)} left today. Over it, and a ${run}-day run ends.`, tone: 'risk' };
    }
    if (pbId === 'smoking' && g.smoking?.price) {
      const kept = moneyKept(g, state, todayKey, { month: true });
      if (kept > 0) return { text: `${run >= 2 ? `Day ${run + 1} under your limit · ` : ''}${inr(kept)} kept this month`, tone: 'gain' };
    }
    if (run >= 2) return { text: `${run} days in a row under your limit`, tone: 'gain' };
    return null;
  }

  if (m.kind === 'perDayMin') {
    const n = Number(v) || 0;
    if (n >= t) return { text: 'Done for today', tone: 'gain' };
    const short = t - n;
    const wkDone = sum(days.filter((k) => k < todayKey).map((k) => Number(val(state, k, key)) || 0)) + n;
    const wkGoal = t * 5;
    if (hour < 12 && !n) return null;
    return gentle ? { text: `${fmtUnit(m, short)} to go today · ${fmtUnit(m, wkDone)} this week`, tone: 'calm' }
      : { text: `${fmtUnit(m, short)} short today · the week is at ${fmtUnit(m, wkDone)} of ${fmtUnit(m, wkGoal)}`, tone: 'risk' };
  }

  if (m.kind === 'perWeekSum') {
    const so = sum(days.filter((k) => k < todayKey).map((k) => Number(val(state, k, key)) || 0)) + (Number(v) || 0);
    if (so >= t) return { text: 'Week’s target reached', tone: 'gain' };
    const left = days.filter((k) => k >= todayKey).length;
    return { text: `${fmtUnit(m, t - so)} to go · ${plural(left, 'day')} left`, tone: 'calm' };
  }
  return null;
}

// Gain and risk lines for the playbook page. → [{ tone, label, html }]
export function stakesFor(g, state, todayKey) {
  const out = [];
  const pb = playbookIdOf(g);
  const pace = atThisPace(g, state, todayKey);
  const m = firstMetric(g);
  if (pb === 'smoking' && g.smoking) {
    const s = g.smoking;
    const step = s.price * 30;
    out.push({ tone: 'gain', label: 'Gain', html: `Each step down saves about <b>${inr(step)} a month</b>. At 0, that’s <b>${inr(s.start * s.price * 30)} a month</b>.` });
    const kept = moneyKept(g, state, todayKey);
    if (kept > 0) out.push({ tone: 'gain', label: 'So far', html: `<b>${inr(kept)}</b> not spent since you started.` });
    out.push({ tone: 'calm', label: 'Slip', html: 'A slip is logged, not punished. Nothing resets.' });
  } else if (typeOf(g) === 'rule') {
    const { kept } = keptIn(g, state, todayKey, 21);
    out.push({ tone: 'gain', label: 'So far', html: `Kept on <b>${kept} of the last 21 days</b>.${kept >= 17 ? ' This one is close to automatic.' : ''}` });
  } else {
    if (pace) out.push({ tone: 'gain', label: 'Gain', html: `At this pace, ${pace}.` });
    const line = stakeLine(g, { ...state, settings: { ...state.settings, tone: 'direct' } }, todayKey);
    if (line?.tone === 'risk') out.push({ tone: 'risk', label: 'Risk', html: line.text });
    if (m?.kind === 'daysPerWeek') {
      const total = allDone(g, state);
      if (total) out.push({ tone: 'calm', label: 'So far', html: `<b>${total}</b> ${g.name.toLowerCase()} days logged in all.` });
    }
    if (pb === 'gym') out.push({ tone: 'calm', label: 'Body', html: 'Strength mostly holds for 2–3 weeks off. A missed week costs little; a missed month starts over.' });
    if (m?.kind === 'perDayMax' && !pace) {
      const run = underRun(g, state, todayKey);
      if (run) out.push({ tone: 'gain', label: 'Run', html: `<b>${plural(run, 'day')}</b> in a row under your limit.` });
    }
  }
  return out;
}

// ---------- the morning after a miss ----------
// The first build habit that was planned yesterday and didn't happen (and isn't done today).
// → { g, yesterday, run, need, left } | null
export function missedYesterdayCard(state, todayKey) {
  const y = shift(todayKey, -1);
  if (isPaused(state, y) || isPaused(state, todayKey)) return null;
  for (const g of planOf(y, state)?.goals || []) {
    const m = firstMetric(g);
    if (m?.kind !== 'daysPerWeek' || typeOf(g) !== 'build') continue;
    const key = metricKey(g, m);
    if (val(state, todayKey, key) === true) continue;
    const yv = val(state, y, key);
    const planned = m.days?.length ? m.days.includes(parseKey(y).getDay()) : yv === false;
    if (!planned || yv === true) continue;
    const wk = weekKeyOf(todayKey);
    const done = weekDays(wk).filter((k) => k < todayKey && val(state, k, key) === true).length;
    const left = weekDays(wk).filter((k) => k >= todayKey).length;
    const { run } = weekRun(g, state, todayKey);
    return { g, yesterday: y, run, need: Math.max(0, (Number(m.target) || 0) - done), left };
  }
  return null;
}

// ---------- the last 4 weeks, day by day ----------
// → [{ wk, cells: ['done' | 'miss' | 'rest' | 'over' | 'under' | 'none' | 'today' | 'future'] }]
export function history(g, state, todayKey, weeks = 4) {
  const m = firstMetric(g);
  const key = metricKey(g, m);
  const cur = weekKeyOf(todayKey);
  return Array.from({ length: weeks }, (_, i) => shift(cur, -7 * (weeks - 1 - i))).map((wk) => ({
    wk,
    cells: weekDays(wk).map((k) => {
      if (k > todayKey) return 'future';
      const v = val(state, k, key);
      if (isPaused(state, k)) return 'rest';
      if (m.kind === 'daysPerWeek') {
        if (v === true) return 'done';
        if (k === todayKey) return 'today';
        const planned = m.days?.length ? m.days.includes(parseKey(k).getDay()) : v === false;
        return planned ? 'miss' : 'rest';
      }
      if (v == null || v === '') return k === todayKey ? 'today' : 'none';
      if (m.kind === 'perDayMax') return Number(v) > limitOn(g, k) ? 'over' : 'under';
      return Number(v) >= (Number(m.target) || 0) ? 'done' : 'miss';
    }),
  }));
}

// What set it off, over the last n days. → [{ tag, n, pct }]
export function triggers(g, state, todayKey, n = 28) {
  const counts = {};
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (const e of state.days?.[shift(todayKey, -i)]?.log?.[g.id] || []) {
      if (!e.tag) continue;
      counts[e.tag] = (counts[e.tag] || 0) + (e.n || 1);
      total += e.n || 1;
    }
  }
  return Object.entries(counts).map(([tag, c]) => ({ tag, n: c, pct: Math.round((100 * c) / total) })).sort((a, b) => b.n - a.n);
}
// When it happens, by hour block, over the last n days (from the log). → [{ label, n }]
export const HOUR_SLOTS = [[5, 9, 'Early'], [9, 12, 'Morning'], [12, 15, 'Midday'], [15, 18, 'Afternoon'], [18, 21, 'Evening'], [21, 24, 'Late'], [0, 5, 'Night']];
export function byHour(g, state, todayKey, n = 28) {
  const out = HOUR_SLOTS.map(([a, b, label]) => ({ label, a, b, n: 0 }));
  let any = 0;
  for (let i = 0; i < n; i++) {
    for (const e of state.days?.[shift(todayKey, -i)]?.log?.[g.id] || []) {
      const h = new Date(e.at).getHours();
      const s = out.find((x) => h >= x.a && h < x.b);
      if (s) { s.n += e.n || 1; any++; }
    }
  }
  return any >= 5 ? out : null;
}

// Gym: sessions marked heavier among the last 12. → { up, of }
export function heavier(g, state) {
  const ks = Object.keys(state.days || {}).filter((k) => state.days[k]?.pb?.[g.id]).sort().slice(-12);
  return { up: ks.filter((k) => state.days[k].pb[g.id].feel === 'up').length, of: ks.length, last: ks.length ? state.days[ks.at(-1)].pb[g.id] : null };
}

// Diet / rule ladder: ready for the next rule? (kept 80% of the last 21 days, at least 3 weeks on this one)
export function ladderReady(g, state, todayKey) {
  const cur = (g.ladder || []).at(-1);
  if (!cur || shift(cur.from, 21) > todayKey) return false;
  return keptIn(g, state, todayKey, 21).kept >= 17;
}

// ---------- what Athena says (templates, from your numbers) ----------
export function athenaLines(g, state, todayKey) {
  const pb = playbookIdOf(g);
  const type = typeOf(g);
  const name = g.name;
  const lower = name.toLowerCase();
  const { run } = weekRun(g, state, todayKey);
  const t = Number(firstMetric(g)?.target) || 0;
  const tiny = g.tiny ? `${g.tiny.replace(/\.$/, '')}.` : 'The smallest version counts.';
  if (pb === 'diet' || type === 'rule') return [
    ['Good week', 'Six of seven. This one is getting close to automatic.'],
    ['After a miss', 'Yesterday didn’t go to plan. Today is a fresh one.'],
    ['Never says', pb === 'diet' ? 'Anything about your body, your weight or “burning it off”.' : 'That one miss undoes anything. It doesn’t.'],
  ];
  if (pb === 'smoking') return [
    ['Good day', 'Under your limit again. Every one you don’t smoke is your lungs getting a little back.'],
    ['After a slip', 'More than planned yesterday. It happens. Today’s limit is the same, and you’ve kept it before.'],
    ['Step-down day', 'One less a day from this week. Want to hold where you are one more week instead?'],
  ];
  if (type === 'cut') return [
    ['Good day', `Under your limit. That’s time and attention you chose to keep.`],
    ['Over the limit', `More ${lower} than planned yesterday. What set it off? One plan for that moment helps most.`],
    ['Run at risk', `Close to your limit today. The run is worth keeping.`],
  ];
  if (pb === 'focus') return [
    ['Good day', 'Your hours are in, most of them before lunch. That’s a day the work moved.'],
    ['Short day', 'A short day. Tomorrow, your best hours, phone in a drawer, one long block?'],
    ['Pattern', 'Your blocks keep breaking at the same time of day. Let’s move the hard work earlier.'],
  ];
  return [
    ['Good week', `${t} of ${t}${run >= 2 ? ` again: ${run} weeks in a row` : ''}. Keep this up and it stops being a plan; it’s who you are.`],
    ['After a miss', `Yesterday got away. Today keeps the week alive. ${tiny}`],
    ['Stuck for 2 weeks', `Two quiet weeks. Let’s make the target smaller for a while, then build back.`],
  ];
}

// ---------- tasks: where the cost lands ----------

const leftH = (t, loggedH = () => 0) => Math.max(0, (Number(t.sizeH) || 0) - (loggedH(t.id) || 0));

// One line for a task row. → { text, tone: 'loss' | 'risk' } | null
export function taskStake(t, state, todayKey, loggedH = () => 0) {
  if (t.status === 'done' || !t.due) return null;
  const dueWord = t.due === todayKey ? 'today' : t.due === shift(todayKey, 1) ? 'tomorrow' : dow(t.due).slice(0, 3);
  if (t.loss) return { text: t.due < todayKey ? `Past due: ${t.loss}` : `Miss ${dueWord}: ${t.loss}`, tone: 'loss' };
  if (t.due <= todayKey || t.due > shift(todayKey, 6) || !t.sizeH) return null;
  const sameDay = Object.values(state.tickets || {}).filter((x) => !x.parentId && x.status !== 'done' && x.due === t.due);
  const load = sum(sameDay.map((x) => leftH(x, loggedH)));
  if (load < 1.5) return null;
  return { text: `Not today, and ${dow(t.due)} carries ${hm(load * 60)}`, tone: 'risk' };
}
export const hm = (min) => { const h = Math.floor(min / 60), mm = Math.round(min % 60); return h ? (mm ? `${h} h ${mm} m` : `${h} h`) : `${mm} min`; };

// This week's open hours against what you usually finish. → { open, usual, spill } | null
export function weekLoad(state, todayKey, loggedH = () => 0) {
  const wk = weekKeyOf(todayKey);
  const tops = Object.values(state.tickets || {}).filter((t) => !t.parentId);
  const open = sum(tops.filter((t) => t.sprint === wk && t.status !== 'done').map((t) => leftH(t, loggedH)));
  const doneThis = sum(tops.filter((t) => t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === wk).map((t) => Number(t.sizeH) || 0));
  const weeks = [1, 2, 3, 4].map((i) => shift(wk, -7 * i));
  const done = weeks.map((w) => sum(tops.filter((t) => t.status === 'done' && t.doneAt && weekKeyOf(dateKey(new Date(t.doneAt))) === w).map((t) => Number(t.sizeH) || 0)));
  if (done.filter((x) => x > 0).length < 2) return null;
  const usual = Math.round((sum(done) / 4) * 2) / 2;
  const daysLeft = weekDays(wk).filter((k) => k >= todayKey).length;
  const canStill = Math.max(0, usual - doneThis) * Math.min(1, daysLeft / 7 + 0.15);
  const spill = Math.round(Math.max(0, open - Math.max(canStill, usual - doneThis)) * 2) / 2;
  return { open: round1(open), usual, doneThis: round1(doneThis), spill };
}

// ---------- Trends, in plain words ----------
// → { pace: [html], lines: [{ icon, html, go? }] }
export function trendLines(state, todayKey, { focusMin = null } = {}) {
  const plan = planOf(todayKey, state);
  const lines = [];
  const pace = [];
  const d28 = shift(todayKey, -27), p56 = shift(todayKey, -55), p29 = shift(todayKey, -28);
  for (const g of plan?.goals || []) {
    const m = firstMetric(g);
    if (!m) continue;
    const type = typeOf(g);
    const pb = playbookIdOf(g);
    const key = metricKey(g, m);
    const name = `<b>${esc(g.name)}:</b>`;
    const p = paceOf(g, state, todayKey);
    if (p) pace.push(p);
    if (m.kind === 'daysPerWeek') {
      const now = doneIn(g, state, todayKey, 28);
      const before = doneIn(g, state, todayKey, 28, 28);
      if (type === 'rule') {
        if (!now && !before) continue;
        lines.push({ icon: g.icon, html: `${name} kept on ${now} of the last 28 days${before ? `, ${now > before ? 'up' : now < before ? 'down' : 'the same as'} ${now === before ? 'the 4 weeks before' : `from ${before}`}` : ''}.` });
        continue;
      }
      const t = (Number(m.target) || 0) * 4;
      if (!now && !before) continue;
      const cmp = before ? (now > before ? `, up from ${before} the 4 weeks before` : now < before ? `, down from ${before} the 4 weeks before` : ', the same as the 4 weeks before') : '';
      const { run } = weekRun(g, state, todayKey);
      lines.push({ icon: g.icon, html: `${name} ${now} of ${t} in the last 4 weeks${cmp}.${run >= 3 ? ` ${run} weeks in a row on target.` : ''}` });
    } else if (m.kind === 'perDayMax') {
      const now = avgLogged(g, state, d28, todayKey);
      if (now == null) continue;
      const before = g.baseline ?? avgLogged(g, state, p56, p29);
      let tail = '';
      if (pb === 'smoking' && g.smoking?.price) { const k = moneyKept(g, state, todayKey); if (k > 0) tail = ` <b>${inr(k)}</b> kept.`; }
      else if (before != null && before > now && (m.unit === 'min' || m.unit === 'hours')) {
        const hBack = Math.round((toMin(m, before - now) * 28) / 60);
        if (hBack >= 1) tail = ` That’s <b>${hBack} hours back</b> this month.`;
      }
      const cmp = before != null && Math.abs(before - now) >= (m.unit === 'times' ? 0.5 : 3) ? `, ${before > now ? 'down' : 'up'} from ${fmtUnit(m, before)}` : '';
      lines.push({ icon: g.icon, html: `${name} ${fmtUnit(m, now)} a day${cmp}.${tail}` });
    } else if (m.kind === 'perDayMin' || m.kind === 'perWeekSum') {
      const total = sum(Array.from({ length: 28 }, (_, i) => Number(val(state, shift(todayKey, -i), key)) || 0));
      const before = sum(Array.from({ length: 28 }, (_, i) => Number(val(state, shift(todayKey, -i - 28), key)) || 0));
      if (!total && !before) continue;
      const wkAvg = total / 4, wkBefore = before / 4;
      const cmp = before ? (Math.abs(wkAvg - wkBefore) < (m.unit === 'hours' ? 0.5 : 10) ? ', about the same as before' : `, ${wkAvg > wkBefore ? 'more' : 'less'} than the ${fmtUnit(m, wkBefore)} before`) : '';
      lines.push({ icon: g.icon, html: `${name} ${fmtUnit(m, wkAvg)} a week over the last 4 weeks${cmp}.` });
    }
  }
  // tasks: kept and what the misses have in common
  const tops = Object.values(state.tickets || {}).filter((t) => !t.parentId && t.createdAt && dateKey(new Date(t.createdAt)) >= d28);
  const done = tops.filter((t) => t.status === 'done');
  if (tops.length >= 3) {
    const open = tops.filter((t) => t.status !== 'done' && ((t.due && t.due < todayKey) || (t.sprints || []).length > 1));
    const big = open.filter((t) => Number(t.sizeH) >= 2);
    const go = big.length >= 2 && big.length / Math.max(1, open.length) >= 0.5;
    lines.push({ icon: '✅', html: `<b>Tasks:</b> you finished ${done.length} of ${tops.length} you added in 4 weeks.${go ? ` Most of the ones that slipped are 2 hours or more. Split those.` : ''}`, go: go ? 'tasks' : null });
  }
  if (focusMin != null && focusMin.week > 0) {
    const diff = focusMin.usual ? Math.round((focusMin.week - focusMin.usual) / 6) / 10 : null;
    lines.push({ icon: '⏱', html: `<b>Focus:</b> ${hm(focusMin.week)} of real work this week${diff == null || Math.abs(diff) < 0.5 ? '' : `, about ${Math.abs(diff)} h ${diff > 0 ? 'more' : 'less'} than usual`}.` });
  }
  // one sentence for where you're heading: "By next November: 98 gym days and 40 reading days. Smoke-free by 27 Dec."
  const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
  const yr = pace.filter((x) => x.year);
  const rest = pace.filter((x) => !x.year).map((x) => x.html);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const paceText = [yr.length ? `By next ${yr[0].year}: ${join(yr.map((x) => x.html))}.` : '', rest.length ? `${cap(join(rest))}.` : ''].filter(Boolean).join(' ');
  // a few sentences that say something: ones with a comparison first, at most five habits
  const habitLines = lines.filter((l) => l.icon !== '✅' && l.icon !== '⏱');
  const rank = (l) => (/up from|down from|more than|less than|kept|back|in a row/.test(l.html) ? 0 : 1);
  const keep = habitLines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).slice(0, 5).sort((a, b) => a.i - b.i).map((x) => x.l);
  return { pace: paceText, lines: [...keep, ...lines.filter((l) => l.icon === '✅' || l.icon === '⏱')] };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- smoking: move the week's limit along the plan ----------
// Plans are copied week to week, so the step-down writes the new limit into this week's plan.
// → weeks (changed) | null
export function applyStepDown(state, todayKey) {
  const wk = weekKeyOf(todayKey);
  const plan = state.weeks?.[wk];
  if (!plan) return null;
  let changed = false;
  for (const g of plan.goals) {
    if (!g.smoking?.pace) continue;
    const lim = limitOn(g, todayKey);
    if (g.metrics[0].target !== lim) { g.metrics[0].target = lim; changed = true; }
  }
  return changed ? state.weeks : null;
}
