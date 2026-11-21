// A habit's goal ("100 push-ups in a row by 21 Feb") and the plan to get there, in blocks of weeks, each ending
// with a check. Code builds the plan from the answers (numbers are worked out here, never by the AI); Athena may
// reword it for the person later (lib/athenaAI.js, kind 'goal'), keeping every number.
//
// vision = { text, by 'YYYY-MM-DD', now: '38 in a row', days: 4, around: '', start 'YYYY-MM-DD', plan, setAt }
// plan   = { weeks, blocks: [{ from, to, title, detail, check: { day, text } }] }

import { dateKey, addDays, parseKey } from './score.js';

const shift = (k, n) => dateKey(addDays(parseKey(k), n));
const fmt = (k) => parseKey(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// the first number in some words, and what follows it ("100 push-ups in a row" → { n: 100, unit: 'push-ups in a row' })
export function numberIn(s) {
  const m = String(s || '').replace(/,(?=\d{3})/g, '').match(/(\d+(?:\.\d+)?)\s*(.*)/);
  return m ? { n: Number(m[1]), unit: m[2].trim() } : null;
}
// a tidy number for a milestone: whole numbers, rounded to 5 above 50
const tidy = (x, toward) => {
  const r = x >= 50 ? Math.round(x / 5) * 5 : Math.round(x);
  return toward > 0 ? Math.max(r, 1) : r;
};

export const weeksBetween = (from, to) => Math.max(1, Math.ceil((parseKey(to) - parseKey(from)) / (7 * 864e5)));

export function makePlan({ text, by, now = '', days = 3, around = '' }, today) {
  const weeks = Math.min(52, weeksBetween(today, by));
  const goal = numberIn(text);
  const cur = numberIn(now);
  const nBlocks = weeks >= 10 ? 4 : weeks >= 6 ? 3 : weeks >= 3 ? 2 : 1;
  const testWeek = weeks >= 6; // the last week eases off and tests
  const buildWeeks = testWeek ? weeks - 1 : weeks;
  const per = buildWeeks / nBlocks;
  const blocks = [];
  const numeric = goal && cur && goal.n > cur.n;
  const unit = goal?.unit || '';
  const rest = /\b(two|2) days in a row|sore|pain|injur|knee|back|shoulder/i.test(around) ? ' Rest a day between sessions.' : '';
  const STAGES = ['Build the base', 'Add a little each week', 'Push toward the goal', 'Final stretch'];
  const STAGES_WORDS = ['Start small and steady', 'Build the routine', 'Stretch it', 'Final push'];
  for (let i = 0; i < nBlocks; i++) {
    const w0 = Math.round(i * per) + 1, w1 = Math.round((i + 1) * per);
    const end = shift(today, w1 * 7 - 1);
    const stage = (nBlocks === 1 ? [STAGES[2]] : nBlocks === 2 ? [STAGES[0], STAGES[2]] : nBlocks === 3 ? [STAGES[0], STAGES[1], STAGES[2]] : STAGES)[i];
    if (numeric) {
      const m = tidy(cur.n + ((goal.n - cur.n) * (i + 1)) / (nBlocks + (testWeek ? 0.25 : 0)), 1);
      const last = i === nBlocks - 1 && !testWeek;
      const mark = last ? goal.n : Math.min(m, goal.n);
      blocks.push({
        from: w0, to: w1, title: `${stage}: up to ${mark}`,
        detail: `${days} sessions a week. Each one, go a little past your last best, with good form; stop while you still could do one more.${rest}`,
        check: { day: end, text: `Check ${fmt(end)}: ${mark} ${unit}`.trim() },
      });
    } else {
      const words = (nBlocks === 1 ? [STAGES_WORDS[3]] : nBlocks === 2 ? [STAGES_WORDS[0], STAGES_WORDS[3]] : nBlocks === 3 ? [STAGES_WORDS[0], STAGES_WORDS[1], STAGES_WORDS[3]] : STAGES_WORDS)[i];
      blocks.push({
        from: w0, to: w1, title: words,
        detail: i === 0 ? `${days} days a week, small enough that you never skip.${rest}` : `${days} days a week; make each session a bit bigger than the block before.${rest}`,
        check: { day: end, text: `Check ${fmt(end)}: how close are you? Change the next block if you need to.` },
      });
    }
  }
  if (testWeek) {
    blocks.push({
      from: weeks, to: weeks, title: numeric ? 'Ease off, then go for it' : 'Last week: wrap it up',
      detail: numeric ? 'Two light sessions early in the week, then the attempt.' : 'Finish the last pieces; start nothing new.',
      check: { day: by, text: `Goal day ${fmt(by)}: ${text}`.trim() },
    });
  }
  return { weeks, blocks };
}

// Where you are in it today → { week, of, block } | null (before it starts or after it ends)
export function planNow(vision, today) {
  if (!vision?.plan || !vision.start) return null;
  const week = Math.floor((parseKey(today) - parseKey(vision.start)) / (7 * 864e5)) + 1;
  if (week < 1 || week > vision.plan.weeks) return null;
  const block = vision.plan.blocks.find((b) => week >= b.from && week <= b.to) || null;
  return { week, of: vision.plan.weeks, block };
}
