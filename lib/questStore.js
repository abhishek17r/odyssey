// Side quests, saved: take, report, stop, skip, and settling a finished or missed quest (see quests.js).
import { load, save } from './storage.js';
import { questsOf, progress } from './quests.js';


async function setQuests(fn) {
  const st = await load();
  const Q = { log: [], skipped: {}, ...(st.profile?.quests || {}) };
  fn(Q);
  Q.log = (Q.log || []).slice(-40);
  await save({ profile: { ...st.profile, quests: Q } });
  return Q;
}
export const takeQuest = (q) => setQuests((Q) => { Q.active = { ...q, takenAt: Date.now() }; });
export const reportQuest = () => setQuests((Q) => { if (Q.active) Q.active.reported = true; });
export const stopQuest = (today) => setQuests((Q) => { if (Q.active) { Q.log.push({ ...Q.active, status: 'stopped', endDay: today }); Q.active = null; } });
export const skipQuest = (id, wk) => setQuests((Q) => { Q.skipped = { ...(Q.skipped || {}), [id]: wk }; });
export const setFasting = (on) => setQuests((Q) => { Q.fastingOn = !!on; });
// The active quest done or over? Move it to the log. → the quest just finished (status done|missed) or null
export async function settleQuest(state, today) {
  const a = questsOf(state).active;
  if (!a) return null;
  const p = progress(a, state, today);
  if (!p.done && !p.over) return null;
  const status = p.done ? 'done' : 'missed';
  let out = null;
  await setQuests((Q) => { if (Q.active?.id === a.id) { out = { ...Q.active, status, endDay: today }; Q.log.push(out); Q.active = null; } });
  return out;
}
