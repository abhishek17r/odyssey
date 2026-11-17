// "Account & sync" panel: sign in with a username and password (or create the account the first time),
// see when you last synced, sync now, sign out. Used by the dashboard's Settings and the web app.

import { cloudOn, signIn, signUp, signOut, currentUser, rpc, callFunction, sendReset } from './cloud.js';
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
  // the owner can invite people by email
  rpc('odyssey_is_owner', {}).then((isOwner) => { if (isOwner) box.append(inviteRow()); }).catch(() => {});
}

function inviteRow() {
  const form = el('form', { className: 'inviteRow' });
  const email = el('input', { type: 'email', placeholder: 'their@email.com', autocomplete: 'off', required: true });
  const go = el('button', { type: 'submit', textContent: 'Invite' });
  const msg = el('div', { className: 'small muted', textContent: 'They get an email with a link to set their password. Each account’s data is private.' });
  form.onsubmit = async (e) => {
    e.preventDefault();
    go.disabled = true; msg.className = 'small muted'; msg.textContent = 'Sending…';
    try {
      const r = await callFunction('odyssey-invite', { email: email.value });
      msg.textContent = r?.pending
        ? `✓ Sending to ${email.value}. The mail server is slow: it should arrive in a minute (check Spam).`
        : `✓ Invite ${r?.resent ? 're-sent' : 'sent'} to ${email.value}. Ask them to check Spam too.`;
      email.value = '';
    } catch (err) {
      msg.className = 'small error';
      msg.textContent = /timeout|upstream/i.test(err.message)
        ? 'The mail server took too long. The invite may still arrive; if not, invite again in a few minutes.'
        : /error sending|smtp|rate limit/i.test(err.message) ? `Couldn’t send the email (${err.message}). Check the SMTP settings in Supabase → Authentication → Emails.` : err.message;
    }
    go.disabled = false;
  };
  return el('div', { className: 'inviteBox' }, el('div', { className: 'lbl small', textContent: '✉️ Invite someone' }), el('div', { className: 'row' }, email, go), msg);
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
