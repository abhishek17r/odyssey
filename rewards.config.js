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

export const REWARDS = {
  currency: '₹',
  startWeek: '2026-11-14', // first week that pays (a Saturday)
  rules: [
    { goalId: 'gym', amount: 1500, minTarget: 4 },
    { goalId: 'hiit', amount: 500, minTarget: 3 },
    { goalId: 'snacking', amount: 500, maxTarget: 0 },
  ],
  marketplace: [
    { id: 'gym-clothes', name: 'Gym clothes', icon: '🎽', price: 2500 },
    { id: 'shoes', name: 'Shoes', icon: '👟', price: 7500 },
    { id: 'glasses', name: 'Glasses', icon: '👓', price: 10000 },
    { id: 'whoop', name: 'Whoop', icon: '⌚', price: 25000 },
  ],
};
