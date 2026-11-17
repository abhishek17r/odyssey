// Strategy templates: how each kind of habit starts, from the onboarding answers.
// Each template asks one "where are you today?" question and turns the answer into a habit (a goal in the
// week's plan) set up to be easy at first: a tiny starting version, a cue, planned days.
// Health-adjacent ones (eating, smoking) stay on behaviours: no weights, calories or medical claims.

import { PRESETS } from './score.js';
import { addMinutes } from './profile.js';

const preset = (id) => structuredClone(PRESETS.find((p) => p.id === id));
const yesNo = (target, extra = {}) => [{ id: 'days_w', kind: 'daysPerWeek', unit: 'days', target, ...extra }];

export const STRATEGIES = {
  gym: {
    question: 'How often do you train now?',
    options: [['none', 'Not at the moment'], ['some', '1–2 times a week'], ['often', '3 or more times a week']],
    // the goal is showing up: frequency first, a 20-minute minimum
    goal: ({ baseline, wake }) => {
      const g = preset('gym');
      const target = baseline === 'often' ? 3 : 2;
      g.metrics[0].target = target;
      g.metrics[0].days = target === 3 ? [1, 3, 5] : [1, 4]; // Mon Thu, or Mon Wed Fri
      return { ...g, preset: true, estimateMin: 20, tiny: 'Show up, 20 minutes counts', intention: 'After work, I go straight to the gym', cueTime: addMinutes(wake, 11 * 60) };
    },
  },
  meditation: {
    question: 'Do you meditate now?',
    options: [['never', 'Never, or rarely'], ['some', 'Sometimes'], ['most', 'Most days']],
    goal: ({ baseline, wake }) => ({
      id: 'meditate', name: 'Meditation', icon: '🧘', preset: false, tags: ['health'],
      metrics: yesNo(baseline === 'most' ? 6 : baseline === 'some' ? 5 : 4),
      estimateMin: 2, tiny: 'Two minutes counts', intention: 'After my morning coffee, I sit for two minutes', cueTime: addMinutes(wake, 30),
    }),
  },
  procrastination: {
    question: 'How often do you put off important work?',
    options: [['rarely', 'Rarely'], ['some', 'Some days'], ['most', 'Most days']],
    // one focus session on the hardest task, every working day
    goal: ({ baseline, wake }) => {
      const g = preset('work');
      g.metrics[0].target = baseline === 'rarely' ? 3 : baseline === 'some' ? 2 : 1;
      return { ...g, preset: true, tiny: 'One 25-minute session on the hardest task', intention: 'First thing at my desk, I start the hardest task', cueTime: addMinutes(wake, 2 * 60) };
    },
  },
  eating: {
    question: 'Pick one rule to start with',
    options: [['protein', 'Protein at every meal'], ['late', 'Nothing to eat after 9 pm'], ['veg', 'Vegetables with lunch and dinner'], ['water', 'Two litres of water']],
    goal: ({ baseline }) => {
      const rule = { protein: 'Protein at every meal', late: 'Nothing after 9 pm', veg: 'Veg with lunch and dinner', water: 'Two litres of water' }[baseline] || 'Protein at every meal';
      return { id: 'eat', name: rule, icon: '🥗', preset: false, tags: ['health'], metrics: yesNo(4), tiny: 'One meal at a time', rule };
    },
  },
  smoking: {
    question: 'Where are you with smoking?',
    options: [['notReady', 'Not ready to quit yet'], ['cutDown', 'I want to cut down'], ['ready', 'Ready to quit']],
    count: { label: 'Cigarettes on a usual day', default: 10 },
    // not ready: track and stay under today's number; cutting down: a bit lower; ready: half during a
    // prep week, then a quit day a week from now (target 0 from then)
    goal: ({ baseline, count = 10, todayKey }) => {
      const n = Math.max(0, Math.round(Number(count) || 0));
      const target = baseline === 'ready' ? Math.floor(n / 2) : baseline === 'cutDown' ? Math.max(0, n - 2) : n;
      const quitDay = baseline === 'ready' && todayKey ? addDays(todayKey, 7) : null;
      return {
        id: 'smoke', name: 'Cigarettes', icon: '🚭', preset: false, tags: ['health'],
        metrics: [{ id: 'times_dmax', kind: 'perDayMax', unit: 'times', target }],
        tiny: 'Pause a minute before each one', ...(quitDay ? { quitDay } : {}), readiness: baseline,
      };
    },
  },
  sleep: {
    question: 'When do you want to be in bed?',
    options: [['22:00', '10 pm'], ['22:30', '10:30 pm'], ['23:00', '11 pm'], ['23:30', '11:30 pm']],
    goal: ({ baseline }) => ({
      id: 'sleep', name: 'In bed on time', icon: '🌙', preset: false, tags: ['health'], metrics: yesNo(4),
      tiny: 'Phone down and lights low 30 minutes before', bedtime: baseline || '23:00', cueTime: addMinutes(baseline || '23:00', -30),
    }),
  },
  reading: {
    question: 'How much do you read now?',
    options: [['none', 'Hardly at all'], ['some', 'A little, some weeks'], ['often', 'Most days']],
    goal: ({ baseline, wake }) => ({
      id: 'read', name: 'Reading', icon: '📖', preset: false, tags: ['personal'], metrics: yesNo(baseline === 'often' ? 6 : 4),
      estimateMin: 10, tiny: 'One page counts', intention: 'In bed, before my phone', cueTime: addMinutes(wake, 15 * 60),
    }),
  },
  custom: {
    question: 'How often do you want to do it?',
    options: [['2', '2 days a week'], ['3', '3 days a week'], ['5', '5 days a week'], ['7', 'Every day']],
    goal: ({ baseline, name }) => ({
      id: `own-${slug(name || 'habit')}`, name: (name || 'My habit').trim(), icon: '⭐', preset: false, tags: [],
      metrics: yesNo(Number(baseline) || 3), tiny: 'The two-minute version counts',
    }),
  },
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'habit';
function addDays(key, n) {
  const d = new Date(`${key}T12:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A focus habit from its answers → the goal to put in the plan.
export function goalFor(type, answers) {
  const s = STRATEGIES[type] || STRATEGIES.custom;
  return s.goal(answers);
}

// Words for the starting version of a habit already in the plan (from its template, or a default).
export const tinyOf = (g) => g.tiny || 'The two-minute version counts';

// Onboarding answers → the profile, this week's plan and a few settings. Pure.
// answers = { identity, picks: [{ type, baseline, barriers, count?, name? }], tendency, motivation, wakeTime }
// Habits already in the plan keep their targets; only missing helpers (tiny version, cue) are added.
export function applyOnboarding(state, answers, todayKey, weekKey) {
  const wake = answers.wakeTime || '07:00';
  const plan = structuredClone(state.weeks?.[weekKey] || { theme: '', goals: [] });
  const habits = [];
  for (const p of answers.picks || []) {
    const goal = goalFor(p.type, { baseline: p.baseline, wake, count: p.count, todayKey, name: p.name });
    const have = plan.goals.find((g) => g.id === goal.id);
    if (have) {
      for (const k of ['tiny', 'intention', 'cueTime', 'estimateMin', 'rule', 'quitDay', 'bedtime', 'readiness']) if (have[k] == null && goal[k] != null) have[k] = goal[k];
    } else plan.goals.push(goal);
    habits.push({ goalId: goal.id, type: p.type, baseline: p.baseline ?? null, barriers: p.barriers || [], ...(p.type === 'smoking' ? { readiness: p.baseline } : {}) });
  }
  const first = !state.profile?.onboardedAt;
  const profile = {
    ...(state.profile || {}),
    identity: (answers.identity || '').trim(),
    habits,
    tendency: answers.tendency || null,
    motivation: answers.motivation || null,
    wakeTime: wake,
    onboardedAt: state.profile?.onboardedAt || Date.now(),
    updatedAt: Date.now(),
  };
  const settings = first ? { morningTime: addMinutes(wake, 30) } : {};
  return { profile, plan: { ...plan, setAt: Date.now() }, settings };
}
