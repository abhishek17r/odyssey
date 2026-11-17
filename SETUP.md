# Odyssey: cloud sync and the phone app

Sign in with a **username and password**. The first account you create is the owner, and only the owner
can read or write your data.

## 1. Supabase (project `wotlxnvhhgtrgsaggvui`; URL and publishable key are in `config.js`)

1. **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), **Run**. It:
   - creates the records table and locks it (no direct reads or writes from outside),
   - makes the first confirmed account the owner, automatically,
   - adds the two functions the app uses, which only answer the owner,
   - removes what's left of the earlier versions (sync key, email sign-in). Safe to run again.
2. **Authentication → Sign In / Providers → Email**: turn **off** “Confirm email”, **Save**. (Supabase's
   free plan can't send the confirmation mail usefully, and a plain username has no inbox.)
3. Optional tidy-up: **Authentication → Users**. If there's an unconfirmed user from the earlier email-code
   try, delete it.

## 2. The Chrome extension

1. `chrome://extensions` → **↻ Reload** Odyssey (Chrome may ask to allow access to `supabase.co`).
2. Dashboard → **Settings → ☁️ Account & sync → First time? Create your account** → pick a username
   (e.g. `abhishek`) and a password (8+ characters) → **Create account**. Let Chrome save the password.
   The first sync uploads everything on this computer; after that it syncs every minute and a few
   seconds after each change.
3. Then lock the door behind you: Supabase → **Authentication → Sign In / Providers** → turn **off**
   “Allow new users to sign up”, **Save**. (Others couldn't see your data anyway; this stops new accounts.)

## 3. The phone app (PWA)

1. Build it: `node scripts/build-web.mjs` (writes `dist/web`).
2. Host it on Cloudflare Pages (free): https://dash.cloudflare.com → **Workers & Pages → Create → Pages →
   Upload assets**, project name `odyssey`, drag in the `dist/web` folder. Or from the terminal:
   `npx wrangler pages deploy dist/web --project-name odyssey`. You get a URL like `https://odyssey-xxx.pages.dev`.
3. On the iPhone: open that URL in **Safari** → **Share → Add to Home Screen** → open **Odyssey** from the
   home screen → **☁️ Sign in** with the same username and password → **Turn on notifications**.

**Updating:** after any change, build and upload again; the app picks it up the next time it opens.

## Privacy

- Your password is checked by Supabase's sign-in system, which stores only a secure hash of it.
- The Supabase URL and publishable key inside the app are public by design. On their own they open nothing:
  the table can't be read directly, and the functions only answer the owner account.
- Each device stays signed in (a session that renews itself). Sign out under Settings → Account & sync.
- Usernames without `@` are stored as `username@odyssey.test`, a reserved address that never receives
  mail, so there's no "forgot password" email. If you forget the password: in Supabase run
  `delete from public.odyssey_owner;`, delete your user under Authentication → Users, temporarily allow
  sign-ups again, and create the account anew (your data stays; the new account becomes the owner).
  Prefer email resets? Use a real email address as the username.

## 4. Push notifications (with the app closed)

The odyssey-push Edge Function runs every 5 minutes, works out what's due (session end, morning brief, midday
nudge, evening check-in, Friday planning, habit cues) and sends it to your phone. The keys were generated on
your Mac into `.secrets/` (never committed).

1. **Supabase → SQL Editor → New query**: paste all of `.secrets/push-setup.sql` (on your Mac), **Run**.
   It adds the push tables and the 5-minute schedule.
2. **Supabase → Edge Functions → Secrets** (or Project Settings → Edge Functions): add the three values
   from `.secrets/push-keys.json`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.
3. **Deploy from GitHub**: Supabase → your account (top right) → **Access Tokens** → *Generate new token*.
   GitHub → `abhishek17r/odyssey` → **Settings → Secrets and variables → Actions → New repository secret**:
   name `SUPABASE_ACCESS_TOKEN`, value the token. Then **Actions → Deploy push function → Run workflow**.
   From then on it redeploys by itself whenever its code changes.
4. **On the iPhone** (the home-screen app): **Me → Notifications → 🔔 Turn on push** → Allow → **Send a test**.

Times and switches are in Me → Notifications; habit cue times in This week → ✎ Edit habits. Once push is
on, the Chrome extension stops its own scheduled reminders (it keeps the session ones).

## How sync works

- Every device keeps its own full copy and works offline. Records (each day, ticket, session, plan …)
  sync one by one; the newest edit of a record wins. Timer sessions are separate records, so sessions
  from the phone and the laptop never overwrite each other.
- The first sync on a new device keeps the cloud's copy of anything both have, then uploads what only
  it has. A running focus session shows on both devices.
- Backups (Settings → Backups) stay on each device. **Erase everything** erases it on all signed-in
  devices too (a backup is kept on the computer you did it on).

## What the phone app does and doesn't do (for now)

- ✅ Focus timer (survives the app being closed: it stores times, not a running clock), today's habits and
  due tasks, morning check, reflection, sync. The dashboard tabs open too (best on a bigger screen).
- ✅ Keeps the screen awake while you're working; a notification when the session ends **while the app is open**.
- ⏳ Next: web push, so "session done", the morning brief and the day-end nudge arrive with the app closed.
- ❌ Not on the phone: the site blocker, Apple Health, Screen Time.

## 5. More people (each with their own private data)

1. Once: **Supabase → SQL Editor → New query**, paste all of `.secrets/upgrade-accounts.sql` (on your Mac), **Run**.
   It gives every record an account (your existing data stays yours) and makes push per account.
2. To add someone: **Authentication → Users → Add user → Create new user**: email `theirname@odyssey.test`,
   a password, tick **Auto Confirm User**. Send them the app link, username `theirname` and the password.
   (Or turn “Allow new users to sign up” back on and they can use “Create your account”.)
