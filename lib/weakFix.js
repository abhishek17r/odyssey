// A weak spot's one-tap fix (Report): code turns the weak spot's suggestion into a Hermes change, applied with
// the same code as Hermes' ideas (answer → a 7-day trial with Undo, "Did it help?" after). No AI.
// → { idea, label, note?, pickTime? } | null (no change the app can make: "Talk it through" only)

import { weekKeyOf, planOf } from './score.js';
import { isValid, changeText } from './hermes.js';

const ampm = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
const open = (state) => Object.values(state.tickets || {}).filter((t) => t.status !== 'done' && !t.parentId);
const short = (s, n = 28) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

export function fixFor(state, w, wk, day) {
  const id = `ws-${wk}-${w.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const base = { id, wk: weekKeyOf(day), why: [w.why], fromWeak: w.id };
  let idea = null; let label = ''; let pickTime = false;
  if (w.id.startsWith('habit:')) {
    const g = planOf(day, state)?.goals.find((x) => x.id === w.id.slice(6));
    if (!g) return null;
    if (g.metrics?.[0]?.kind === 'perDayMax') {
      idea = { ...base, kind: 'try', goalId: g.id, title: `Pause before ${g.name.toLowerCase()}`, text: 'When the urge comes, pause first, then do your planned thing', check: 'When the urge came, did you pause first?' };
      label = 'Try it for 7 days';
    } else {
      const time = g.cueTime || (['focus', 'work'].includes(g.playbook) ? '09:00' : '19:00');
      idea = { ...base, kind: 'set_cue', goalId: g.id, time, title: `A ${g.name} reminder at ${ampm(time)}` };
      label = 'Set a daily reminder'; pickTime = true;
    }
  } else if (w.id === 'tasks:big' || w.id === 'tasks:carried') {
    const list = open(state).filter((t) => (w.id === 'tasks:big' ? (Number(t.sizeH) || 0) >= 2 : (t.sprints || []).length >= 3));
    const t = list.sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1)[0] || (w.id === 'tasks:carried' ? open(state).sort((a, b) => (b.sprints || []).length - (a.sprints || []).length)[0] : null);
    if (!t) return null;
    idea = { ...base, kind: 'plan_session', taskId: t.id, at: 'tomorrow 09:00', minutes: 60, title: `Start “${short(t.title)}” at 9 am` };
    label = `Start “${short(t.title, 22)}” tomorrow at 9`; pickTime = true;
  } else if (w.id === 'focus:low') {
    const g = planOf(day, state)?.goals.find((x) => x.playbook === 'focus' || x.playbook === 'work');
    if (!g) return null;
    const time = g.cueTime || '09:00';
    idea = { ...base, kind: 'set_cue', goalId: g.id, time, title: `A ${g.name} reminder at ${ampm(time)}` };
    label = 'Set a daily focus reminder'; pickTime = true;
  }
  if (!idea || !isValid(state, idea, day)) return null;
  return { idea, label, pickTime, note: changeText(state, idea, day) };
}

// the same fix at your time ("HH:MM")
export function atTime(idea, hhmm) {
  if (idea.kind === 'set_cue') return { ...idea, time: hhmm, title: idea.title.replace(/at .*$/, `at ${ampm(hhmm)}`) };
  if (idea.kind === 'plan_session') return { ...idea, at: `tomorrow ${hhmm}`, title: idea.title.replace(/at .*$/, `at ${ampm(hhmm)}`) };
  return idea;
}
