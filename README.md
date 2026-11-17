# Odyssey — habits, sprint tickets, procrastination data (personal Chrome extension)

*Every day, a step toward Ithaca.* Brand: a sail under a guiding star on a night sea (`icons/logo.svg`;
the PNG icons are rendered from it). Colours: night-sea navy for hero panels, Aegean blue for actions,
bronze for what you earn, navy ink on warm parchment in light mode. Names and headings use a classical
serif (Iowan Old Style / Palatino); numbers and controls use the system font. Light and dark follow macOS.

A personal JIRA plus a habit tracker. Two kinds of things:

- **Habits**: daily / weekly rules you score yourself on (Gym, Snacking, Meaningful work hours…).
  One check-in a day gives a compliance score (0–100), Whoop-style.
- **Tickets**: sized work items (hours) in a weekly sprint. You work on them with the task timer,
  which records how long it took to start, why, and how long you worked.

Plan both every Friday night. The improvement loop is built on **Atomic Habits** (identity, the four
laws, small changes, never miss twice) and **Whoop** (morning readiness, a target set by readiness,
a journal that shows which behaviours move your numbers, comparison with your own baseline).

## The improvement loop

| | Whoop idea | Atomic Habits idea | In Odyssey |
|---|---|---|---|
| Morning | Recovery | | **Morning check** in the popup: sleep, energy, mood → **readiness** 0–100 (50% sleep vs target, 30% energy, 20% mood) |
| | Strain target from recovery | | **Focus target today** = your 28-day median focus hours × readiness (green 1.15, yellow 0.9, red 0.6) |
| | | Make it easy (energy) | **Fastest-start time of day** from your data, shown each morning |
| | | Never miss twice | Habits that went red yesterday are flagged in the morning and on the check-in |
| | | Implementation intentions / habit stacking | Each habit can carry a **cue** (“After coffee, I will…”) and an **identity** (“I am someone who…”), set on the week board (✎ Edit habits) |
| Working | | The four laws | **One experiment at a time** from a playbook (below); the popup runs its ritual |
| | | Identity votes | Every session started within 2 min, and every habit on target, is a **🗳️ vote**; quick-start streak |
| Weekly | Weekly performance assessment | | **Retro** with the headline numbers, readiness and votes vs last week |
| | Journal → impact | | **Trends → What moves your starts**: days with vs without a behaviour |
| | Personal baselines | One change, measured | Experiments are judged against **your own previous 14 days** |

### The playbook (Retro → Coach)

The coach reads your answered procrastination reasons from the last 14 days and recommends plays
that target them (if over half your procrastination has no reason, it asks you to answer “why” first).
Run one at a time, at least a week each; the Retro shows before vs during (median time to start, %
quick starts, % procrastinating, minutes of the targeted reason) and a verdict once there are 5+
sessions on each side.

| Play | Law | Targets | What the popup does |
|---|---|---|---|
| Name the first 2-minute action | Make it easy | unclear, too big, avoiding | Asks for the first physical action at start and shows it while you start |
| Two-minute rule | Make it easy | too big, avoiding, perfectionism, mood | Notification at 2 minutes of work: you started, the rest is a bonus |
| Prime the environment | Make it obvious | distracted, interrupted, energy | Pre-start checklist (edit in Settings) |
| Block the distractions | Make it difficult (inversion) | distracted | Sites in Settings won't load while a session runs (not while paused) |
| Implementation intentions | Make it obvious | perfectionism, interrupted, energy, mood | After each session: “when is the next one?” → reminder at that time |
| Hard work in your best hours | Make it easy | energy, avoiding, too big | Shows your fastest-start time and today's readiness |
Everything is stored in `chrome.storage.local` in your Chrome profile. No servers, no accounts, no network.

## Install (one time)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`~/Documents/habit-tracker`)
4. Pin it: puzzle-piece icon → pin **Odyssey**

After editing any file, hit ↻ on the extension card.

## Habits

Built in (set targets each week, or switch one off):

| Habit | Tracked as | Default target |
|---|---|---|
| 🏋️ Gym | days / week, optional reason when skipped | 4 |
| 🌅 Morning HIIT | days / week, optional reason when skipped | 3 |
| 🍪 Snacking | at most N times / day | 0 |
| 📱 Scrolling | at most N hours / day | 1 |
| 🧠 Meaningful work | at least N hours / day, plus **procrastination minutes before starting** (at most N / day, optional reason) | 4 h, 15 min |
| 💼 Job hunting | hours / week and times / week | 5 h, 3× |

**Extra habits:** add one and track it by one or more of: times / week, minutes / week,
hours / week, days / week, hours / day.

**All habits carry over.** A week you don't plan gets a copy of the latest plan (built-in and extra
habits, same targets); the board says “carried over from the week of …”. Change a habit with **This week → ✎ Edit habits** and
Save habits; the change carries forward from that week.

## Rewards (💰)

Some habits pay into a wallet when a week (Sat → Fri) hits **100% of the plan**, not partial:

| Habit | Pays / week | 100% means | Target floor |
|---|---|---|---|
| 🏋️ Gym | ₹1,500 | done on at least the target days | target ≥ 4 days |
| 🌅 Morning HIIT | ₹500 | done on at least the target days | target ≥ 3 days |
| 🍪 Snacking | ₹500 | all 7 days logged, each within the limit | limit 0 |

- Paid once the week is over (Friday night), from the week of 14 Nov 2026. A week planned below the
  floor doesn't pay, so the target can't be made easy to earn. An unlogged day isn't 100%.
- Earnings are recalculated from your check-ins, never stored, so correcting a past check-in corrects what that week paid.
- **Rewards tab:** balance, earned, spent, what's still in play this week (🔒 locked in once a target is reached),
  earnings per week, and the **marketplace**: 🎽 Gym clothes ₹2,500 · 👟 Shoes ₹7,500 · 👓 Glasses ₹10,000 ·
  ⌚ Whoop ₹25,000. Buy when the balance covers it; Undo a purchase to get the money back.
- The popup shows the balance and how much is in play. The habit editor shows 💰 on habits that pay.
- **The rules and the marketplace live in `rewards.config.js`** (the “backend”): amounts, floors,
  start week, items and prices. The app only reads it. Edit it (or ask Claude Code), then reload the extension.

## Sprint tickets

On **This week → 1 · Tasks**, add the work for the week: a title, a **size in hours**, an optional **deadline**, and
optionally the **habit its time counts toward** (e.g. Meaningful work, Job hunting). Tickets have a status
(○ To do · ◐ In progress · ● Done), tags, and **subtasks** (each with its own size and deadline; a subtask
deadline after its parent's is outlined in red). Changes save as you make them.

- **Backlog tab:** future tasks that aren't in any sprint, with subtasks and deadlines, soonest deadline first.
  Move one **→ This sprint** or **→ Next sprint** (its open subtasks go with it), or pull it in from
  *Pull from the backlog* under Tasks on the board. **↩ Backlog** sends a sprint ticket back. Backlog tickets don't carry over.
  Moved into next week's sprint (or on Saturday) a ticket counts as planned; pulled in mid-sprint it's unplanned.
  The timer's dropdown lists the backlog too; starting one moves it into this sprint.
- **Deadlines** show everywhere as *due Wed 18 Nov* / *due today* / *overdue 2d*; the popup lists what's due
  today or overdue. Retro adds **Done by the deadline (%)** and **Open tickets past deadline**.

- Starting the timer on a ticket sets it to In progress; after End you can **✓ Mark done**.
- Work that wasn't planned: pick **＋ New ticket…** in the timer. It joins this sprint as *unplanned*.
- **Unfinished tickets carry over** to the next sprint automatically; the board shows “carried N×”.
- The board's **🎫 Sprint tickets** table: status (change it there), size, hours logged on the timer,
  % of size, sessions, average time to start, % procrastinating and the top reason. Trends shows
  logged / size per week.

## Time estimates (counted automatically)

Every task and habit can carry an optional time estimate:
- **Tasks:** *Estimate (hours)* in the task drawer (the old “size”).
- **Habits:** *Usual time (optional)* in ✎ Edit habits, for done / not-done habits like Gym (e.g. 60 min).

When there's no timer for it, the estimate counts as time spent:
- A task ticked done with **no timer sessions** counts its estimate on the day it's done, including toward
  its habit's hours (e.g. Meaningful work). A parent whose subtasks have estimates leaves the counting to them.
- A habit ticked done counts its usual time that day; untick or skip it and the time goes away.
- If the timer was used, the timer's time is what counts, never the estimate.

Shown as *est.* on cards; the popup's Today header, the Today page and the week board show **time invested**
(timer + estimates), and Retro adds **Time invested** next to timer hours. Starting and procrastination
numbers stay timer-only.

## Tags

Every habit and ticket can have one or more colour-coded tags: **Office**, **Job hunting**, **Personal projects**,
**Health**, **Random** to start. Built-in habits come pre-tagged; change them per week in the habit editor on the board.
Add a tag with “+ New tag” on any card, or rename / recolour / delete in Settings → Tags.
The board can be filtered by tag, and Trends shows averages per tag.

## Task timer

Hit **▶ Start task** at the top of the popup. Pick a **ticket** from this sprint (the last pick is
preselected), **habit time without a ticket** (e.g. just Meaningful work), or **＋ New ticket…**
(title, size, which habit it counts toward). Optionally say what exactly, and set the session length
(**45 min** by default; change the default in Settings). Then:

1. **Procrastinating** (coral): the clock counts up from the moment you start the session.
2. Press **▶ Start working** when you actually begin. From then on it's **working** (green), counting
   down the session length. You get a notification when it hits zero; after that it counts overtime.
3. **⏸ Pause** while working (yellow). Paused time counts as neither work nor procrastination.
   **▶ Resume** puts you back in procrastination mode (coral) until you press **▶ Back to work**; the
   countdown then carries on from where it stopped.
4. **■ End** finishes the session. Every start is a new session.

The toolbar badge shows the running minutes (coral / green / yellow). **Sessions sync into the check-in** when
you end them: time worked goes to the ticket, and to **the habit the ticket counts toward** (e.g.
Meaningful work hours); procrastination before starting adds up across all of the day's sessions.
While a habit has sessions that day, its field is locked (⏱ synced) and shows their total. The
check-in also lists the tickets you worked on that day.
To change it, use the **Task timer** card on the Today page: **Edit** (ticket, what, start time,
minutes, reasons) or **✕** to delete, or tick several sessions to **rename or move them together**.
Every change re-syncs the check-in. Changing a ticket's habit on the board moves its sessions' time too.
Fields without sessions stay as normal inputs. The board lists this week's sessions with **% of each session
spent procrastinating** (procrastination ÷ procrastination + work); Trends shows average time to start
and timed work per week.

## Why you procrastinated (per session)

Every procrastination stretch in a session is recorded: before you first start working, and after each
Resume. When one lasts at least **2 minutes** (Settings → “Ask why after”), the popup asks **what held
you back**, from a fixed list so it can be counted:

🧭 Unclear next step · 🏔️ Task feels too big · 🙈 Avoiding something hard / uncomfortable ·
🔋 Low energy / tired · 🌧️ Anxious or low mood · 📱 Distracted · 🚪 Interrupted / something urgent ·
⏳ Waiting for the right moment / perfectionism · ✏️ Other

Add a note if you like, or Skip. Answer or change it later with **Edit** on the Today page (older
sessions get one stretch covering their procrastination). The board shows **Why you procrastinated
this week** (times, minutes, share per reason; unanswered stretches as “Not answered”), Trends the
same over 28 days.

## Friday retro (the measurement framework)

The **Retro** tab computes the sprint from the raw records, the same way every time
(definitions in `lib/metrics.js` and at the bottom of the tab). Pick any week; it's compared with the
week before (green = better, red = worse).

- **Headline numbers**: median time to start · % started within 2 min · % of session time
  procrastinating · hours worked · % of sessions run to full length · resumes per session · % of
  procrastination with no reason · tickets done · % carried over · logged ÷ size on done tickets ·
  habit score.
- **Starting by time of day**: median time to start per block (early, morning, midday…).
- **Why you procrastinated**: minutes and share per reason, change vs last week.
- **Reasons by ticket**: which tickets trigger which reasons (minutes, heat-shaded).
- **Tickets**: outcome (done / carried over / open), size, logged, sessions, median time to start,
  % procrastinating.
- **Habits**: average per habit vs last week. **Reflections** for the week alongside.
- A one-paragraph summary at the top says the same numbers in words.
- **Export metrics** downloads this week's and last week's numbers as JSON.

On Friday the popup banner and the planning reminder open the Retro first, then the board on next week.

## Your data is safe

- Upgrades **never delete data**: each new version converts the old data in place, and a backup is
  taken first.
- A backup is also kept **every week**, and before every restore, import or erase (last 10).
- **Settings → Backups**: Download or Restore any of them, or Back up now.
- **Settings → Export** gives everything as plain JSON (sessions with delays and reasons, tickets
  with sizes and status, habits, check-ins), ready for analysis elsewhere.

## The week board (This week) is also where you plan

Weeks run **Saturday → Friday**. The **This week** tab is the planning board, with a This week / Next week switch:

- **Header**: the week's theme (saves as you type) and, for this week, score and on-track KPIs.
- **1 · Tasks**: a Kanban board (To do · In progress · Done). Drag cards between columns; add with the
  quick-add box (type, Enter). A card shows hours logged vs size, deadline, subtasks done, carried-over count,
  tags and habit. **Click a card** for its drawer: title, status, size stepper, deadline (date or Today / Tomorrow /
  Friday chips), habit, tags, a **subtask checklist** (add with Enter), numbers so far, and move / delete.
  *Pull from the backlog* lists backlog cards with → Add to sprint. Unfinished ones carry over by themselves.
- **2 · Habits**: this week's progress grid; **✎ Edit habits** opens the targets, identity and cues (Save habits).
- Below, for this week: why you procrastinated, the task timer, reflections and reasons.

On Friday, “Plan” (popup and reminder) opens the board on **next week**: Tasks, then Habits
(already filled with every current habit). Per-ticket starting and procrastination numbers are in Retro.

## Daily check-in (~1 minute)

Click the icon (or open the phone app). It's one app with four tabs: **☀️ Today** (due tasks and habits),
**🎯 Focus** (the timer: type anything you're about to work on, or tap one of your tasks), **✅ Tasks** (this week's sprint and the backlog; tap a task for its sheet) and
**🧭 Me** (week stats, rewards, links to the full dashboard, account & sync). While a focus session runs it
takes the whole screen; ⌄ shrinks it to a mini bar above the tabs. On **Today**:

- **Due today:** sprint tasks due today or overdue. Tick ✓ to finish one, ▶ to start a focus session on it.
- **Habits:** one card per habit. Tap ✓ for done (a little celebration); *Skip* opens "Skipping … today? Why?" with quick
  reasons (tired, no time, unwell, travel, rest day) or your own words, then *Skip today* (it shakes, greys out, and can be
  undone). Done habits move to a **Done** group and skipped / over-the-limit ones to **Skipped or missed**, below the
  ones still to log. Counts and hours use −/+ steppers
  (or type). Each card shows this week's dots (Sat → Fri) and progress to target. **Every change saves itself**;
  there are no Save buttons. Weekly totals (e.g. job hunting) don't need an entry every day.

The dashboard's **Today** page has the same habit cards and due tasks for any day you pick.
The check-in reminder only fires if today isn't complete.

**Reflection:** below the check-in there's a free-text box for how the day went, in your own words.
It saves as you type and doesn't affect the score. Read them back under **Reflections this week** on the
board and **Reflections, last 28 days** in Trends.
The ring shows today's score: **Thriving** ≥ 67 · **Building** 34–66 · **Fresh start tomorrow** < 34.

## Today page

The dashboard opens on **Today**: the day name and full date in big type, the week it belongs to,
the day's score, and a month calendar (weeks run Sat → Fri). Each calendar day is tinted by its score;
✎ marks days with a reflection. Click any past day (or use ‹ Prev / Next ›, Today, or the date picker)
to view and update it: the same check-in as the popup (per-goal Save, Save all, note), the reflection,
and that day's task-timer sessions. Open it from the popup's **Today page** link.

## Scoring

- **Days / week**: done = 100. Skipped = 100 while the weekly target is still reachable, 0 once it isn't.
- **At most per day**: at or under = 100, falling to 0 at double. A target of 0 is strict: 1 → 40, 2 → 10, 3+ → 0.
- **At least per day**: value ÷ target, capped at 100.
- **Per week totals**: on pace? Running total ÷ the share of the target due by today.
- **Tasks**: 100 from the day it's done; not counted while there's still time; 0 if Friday ends without it.
- A goal = average of its metrics. The day = average of its goals.

## Dashboard

- **Today**: see above
- **This week**: the planning board (above): tasks, habits editor, and every goal × Sat–Fri, weekly progress, tag filter, your reflections, the reasons you logged,
  and a status per goal:
  - **Done** — weekly target already met
  - **On track** — enough days / pace left
  - **At risk** — no slack left, behind pace, or under 80% of days on target
  - **Missed** — can't be reached any more, or under 50% of days on target
- **Backlog**: future tasks, subtasks, deadlines, move into a sprint
- **Rewards**: wallet, this week's rewards in play, marketplace, purchases
- **Trends**: last 28 days, previous weeks per goal, per-goal and per-tag 7/28-day averages, reasons log
- **Settings**: reminder times, default session length, tags, export / import / erase

## Sync and the phone app

Optional. Sign in with a username and password (Settings → ☁️ Account & sync) to link this extension and
the phone web app through your own Supabase project; only your (owner) account can see the data. Each device keeps a full copy and works offline, and
the newest edit of each record wins. Setup, hosting and privacy: **[SETUP.md](SETUP.md)**.

## Notifications

Settings → 🔔 Notifications: each has an on/off switch and a time. Chrome must be running and macOS must
allow Chrome notifications.

| | When | What |
|---|---|---|
| ☀️ Morning brief | 08:30 | Overdue, due today and due tomorrow; reward habits at risk; a nudge for the morning check. Silent if there's nothing. |
| 🔁 Habit cues | each habit's cue time | Set *Cue time* per habit in ✎ Edit habits. Fires only if the habit isn't logged yet; yes/no habits get a **✓ Done** button that logs it without opening anything. |
| ✨ Evening check-in | 21:30 | Only if today isn't complete; names the habits still to log. |
| 🗓️ Friday planning | 20:00, Fridays | If next week isn't planned: retro, then plan. |

Always on during sessions: session end, the two-minute nudge, and your “next session” reminders.

## Google Calendar (no sign-in)

Buttons open Google Calendar's own new-event page, pre-filled; nothing is added until you press Save there.
- **Task drawer:** 📅 Block *N* h in Calendar (a focus block the length of the estimate, starting at the next
  whole hour) and 📅 Deadline in Calendar (all-day on the due date).
- **Popup, due today:** 📅 next to each task blocks time for it.
- **After a session:** once you set “when's the next session?”, 📅 Add to Google Calendar.
- **Habit editor:** 📅 Daily event in Google Calendar: a daily repeating event at the habit's cue time, as long as its usual time.

## Files

- `popup.html/js`: check-in, score ring, focus timer (`popup.css`)
- `dashboard.html/js`: Today page, week board, backlog, retro, rewards, trends, settings (`dashboard.css`)
- `styles.css`: the design system: colours, type, buttons, fields, light / dark (follows macOS)
- `lib/checkin.js`: the check-in form and reflection box (used by the popup and the Today page)
- `background.js`: reminders, session-end notifications, toolbar badge
- `lib/score.js`: built-in goals, metric types and scoring (edit defaults here)
- `lib/storage.js`: data layout, upgrades between versions (never deleting), backups, tickets
- `lib/targets.js`: the ticket / habit picker shared by the popup and the dashboard
- `lib/metrics.js`: the weekly measurement framework (every Retro number and its definition)
- `lib/coach.js`: readiness, focus target, votes, never miss twice, the playbook, experiments, impact
- `lib/ui.js`: tag chips and status pills
- `lib/controls.js`: stepper (−/+), check button, emoji scale, side drawer, toast
- `lib/tickets.js`: the task card and the task sheet, shared by the dashboard and the app
- `lib/notify.js`: what each notification says (and when it stays silent)
- `lib/gcal.js`: Add to Google Calendar links
- `config.js`: your Supabase URL and anon key (empty = local only)
- `lib/cloud.js`, `lib/sync.js`, `lib/syncRunner.js`, `lib/account.js`: sign-in, record sync, the Account panel
- `supabase/schema.sql`: the locked records table, the owner account, and the owner-only functions that read and write it
- `web/`: the phone app's pieces (Chrome API stand-in, service worker, manifest, phone styles);
  `scripts/build-web.mjs` builds it into `dist/web`
- `rewards.config.js`: reward rules and marketplace items (edit here)
- `lib/rewards.js`: what each week paid, the wallet balance
