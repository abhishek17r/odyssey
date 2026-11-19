// Removing a habit: first a choice. Move it to your backlog (out of your weeks, kept with its setup and history,
// back in one tap from Add a habit) or remove it for good. Either way, days you already logged stay.

import { choose } from './dialog.js';
import { archiveHabit, removeHabit } from './storage.js';
import { weekKeyOf } from './score.js';
import { toast } from './controls.js';
import { track } from './usage.js';

// → 'backlog' | 'removed' | null
export async function removeHabitFlow(g, today, fromWeek = weekKeyOf(today)) {
  const v = await choose({
    title: `Remove ${g.name}?`,
    text: 'Move it to your backlog instead? It leaves your weeks but keeps its setup and history, and comes back in one tap from Add a habit.',
    actions: [{ label: 'Move to backlog', value: 'backlog', kind: 'primary' }, { label: 'Remove for good', value: 'removed', kind: 'danger' }, { label: 'Cancel', value: null }],
  });
  if (!v) return null;
  if (v === 'backlog') { await archiveHabit(g.id, fromWeek); toast(`${g.name} moved to your backlog`); }
  else { await removeHabit(g.id, fromWeek); toast(`${g.name} removed. Its past days stay.`); }
  track('habit_remove', { to: v });
  return v;
}
