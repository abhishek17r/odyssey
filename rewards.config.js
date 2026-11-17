// Rewards: the "backend". Edit this file (or ask Claude Code to), then reload the extension.
// The app only reads it; nothing in the UI can change these numbers.
//
// A rule pays `amount` for a week (Sat → Fri) in which the habit `goalId` hit 100% of its plan:
//   days per week   — done on at least the target number of days
//   at most per day — every one of the 7 days logged, each within the limit
//   at least / day  — every one of the 7 days logged, each at or above the target
//   per week total  — the week's total at or above the target
// Only the habit's planned target counts, so a floor stops a week planned too easy from paying:
//   minTarget — the target must be at least this (days / hours / times)
//   maxTarget — for "at most" habits, the limit must be at most this
// Weeks are paid once they're over (after Friday), from `startWeek` on. Paid amounts are worked
// out from your check-ins every time, so fixing a past check-in changes what that week paid.

// 0.2.0: money rewards are gone (Kleos is the only reward). REWARDS stays, empty, only so the deprecated
// desktop dashboard still loads.
export const REWARDS = {
  currency: '₹',
  startWeek: '2026-11-14',
  rules: [],
  marketplace: [],
};

// Kleos ⚡ (glory): points for the behaviour behind the habits. Worked out from your data every time
// (never stored), from `start` on, so they can't drift. Negative numbers take points away.
export const POINTS = {
  name: 'Kleos',
  icon: '⚡',
  start: '2026-11-14',
  // tasks
  taskCreated: 5, taskCreatedDailyCap: 5, // planning counts, up to 5 new tasks a day
  taskDone: 20, subtaskDone: 5,
  perHourEstimate: 10, sizeBonusMax: 40,   // bigger tasks pay more (their estimate in hours × 10, up to 40)
  onTime: 15,                              // done on or before its deadline
  overduePerDay: -5, overdueMax: -30,      // each day a task sits past its deadline (done late counts too)
  // habits (per day)
  habitDone: 10,                           // an either/or habit done
  habitSkipped: -5,                        // skipped (with or without a reason)
  habitMissedPlannedDay: -10,              // a day you planned it passed and it wasn't logged
  limitKept: 10, limitBroken: -15,         // bad habits: within the limit / over it
  dailyGoalMet: 10,                        // good habits with a daily minimum
  weeklyGoalMet: 30,                       // a weekly total reached
  // focus
  per5MinFocus: 1, focusMaxPerSession: 30,
  quickStart: 5,                           // started within 2 minutes
  procrastFreeMin: 15, procrastPer10Min: -5, procrastMaxPerSession: -20,
  // streaks (days in a row with a check-in)
  streakMilestones: { 3: 20, 7: 75, 14: 150, 30: 400, 60: 800, 100: 1500 },
  streakBroken: -20,                       // a day with no check-in after a logged one
  greenWeek: 75,                           // a week that ends with a green score (67+)
  comeback: 15,                            // logging again after two or more missed days (not paused)
  urgeResisted: 5, urgeDailyCap: 5,        // riding out an urge with the urge pause, up to 5 a day
  tinyStartBonus: 5,                       // a habit done during its tiny-start trial, in the first two weeks
  ranks: [
    [0, 'Deckhand'], [250, 'Oarsman'], [750, 'Helmsman'], [1500, 'Navigator'], [3000, 'Captain'],
    [6000, 'Hero'], [12000, 'Legend of Ithaca'],
  ],
};
