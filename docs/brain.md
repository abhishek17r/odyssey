# The AI brain and Hermes · spec

Status: agreed direction (19 Nov 2026), not built. Decisions are at the end. Order and context: ROADMAP.md.

## What it is

One service that knows you, used by both characters:

- **Athena** speaks: the morning line, the evening reply, the weekly read. Today these are templates the AI rewords (`lib/athena.js`, `lib/athenaAI.js`, the `odyssey-athena` function). With the brain, she writes from what she knows.
- **Hermes** acts: he proposes changes to your day and week, and (later) your calendar and email. You accept or decline; nothing happens on its own.

**The rule underneath:** code counts, the AI explains. Every number comes from code and is checked; the AI never does arithmetic and never sees more than it needs.

## Three layers

### 1. Facts (code, no AI) · the daily digest

Worked out on the server each night (and on demand) from the synced records, with the same pure functions the app uses (`score.js`, `playbooks.js`, `sail.js`, `metrics.js`, `coach.js`). Stored as one small JSON per account per day; nothing in it is free text written by you.

```
digest = {
  day, tz, paused,
  habits: [{ id, name, playbook, type, target, week: { done, need, left }, run, last28: { kept, of },
             trend: 'up'|'flat'|'down', bestTime?, triggers?: [{ tag, pct }], stake?: { tone, text } }],
  tasks: { open, dueToday, overdue, doneThisWeek, usualPerWeekH, plannedH, spillH, bigSlipping: [{ id, title, sizeH, carried }] },
  focus: { weekMin, usualWeekMin, bestBlock, topDelay },
  voyage: { harbour, toNext, peril?: { name, trial, progress } },
  kleos: { week, today },
  changes: [ 'gym: 3 weeks on target', 'smoking: 4.2 a day, down from 6', … ]   // what moved since last week, computed
}
```

Task titles are included (Hermes needs them); task notes, reflections and habit "why"s are **not**, unless you turn on "Use my notes" (off by default).

### 2. Memory (AI-written, small, yours to edit)

A short profile, rewritten once a week from the last weeks of digests plus your answers to Hermes. Stored as a synced record (`memory/main`), so it is on your phone and you can read, edit or delete it in **Me → What Athena knows**.

```
memory = {
  about: '≤ 60 words: who you are and what you are working on',
  works: ['gym right after work', 'tasks under 2 h get done', …],      // ≤ 6, each with evidence: { text, from: 'data'|'you', since }
  doesnt: ['late-night scrolling after 10:30', …],                      // ≤ 6
  commitments: ['3 gym sessions a week until December', …],             // ≤ 4, from accepted proposals or your words
  style: 'direct' | 'gentle', avoid: ['weight talk', …],
  updatedAt, version, edited: true|false                                 // your edits win; the AI keeps them
}
```

Rules: nothing goes into memory that isn't backed by the digest or something you said; you can delete any line; "Forget everything" clears it and stops it rebuilding until you turn it back on.

**As built (B2, 1.5.0, 21 Nov 2026).** `lib/memory.js`, stored as the synced note `notes.memory` (no new record kind, so older versions sync it untouched). Lists: about, works, doesnt, commit, know (lasting facts from your evening notes or your own words), avoid (yours only: "don't bring up"). Each line says where it came from: your logs, your evening notes, or you.
- Built by `odyssey-athena` once a week (from 5 am on the week's first day), first in the run, so that run's notes use it. Input: this week's digest, what changed in the three weeks before, your goals and quests, and the last two weeks of evening notes (on by default, toggle in the sheet; a note with crisis words is never sent). About 700–1,000 input tokens; ~US$0.001 a build.
- Checked by code (`parseMemory`): length, every number and weekday from the input, no medical or mental-health words. A rejected build is retried at most twice a week.
- Merged, never overwritten: your lines and your "about" stay as written; a line of Athena's you edit becomes yours; one you delete goes into `dropped` and is never written again.
- Used by every job: morning, evening, weekly, report and goal requests carry `memory`; numbers in it count as facts; an answer that names a "don't bring up" topic is thrown away (the template stays).
- Me → What Athena knows: read, edit, delete, add, learn-from-notes toggle, Forget everything (off until turned back on).

### 3. Reasoning (AI, per job)

Each job gets: the system rules (Athena's existing safety rules, kept), the memory, today's digest (only the parts the job needs), and the job's instructions. Output is JSON, checked by code before use (numbers must match the digest, length limits, no medical claims); anything that fails falls back to the template, as today.

| Job | When | Model tier | Output |
|---|---|---|---|
| Morning line | each morning | small | one line |
| Evening reply | after the reflection | small | one line |
| Weekly read | Friday / Saturday | large | 3–4 lines + 1 experiment |
| Memory update | weekly | large | the memory JSON |
| Proposals | morning + after big changes | small → large if needed | ≤ 3 proposals |
| Hermes chat | when you write | large | a reply + ≤ 3 proposals |
| Plan my day (H2) | on request | large | a day plan of proposals |

## Hermes

### Proposals (H1 · first)

```
proposal = { id, at, kind, payload, why (one line, from the digest), expires, status: 'open'|'accepted'|'declined'|'expired' }
kinds (H1): move_task { taskId, to: 'today'|'tomorrow'|date|'later' } · split_task { taskId, steps[] }
            shrink_habit { goalId, tiny } · set_target { goalId, target } · plan_session { taskId, at, minutes }
            note { text }   // advice only
kinds (H2): block_time { title, start, minutes } on the Odyssey calendar · move_block
```

Proposals are synced records. **The phone applies an accepted one** with the app's own functions (`moveTicket`, `updateGoal`, …), so the local-first data model stays the owner of truth and sync carries the result. The server never edits your data directly.

Where they show: a quiet **Hermes** card on Today (at most 3, one tap Accept / Not now), the Plan sheet (already has Athena's proposals), and inside chat. Declines teach: three declines of the same kind and Hermes stops offering it for a month.

**As built (H1a, 1.6.0, 22 Nov 2026).** `lib/hermes.js` (pure) and `lib/hermesSheet.js` (screens); the mock is row 5 of the design canvas.
- **Ideas**: up to 3 a week, written by `odyssey-athena` once a week (after the memory) from this week's facts, last week's on-track, up to 6 evening notes and Athena's memory. Kinds: a time to start a task (its reminder), a habit reminder, a target, fixed days, a smaller start, moving a task, and "try" (a change the app can't set; asked about each evening). Stored in `ai-hermes-<wk>`; your answers and trials in `hermes-<wk>`, so a rebuild never touches them.
- **Checks (code)**: each idea on its own: ids exist, values in range, applies cleanly, numbers and weekdays from the facts (or the idea's own time/target), no medical, diet-number or mental-health words; nothing tried or declined in the last 30 days. No ideas while paused or after a crisis note; in a hard week (under 60%) only easier changes, and no notification.
- **What changes** is written by code, not the AI, and shown before you accept. Change it: your own time or number. Every change can be undone (Stop the trial, or Undo in the sheet).
- **Trial**: 7 days, on Today. Then "Did it help?": before vs during from your logs (on track %, the habit's daily amount, or the evening answers). Keep it (if it helped, Athena remembers it, as a line she never overwrites) or drop it (undone; not offered again for a month).
- **Notification**: at most one a day, at the hour the idea is about (in the push function's 90-minute window), only for an open idea.
- **Gate**: a week of history and 3 logged days in the last 4 weeks (many people log only the days it happened).
- **Eval fixes (1.6.0)**: the day and time accepted from either field; a lower target (or higher limit) only after 2 full weeks in a row under 60% (`weeksShortBefore`); the prompt prefers a reminder, a smaller start or fixed days. A rejected weekly answer is tried at most twice a week.

**As built (moments, 1.7.0, 22 Nov 2026).** Hermes acts when something happens, not only weekly. `momentsNow` (code) spots, in this order:
- **slip**: a limit habit over on 2+ days this week, from the hour before its usual slip time to the hour after;
- **deadline**: a task due within 2 days, an hour or more of work, no start planned;
- **missed**: a days-a-week habit missed the last 2 days when the week needs nearly every day left;
- **note**: today's or last night's note asks for a change ("need to", "should", "from tomorrow" …).

`momentRequest` sends the moment with the same facts; the AI writes one idea about that habit or task (or none), checked like any other, stored in `ai-hermes-now-<day>`. Limits: 8 am to 9 pm, one a day (a rejected answer uses it), three a week, the same moment not again for 7 days, nothing an idea this week already covers; never paused or after a crisis note. Runs on the 10-minute server check and on app launch (the launch run keeps the moment hours and limits). The idea shows first on Today ("Right now", even during a trial) and is pushed as soon as it's written, a hard week included (it only makes things easier); it counts as the day's one Hermes notification. Eval: 8 of 8 people pass (about $0.0005 a call; at most ~13 a month a person).

### Chat (H1 · second)

A sheet from the Hermes card: you type ("I'm wiped today", "I have a flight Thursday"). Hermes answers in two or three lines and attaches proposals. Each message is one job call with the memory + digest + the last few messages. No open-ended agent loop in H1: one call, structured output, code-checked.

**As built (H1b, 1.8.0, 22 Nov 2026).** The mock is rows 6 and 7 of the design canvas.
- **Where it lives**: a Hermes button top right of every tab (`lib/hermesThreadSheet.js`), opening one thread (`lib/hermesThread.js`): the week's ideas, moments, a try's evening question (from 6 pm), "Did it help?", and the chat, in order. Today's card has "Talk it through", and so does each weak spot on the Report; both open the thread with the item quoted.
- **Chat** (`lib/hermesChat.js`): your message, the last 6 messages, the facts, 3 evening notes and the memory go to `odyssey-athena` (`{ chat: { text } }`, signed-in account only). The reply is checked by code: under 75 words, written to "you", numbers from the input, no medical words except saying it can't advise. When you ask about medicine, supplements, diets or weight, a fixed line from code goes first. Up to 3 changes, each checked like any Hermes idea, plus a new kind: **pause some days** (a trip or illness, from today, at most 14 days). A message with crisis words never reaches the AI: the fixed line with the helpline answers it, on the phone.
- **Remember**: a lasting fact from the chat is offered as a line for "Keep in mind", saved only if you tap Remember (`from: 'you'`).
- **Stored**: `notes['hermes-chat']`, written only by the phone (the server answers, nothing is saved there), kept 7 days. 10 messages a day, counted by the server from the ledger; inside the account's monthly cap.
- **No trial for a pause or a moved task** (`NO_FOLLOW_UP`): applied with Undo, no "Did it help?".
- **Unread count** (`unreadCount`): an open idea or moment, a "Did it help?" not answered, an unread reply, newer than `settings.hermesSeen` (set when you open the thread). It sits on the Hermes button and on the app icon (Badging API: set by the app, and by the service worker from `badge` on every push). Not counted: the evening question, reminders, Athena's notes.
- **Weak spots act** (`lib/weakFix.js`, code only): a habit that slipped gets a daily reminder at your time (focus habits default to 9 am); a limit gets a 7-day try ("pause first"); big or carried tasks get a start tomorrow at 9; low focus gets a focus reminder. Applied as a Hermes trial with Undo, only on this or last week's report. "Plan next week with these" stays the main button.
- **Medical words** now include melatonin, pills, vitamins, magnesium, ashwagandha, creatine, painkillers and doses (found by the chat tests).
- **Not yet**: an "easy day" kind (today's smaller version only) from the mock; the chat eval (`--jobs chat`, 19 people, about $0.02) is built but not run.

### Calendar and email (H2, H3)

- **H2 Calendar** (needs Google sign-in): free/busy only, plus writing blocks to a separate "Odyssey" calendar. Enables `block_time` and "Plan my day". Event titles are never stored; only busy windows.
- **H3 Email**: a personal forwarding address first (forward an email → a task with a due date and what you'd lose). Gmail read access only if forwarding proves worth Google's restricted-scope assessment.

## Where it runs and what it costs

- **Server**: the existing `odyssey-athena` function grows into the brain (digest job, memory job, proposals, chat endpoint). The cost ledger (`odyssey_ai_calls`) and caps (`odyssey_ai_config`) already exist and apply to every call.
- **Models**: **gpt-5.6-luna for every job** (B0, 20 Nov 2026: 94% of checks on the full set vs gpt-5-mini 87% and gpt-5.4-nano 84%; about ₹1.3 per active user a month). Live Athena uses it from 1.2.1. Still to compare: Claude Haiku 5.5 (needs the Anthropic key; about $0.014 for a full run). Before this, OpenAI was wired as `gpt-5-nano` small, `gpt-5-mini` large. Before building, run the evaluation set (below) on OpenAI and Claude (Haiku-class small, Sonnet-class large) and pick per tier on quality × cost. The code keeps one adapter per provider.
- **Budget per user**: a monthly cap per account in `odyssey_ai_config` (set from the cost sheet). Over it: templates only, and Hermes says so.
- **Cost shape**: facts are free (code); the daily jobs are a few small calls; chat is the variable. Prompt caching on the fixed parts (rules + memory) keeps repeat calls cheap.

## Privacy and consent

- Opt-in: **"Let Athena and Hermes use a copy of your data"** (one screen, plain words): what is sent (the digest and memory, task titles; not notes or reflections unless you choose), where it's processed (Supabase in the EU/US region; the AI provider, which doesn't train on it), how long (digests 60 days, memory until you delete it), and how to stop (Me → What Athena knows → Turn off; turning off deletes the server copy).
- Without opt-in: everything works as today (templates).
- India's DPDP Act: purpose-specific consent, the right to see / correct / delete (the memory screen does this), a grievance contact. Covered again in the commercials and legal step.

## Evaluation (built first)

- **A test set of 20 synthetic people** (from the seed generator: a smoker cutting down, a gym regular who stalls, an overloaded task list, a paused week, a rough week that hits a peril …), each with expected facts and "a good answer would …" notes.
- **Every prompt change runs the set**; checks: numbers match the digest, no medical claims, length, proposal validity (applies cleanly), tone.
- **Live metrics** (admin page): proposals accepted / declined / ignored by kind, memory lines edited or deleted, chat messages per active user, cost per active user per month, habits kept before vs after.

### B0 · the harness (built 19 Nov 2026)

- `lib/digest.js`: the facts layer, from the app's own functions (tests in `tests/digest.test.mjs`).
- `scripts/brain/personas.mjs`: the 20 synthetic people, each with "a good answer would …" and what it must or must not say.
- `scripts/brain/jobs.mjs`: the rules, the four jobs (morning, evening, weekly, proposals) as JSON-schema requests, and the code checks: valid JSON and shape, length, every number from the facts, no medical advice, no exclamation marks or emoji, the person's must-mention and must-avoid, proposals that apply cleanly, the crisis line.
- `scripts/brain/providers.mjs`: one adapter each for OpenAI (fetch, as the athena function calls it) and Claude (the Anthropic SDK; Sonnet with the server-side refusal fallback, recorded in the results).
- `scripts/brain/eval.mjs`: `--dry` builds every request and estimates the cost (about US$0.70 for all 248 calls); without it, it runs and writes `scripts/brain/out/<time>/report.md` with pass rates, cost per call, cost per active user per month, a suggested model per tier, and every answer side by side to read for tone.
- Keys: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in the environment or `.secrets/brain.env`.
- **Testing economics** (measured, 20 Nov 2026): the full set is 62 requests per model; a core set of 7 people (`--set core`) is 23 and catches the same failure kinds. A full run costs about $0.01 (gpt-5-nano, Haiku) to $0.05 (gpt-5-mini) per model, and $0.30–0.75 for the large models; a core run is a third of that. Answers are cached by exact request, so rerunning after a prompt change pays only for the jobs whose prompt changed; `--max-spend` (default $0.30) stops a run before it starts; `node scripts/brain/eval.mjs --spend` shows every run and its cost. `--dry` is always free. Rule of thumb while tuning: core set on one or two models, full set only to confirm a pick.
- Prompt caching doesn't apply yet: requests are about 500–1,100 tokens, under the minimum prefix that caches. It starts to matter with memory and chat (B2, H1b).

## Milestones

| | What | Done when |
|---|---|---|
| B0 | Evaluation set + provider comparison | Models picked per tier, cost per call known |
| B1 | Digest job (facts) | Nightly digests match the app's own numbers for the test set |
| B2 | Memory + Me → What Athena knows | You can read, edit, delete; it rebuilds weekly from data |
| B3 | Athena on the brain | Morning / evening / weekly written from facts + memory, falling back to templates |
| H1a | Hermes proposals | Card on Today and in Plan; accept applies on the phone |
| H1b | Hermes chat | Two-line replies with proposals; capped |
| H2 | Calendar + Plan my day | After Google sign-in |
| H3 | Email by forwarding | — |

## Launch-or-kill bar (from the decisions)

Over the trial weeks: **≥ 40 % of proposals accepted**, a measurable lift in habits kept versus each person's own earlier weeks, and **cost per active user within the price** set in the commercials step.

## Decisions (19 Nov 2026)

1. Server copy of your data: **opt-in**, with a clear consent screen.
2. Models: **compare OpenAI and Claude** on the test set, then a cheap model for daily jobs and a stronger one for chat and the weekly read.
3. Hermes's first surface: **proposals first**, chat second.
4. Memory: **visible and editable** (Me → What Athena knows).
5. Success bar: as above.

**As built (one coach, 1.9.0, 22 Nov 2026).** Release (a) of the simplification plan (Claude Docs: "Odyssey · Simplification plan"). Hermes is retired as a name: the weekly ideas, moments and chat are Athena's (prompts say "You are Athena, the coach … the person decides, and the plan stays theirs"); her figure is the button, the card and the thread's avatar; pushes read "Athena · …"; Me → "Athena's ideas". Code names (`lib/hermes*.js`, `hermes-*` notes, `hermesOn`) stay, so nothing migrates.
- **Her notes in the thread**: this morning's line (template or AI), earlier mornings' AI lines, and evening replies to your notes (last 3 days). Not counted as unread.
- **Every interaction recorded**: accept, not now, undo, keep, drop, an evening yes/no, Remember and a weak-spot fix each add a line to `notes['athena-log']` (phone-written, 30 days) with where it happened ("from Today", "from your ideas", "from the Report"); the thread shows them, with Undo while the change is still running (`recordText`, `withRecord`, `answerRecorded`, `finishRecorded`, `tickRecorded`).
- **An accepted card shows the words saved at that moment** ("Changed: …"), not a recomputed text.
- Not yet: Today's simplification (release b) and the onboarding and cuts (release c). The renamed prompts haven't been run through the eval.
