# Odyssey roadmap

What's planned after the current build, roughly in order. Shipped work is in the git log.

## The order (decided 19 Nov 2026)

The UX is close to final: the owner uses 1.2 for a few days before it's frozen. No new features meanwhile. Then:

1. **AI brain and Hermes**: the brain first (what Odyssey knows about you, and memory), then Hermes on top of it.
2. **Commercials and legal**: cost per user from the admin ledger, pricing and plans (Free / Plus), privacy policy, terms, DPDP consent and account deletion, store requirements.
3. **Launch or kill**: a deliberate go / no-go decision on what steps 1 and 2 show (does the brain earn its keep, does the cost per user work at a price people pay).
4. **The rest**, in order: launch basics (Google and Apple sign-in, delete account, consent screens), the native app (Capacitor), health data, Calendar, the pillars (Gym, Screen time, Reading, Meditation), email.

Long-lead applications to start early, whatever the decision: Apple Developer and Play Console accounts, a domain and support address, Apple's Screen Time (Family Controls) entitlement, Google's Calendar scope review.

## Next: Hermes, the agent

Athena stays the voice that coaches you. **Hermes** is the one who acts: the messenger who runs errands between worlds, the patron of travellers. He reads your habits, tasks and (later) calendar and email, then does the work with your OK. (Achilles was the other candidate; Hermes fits a helper who carries messages and runs errands better than a warrior does.)

**Jobs, in order of value**
1. Plan my day: fit habits, focus blocks and due tasks into the real gaps; re-plan in one tap when the day breaks.
2. Protect what's at risk: "Gym is at risk this week. 7–8 pm is free. Block it?"
3. Talk it through: "I'm wiped today" → smallest versions, two tasks moved, runs kept.
4. Draft the week on Friday from your free hours and what you usually finish.
5. Pull tasks from email: bills, deadlines, replies owed, with what you'd lose if missed.

**How much he does on his own**
- Suggest (a card or notification with Accept / Not now): everything at first.
- Act on approval: calendar blocks (on a separate "Odyssey" calendar), moving tasks, changing targets.
- Act, then tell you, with Undo: only what you've said "always" to.
- Never: send email, accept invites, delete, buy.

**Voice** (only with Hermes): talking to the agent is when voice earns its place: “I’m wiped today”, “move my gym to Saturday”. No separate voice mode or Siri shortcut before then; on iPhone, Siri comes with the native app. (1.1’s mic, Siri Shortcut and “park a thought” were removed in 1.2.)

**Phases**
1. No integrations: chat, plan my day, re-plan, protect, Friday draft, from data the app already has.
2. Google sign-in + Calendar: free / busy, blocks on the Odyssey calendar (calendar scopes are "sensitive": Google review, no paid assessment).
3. Email: a forwarding address first (no Gmail access needed); Gmail read only if it proves worth Google's restricted-scope security assessment.
4. More autonomy for what you've said "always" to.

**Open decisions**
- Server sync of a summary (opt-in) so Hermes can run in the background.
- Default autonomy (suggest only, to start).
- Model: OpenAI is wired; compare tool-use reliability before choosing. Cheap model daily, stronger one for the weekly draft and chat.
- Budget per user per month; keep features with > 40% of proposals accepted, cut those under 25%.

## Soon (owner)

- Check the admin page's **Rewards at harbours** section signed in as the owner, and set the first real rewards per harbour. (`supabase/voyage.sql` is run; its functions are checked: the app's read works and the owner-only ones refuse anyone else.)

## Later

- Google sign-up (OAuth), a domain and a reply-to address
- Bring-your-own Spotify on the focus card
- A privacy policy
- An App Store / Play Store wrapper, which unlocks:
  - Apple Health and Health Connect (workouts tick Gym; sleep; weight trend, opt-in)
  - Screen Time limits and an app shield (needs Apple's approval); usage time on Android
  - Widgets and lock-screen buttons (log a cigarette, a session)
  - A lock-screen focus timer and iPhone Focus mode during blocks
- Calendar blocking for tasks from the app (folds into Hermes phase 2)
- A product-analytics tool, once there are enough users to need one
- Splash, the alternative: **A · Dusk on paper** (the app's light paper sky warming to a sunset band at the horizon, a hazy harbour city behind, the galley on pale water). Kept on the mock canvas beside D, which ships. Worth trying if the dark sunset ever feels too heavy next to the light app, or for a light-mode splash.
