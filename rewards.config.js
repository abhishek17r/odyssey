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

// Kleos ⚡ (glory): points for doing, never for planning. Worked out from your data every time (never
// stored), from `start` on, so they can't drift. Losses only for what you planned and then missed, and smaller
// than the gains. Keep-a-rule habits (Diet …) and paused days never lose Kleos. See "How Kleos works" in the app.
export const POINTS = {
  name: 'Kleos',
  icon: '⚡',
  start: '2026-11-14',
  dailyCap: 150,                           // at most this much earned in a day (stops farming)
  // tasks
  taskDone: 10, subtaskDone: 5,
  perHourEstimate: 10, sizeBonusMax: 40,   // plus 10 per estimated hour, up to 40
  onTime: 10,                              // done on or before its deadline
  overduePerDay: -5, overdueMax: -20,      // each day a task sits past its deadline
  // habits (per day)
  habitDone: 10,                           // a habit kept for the day (done)
  weekTargetMet: 30,                       // a habit's weekly target reached (days a week, or a weekly total)
  comeback: 15,                            // back the day after a miss: "never miss twice"
  habitSkipped: -3,                        // skipped, and you said so (honesty costs less)
  habitMissedPlannedDay: -10,              // a planned day passed with nothing logged
  limitKept: 10,                           // within a limit
  limitSlightlyOver: -5, limitBroken: -10, // over it: a little (up to 20% over), or more
  dailyGoalMet: 10,                        // a daily minimum reached
  // focus
  per25MinFocus: 5, focusDailyMax: 40,     // each 25 minutes worked, up to 40 a day
  quickStart: 5,                           // started within 2 minutes
  // small extras
  urgeResisted: 5, urgeDailyCap: 5,        // riding out an urge with the urge pause, up to 5 a day
  tinyStartBonus: 5,                       // a habit done during its tiny-start trial, in the first two weeks
  laurel: 25,                              // a laurel (a milestone)
  favour: 20,                              // Athena's favour: a rare surprise on a day you kept everything
  // kept only for the deprecated desktop dashboard's rank display
  ranks: [
    [0, 'Deckhand'], [250, 'Oarsman'], [750, 'Helmsman'], [1500, 'Navigator'], [3000, 'Captain'],
    [6000, 'Hero'], [12000, 'Legend of Ithaca'],
  ],
};

// The voyage: Kleos sails the ship from harbour to harbour (Delos → Ithaca). A week that ends below zero is a
// storm: the ship is blown to a peril until its trial is passed. Harbours and rewards are never taken back.
export const VOYAGE = {
  leg: 350,          // Kleos from one harbour to the next (about one good week)
  escapeBonus: 50,   // passing a peril's trial
};

// Rewards waiting at harbours, when the server has none set (the owner sets them on the admin page:
// supabase/voyage.sql). harbour: 1–12 (12 = Ithaca).
export const DEFAULT_REWARDS = [
  { id: 'd-gym-clothes', harbour: 3, icon: '🎽', name: 'Gym clothes' },
  { id: 'd-shoes', harbour: 6, icon: '👟', name: 'Shoes' },
  { id: 'd-glasses', harbour: 9, icon: '👓', name: 'Glasses' },
  { id: 'd-whoop', harbour: 12, icon: '⌚', name: 'Whoop' },
];

// The old marketplace (deprecated desktop dashboard and Chrome extension only; the app uses harbour rewards):
// real things you treat yourself to, bought with Kleos. Each one unlocks when the voyage
// reaches its port (legs sailed, counted across voyages). Spending Kleos never lowers your rank.
// Edit freely: name, icon, price (Kleos) and the leg it unlocks at (1–12; 12 = Ithaca).
export const MARKET = [
  { id: 'gym-clothes', name: 'Gym clothes', icon: '🎽', price: 1000, unlockLeg: 3 },
  { id: 'shoes', name: 'Shoes', icon: '👟', price: 2500, unlockLeg: 6 },
  { id: 'glasses', name: 'Glasses', icon: '👓', price: 3500, unlockLeg: 9 },
  { id: 'whoop', name: 'Whoop', icon: '⌚', price: 6000, unlockLeg: 12 },
];
