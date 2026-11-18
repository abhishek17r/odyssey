// The account panel: sign in with the username and password you were given, change your password, sign out.
// (Sync runs quietly in the background: see syncRunner.js.) Used by the dashboard's Settings and the web app.
// Accounts are made in Supabase (Authentication → Users → Add user); there's no sign-up or invite in the app.

import { cloudOn, signIn, signOut, currentUser, setPassword } from './cloud.js';
import { DEVICE_KEYS } from './storage.js';

// Remove everything but this device's own keys (sign-in, backups), without syncing the removal anywhere.
export async function clearForAccount() {
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => !DEVICE_KEYS.includes(k) || k === 'syncMeta' || k === 'dataOwner');
  await chrome.storage.local.remove(drop);
}
import { syncNow } from './syncRunner.js';
import { el, toast } from './controls.js';

const _ago = (ms) => {
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

// Signed in: just who you are, Sign out, Change password. Syncing happens quietly in the background
// (it powers push, Athena and multiple devices); people never need to think about it.
async function signedInView(box, user, onSignedIn) {
  const out = el('a', { className: 'small acctOut', textContent: 'Sign out' });
  out.onclick = async () => {
    if (!confirm('Sign out on this device? Your data stays in your account.')) return;
    await signOut();
    renderAccount(box, { onSignedIn });
  };
  box.append(el('div', { className: 'acct quiet' },
    el('div', { className: 'acctAvatar', textContent: (user.username || '?')[0].toUpperCase() }),
    el('div', { className: 'acctMain' }, el('b', { textContent: user.username }), el('div', { className: 'small muted', textContent: 'Signed in' })),
    out));
  box.append(passwordRow());
}

// Change your password (e.g. the one you were given).
function passwordRow() {
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

function signInView(box, onSignedIn) {
  const form = el('form', { className: 'signin', autocomplete: 'on' });
  const username = el('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: 'Username', spellcheck: false, autocapitalize: 'none' });
  const password = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const submit = el('button', { type: 'submit', className: 'primary', textContent: 'Sign in' });
  const hint = el('p', { className: 'small muted', style: 'margin:0 0 10px', textContent: 'Sign in with the username and password you were given. Need an account, or forgot your password? Ask whoever runs this Odyssey.' });
  const msg = el('div', { className: 'small', style: 'min-height:1.2em;margin-top:8px' });
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true; msg.className = 'small muted'; msg.textContent = 'Signing in…';
    try {
      const auth = await signIn(username.value, password.value);
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
      toast('Signed in and synced');
      onSignedIn?.();
      renderAccount(box, { onSignedIn });
    } catch (err) {
      msg.className = 'small error'; msg.textContent = err.message; submit.disabled = false;
    }
  };
  form.append(hint, username, password, el('div', { className: 'row', style: 'margin-top:4px' }, submit), msg);
  box.append(form);
}
