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

### Chat (H1 · second)

A sheet from the Hermes card: you type ("I'm wiped today", "I have a flight Thursday"). Hermes answers in two or three lines and attaches proposals. Each message is one job call with the memory + digest + the last few messages. No open-ended agent loop in H1: one call, structured output, code-checked.

### Calendar and email (H2, H3)

- **H2 Calendar** (needs Google sign-in): free/busy only, plus writing blocks to a separate "Odyssey" calendar. Enables `block_time` and "Plan my day". Event titles are never stored; only busy windows.
- **H3 Email**: a personal forwarding address first (forward an email → a task with a due date and what you'd lose). Gmail read access only if forwarding proves worth Google's restricted-scope assessment.

## Where it runs and what it costs

- **Server**: the existing `odyssey-athena` function grows into the brain (digest job, memory job, proposals, chat endpoint). The cost ledger (`odyssey_ai_calls`) and caps (`odyssey_ai_config`) already exist and apply to every call.
- **Models**: OpenAI is wired (`gpt-5-nano` small, `gpt-5-mini` large). Before building, run the evaluation set (below) on OpenAI and Claude (Haiku-class small, Sonnet-class large) and pick per tier on quality × cost. The code keeps one adapter per provider.
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
