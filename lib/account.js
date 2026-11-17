// "Account & sync" panel: sign in with a username and password (or create the account the first time),
// see when you last synced, sync now, sign out. Used by the dashboard's Settings and the web app.

import { cloudOn, signIn, signUp, signOut, currentUser, rpc, callFunction, sendReset, setPassword, CLOUD_APP_URL } from './cloud.js';
import { DEVICE_KEYS } from './storage.js';

// Remove everything but this device's own keys (sign-in, backups), without syncing the removal anywhere.
export async function clearForAccount() {
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => !DEVICE_KEYS.includes(k) || k === 'syncMeta' || k === 'dataOwner');
  await chrome.storage.local.remove(drop);
}
import { syncNow } from './syncRunner.js';
import { el, toast } from './controls.js';

const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 10 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export async function renderAccount(box, { onSignedIn } = {}) {
  box.innerHTML = '';
  if (!cloudOn()) {
    box.append(el('p', { className: 'muted small', innerHTML: 'Cloud sync isn’t set up. Add your Supabase URL and key to <code>config.js</code> (see <code>SETUP.md</code>), then reload.' }));
    return;
  }
  const user = await currentUser();
  return user ? signedInView(box, user, onSignedIn) : signInView(box, onSignedIn);
}

async function signedInView(box, user, onSignedIn) {
  const { syncMeta } = await chrome.storage.local.get('syncMeta');
  const status = el('div', { className: 'small muted' });
  const draw = (m) => {
    status.innerHTML = m?.error ? `<span class="error">⚠️ ${m.error}</span>${m.at ? ` · last good sync ${ago(m.at)}` : ''}` : m?.at ? `✓ Synced ${ago(m.at)}` : 'Not synced yet';
  };
  draw(syncMeta);
  const now = el('button', { type: 'button', className: 'primary', textContent: '↻ Sync now' });
  now.onclick = async () => {
    now.disabled = true; now.textContent = 'Syncing…';
    const r = await syncNow();
    now.disabled = false; now.textContent = '↻ Sync now';
    draw((await chrome.storage.local.get('syncMeta')).syncMeta);
    toast(r.status === 'ok' ? `Synced${r.applied ? ` · ${r.applied} update${r.applied > 1 ? 's' : ''} in` : ''}` : r.status === 'signedOut' ? 'Signed out. Sign in again' : r.error || 'Sync failed', r.status === 'ok' ? 'ok' : 'err');
    if (r.status === 'signedOut') renderAccount(box, { onSignedIn });
  };
  const out = el('button', { type: 'button', className: 'ghost', textContent: 'Sign out' });
  out.onclick = async () => {
    if (!confirm('Sign out on this device? Your data stays here and in your account.')) return;
    await signOut();
    renderAccount(box, { onSignedIn });
  };
  box.append(el('div', { className: 'acct' },
    el('div', { className: 'acctAvatar', textContent: (user.username || '?')[0].toUpperCase() }),
    el('div', { className: 'acctMain' }, el('b', { textContent: user.username }), status),
    now, out));
  box.append(passwordRow());
  // the owner can add people
  rpc('odyssey_is_owner', {}).then((isOwner) => { if (isOwner) box.append(addSomeoneRow()); }).catch(() => {});
}

// Change your password (e.g. the one you were given).
export function passwordRow() {
  const open = el('a', { className: 'small', textContent: '🔑 Change password' });
  const form = el('form', { className: 'inviteBox', hidden: true });
  const pw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (8+ characters)' });
  const pw2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Once more' });
  const go = el('button', { type: 'submit', className: 'primary', textContent: 'Save' });
  const msg = el('div', { className: 'small muted' });
  open.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) pw.focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (pw.value !== pw2.value) { msg.className = 'small error'; msg.textContent = 'The two don’t match.'; return; }
    go.disabled = true;
    try { await setPassword(pw.value); msg.className = 'small ok'; msg.textContent = '✓ Password changed. Your browser can save the new one.'; pw.value = pw2.value = ''; }
    catch (err) { msg.className = 'small error'; msg.textContent = err.message; }
    go.disabled = false;
  };
  form.append(el('div', { className: 'stackInputs' }, pw, pw2), go, msg);
  return el('div', { className: 'pwRow' }, open, form);
}

// Owner: make an account for someone (username + password, no email), then send them the details.
const makePassword = () => {
  const words = ['sail', 'wind', 'oar', 'star', 'wave', 'isle', 'bay', 'reef', 'gull', 'mast', 'tide', 'dawn'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  return `${pick()}-${pick()}-${1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)}`;
};
export function addSomeoneRow() {
  const form = el('form', { className: 'inviteBox' });
  const user = el('input', { type: 'text', placeholder: 'Their username', autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const pw = el('input', { type: 'text', value: makePassword(), autocomplete: 'off', spellcheck: false, autocapitalize: 'none' });
  const go = el('button', { type: 'submit', className: 'primary', textContent: 'Create account' });
  const msg = el('div', { className: 'small muted', textContent: 'They sign in with these, then can change the password under Account & sync. Their data is private to them.' });
  const share = el('div', { className: 'shareBox', hidden: true });
  let reset = false;
  const mode = el('a', { className: 'small', textContent: 'Someone forgot their password?' });
  const head = el('div', { className: 'lbl small', textContent: '👤 Add someone' });
  mode.onclick = () => {
    reset = !reset;
    go.textContent = reset ? 'Set new password' : 'Create account';
    mode.textContent = reset ? 'Add someone new instead' : 'Someone forgot their password?';
    head.textContent = reset ? '🔑 Reset someone’s password' : '👤 Add someone';
    msg.className = 'small muted'; share.hidden = true;
    msg.textContent = reset ? 'Type their username and a new password, then send it to them.' : 'They sign in with these, then can change the password under Account & sync. Their data is private to them.';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    go.disabled = true; msg.className = 'small muted'; msg.textContent = 'Creating…';
    const u = user.value.trim().toLowerCase();
    try {
      await callFunction('odyssey-invite', { username: u, password: pw.value, reset });
      const text = reset ? `Your new Odyssey password ⛵\nUsername: ${u}\nPassword: ${pw.value}\nYou can change it after signing in (Me → Account & sync).` : `You're invited to Odyssey ⛵\nOpen ${CLOUD_APP_URL} (on iPhone: Safari → Share → Add to Home Screen), then Me → Sign in.\nUsername: ${u}\nPassword: ${pw.value}\nYou can change the password after signing in.`;
      msg.className = 'small ok'; msg.textContent = reset ? `✓ New password set for “${u}”. Send it to them:` : `✓ Account “${u}” created. Send them the details:`;
      share.hidden = false;
      share.innerHTML = '';
      const pre = el('pre', { textContent: text });
      const copy = el('button', { type: 'button', textContent: '📋 Copy' });
      copy.onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', 'err'); } };
      share.append(pre, el('div', { className: 'row', style: 'gap:8px' }, copy, ...(navigator.share ? [Object.assign(el('button', { type: 'button', textContent: '↗ Share' }), { onclick: () => navigator.share({ text }).catch(() => {}) })] : [])));
      user.value = ''; pw.value = makePassword();
    } catch (err) {
      msg.className = 'small error'; msg.textContent = err.message;
    }
    go.disabled = false;
  };
  form.append(head, el('div', { className: 'stackInputs' }, user, pw), go, msg, share, el('div', { style: 'margin-top:8px' }, mode));
  return form;
}

function signInView(box, onSignedIn) {
  let mode = 'in'; // 'in' | 'up'
  const form = el('form', { className: 'signin', autocomplete: 'on' });
  const username = el('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: 'Username or email', spellcheck: false, autocapitalize: 'none' });
  const password = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const submit = el('button', { type: 'submit', className: 'primary' });
  const toggle = el('a', { className: 'small' });
  const hint = el('p', { className: 'small muted', style: 'margin:0 0 10px' });
  const msg = el('div', { className: 'small', style: 'min-height:1.2em;margin-top:8px' });
  const draw = () => {
    submit.textContent = mode === 'in' ? 'Sign in' : 'Create account';
    toggle.textContent = mode === 'in' ? 'First time? Create your account' : 'Have an account? Sign in';
    password.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
    password.placeholder = mode === 'in' ? 'Password' : 'Password (8+ characters)';
    hint.textContent = mode === 'in'
      ? 'Sign in to sync this device with your others.'
      : 'Pick a username and password. Your data is private to your account. (If new accounts are switched off, ask whoever runs this Odyssey to make you one.)';
    msg.textContent = '';
  };
  toggle.onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(); username.focus(); };
  const forgot = el('a', { className: 'small', textContent: 'Forgot password?' });
  forgot.onclick = async () => {
    msg.className = 'small muted'; msg.textContent = 'Sending a reset link…';
    try { await sendReset(username.value.trim()); msg.textContent = `✓ Check ${username.value.trim()} for a reset link.`; }
    catch (err) { msg.className = 'small error'; msg.textContent = err.message; }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true; msg.className = 'small muted'; msg.textContent = mode === 'in' ? 'Signing in…' : 'Creating your account…';
    try {
      const auth = await (mode === 'in' ? signIn : signUp)(username.value, password.value);
      // this device has someone else's data: clear it here first (their account keeps its copy)
      const { dataOwner } = await chrome.storage.local.get('dataOwner');
      if (dataOwner && auth.user_id && dataOwner !== auth.user_id) {
        if (!confirm('This device has another account’s data. Remove it from this device and load yours? (It stays safe in that account.)')) {
          await signOut();
          throw new Error('Signed out again: this device keeps the other account’s data.');
        }
        await clearForAccount();
      }
      if (auth.user_id) await chrome.storage.local.set({ dataOwner: auth.user_id });
      msg.textContent = 'Signed in. Syncing…';
      const r = await syncNow();
      if (r.status === 'error') throw new Error(r.error);
      toast(mode === 'in' ? 'Signed in and synced' : 'Account created and synced');
      onSignedIn?.();
      renderAccount(box, { onSignedIn });
    } catch (err) {
      msg.className = 'small error'; msg.textContent = err.message; submit.disabled = false;
    }
  };
  draw();
  form.append(hint, username, password, el('div', { className: 'row', style: 'margin-top:4px;justify-content:space-between;flex-wrap:wrap;gap:8px' }, submit, el('div', { className: 'row', style: 'gap:14px;flex-wrap:wrap' }, forgot, toggle)), msg);
  box.append(form);
}
