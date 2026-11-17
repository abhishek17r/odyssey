// Who the user is and how they work: onboarding answers, refined later by behaviour.
// Stored as state.profile (synced as profile/main). Pure helpers; saving is in storage.js.
//
// profile = {
//   identity: 'someone who trains four days a week',        // "Your Ithaca"
//   habits: [{ goalId, type, baseline, barriers: [id], readiness? }], // up to three focus habits
//   tendency: 'upholder' | 'questioner' | 'obliger' | 'rebel' | null,
//   motivation: 'build' | 'protect' | null,                   // grow a streak, or not break one
//   wakeTime: '07:00',
//   onboardedAt: ms, updatedAt: ms,
// }

export const HABIT_TYPES = [
  { id: 'gym', label: 'Exercise or gym', icon: '🏋️' },
  { id: 'meditation', label: 'Meditation', icon: '🧘' },
  { id: 'procrastination', label: 'Beat procrastination', icon: '🧠' },
  { id: 'eating', label: 'Eat better', icon: '🥗' },
  { id: 'smoking', label: 'Quit smoking', icon: '🚭' },
  { id: 'sleep', label: 'Sleep on time', icon: '🌙' },
  { id: 'reading', label: 'Read more', icon: '📖' },
  { id: 'custom', label: 'Something else', icon: '⭐' },
];
export const habitType = (id) => HABIT_TYPES.find((t) => t.id === id) || HABIT_TYPES.at(-1);

// What usually stops people. The engine matches tactics to these.
export const BARRIERS = [
  { id: 'time', label: 'No time' },
  { id: 'tired', label: 'Too tired' },
  { id: 'forget', label: 'I forget' },
  { id: 'motivation', label: 'Lose motivation' },
  { id: 'start', label: 'Don’t know where to start' },
  { id: 'urges', label: 'Cravings or urges' },
  { id: 'stress', label: 'Stress' },
  { id: 'distracted', label: 'Get distracted' },
  { id: 'boring', label: 'It feels boring' },
];

// "A friend asks you to commit to something you don't feel like doing. You…"
export const TENDENCIES = [
  { id: 'upholder', label: 'Do it, if I said I would' },
  { id: 'questioner', label: 'Do it, if it makes sense to me' },
  { id: 'obliger', label: 'Do it, because they’re counting on me' },
  { id: 'rebel', label: 'Do it only if I want to' },
];

export const MOTIVATIONS = [
  { id: 'build', label: 'Watching a streak grow' },
  { id: 'protect', label: 'Not wanting to break it' },
];

// Existing habits that map onto a strategy type (so returning users see them ticked).
export const TYPE_OF_GOAL = { gym: 'gym', work: 'procrastination', meditate: 'meditation', eat: 'eating', smoke: 'smoking', sleep: 'sleep', read: 'reading' };

export const emptyProfile = () => ({ identity: '', habits: [], tendency: null, motivation: null, wakeTime: '07:00', onboardedAt: null, updatedAt: null });

export const isOnboarded = (state) => !!state.profile?.onboardedAt;
export const focusOf = (state, goalId) => (state.profile?.habits || []).find((h) => h.goalId === goalId) || null;
export const daysSinceOnboarding = (state, todayKey) => {
  const at = state.profile?.onboardedAt;
  if (!at) return 0;
  return Math.floor((Date.parse(`${todayKey}T12:00`) - at) / 864e5);
};

// HH:MM + minutes → HH:MM (wraps at midnight)
export function addMinutes(hhmm, mins) {
  const [h, m] = String(hhmm || '07:00').split(':').map(Number);
  const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
