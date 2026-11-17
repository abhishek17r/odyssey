// "Account & sync" panel: sign in with a username and password (or create the account the first time),
// see when you last synced, sync now, sign out. Used by the dashboard's Settings and the web app.

import { cloudOn, signIn, signUp, signOut, currentUser } from './cloud.js';
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
}

function signInView(box, onSignedIn) {
  let mode = 'in'; // 'in' | 'up'
  const form = el('form', { className: 'signin', autocomplete: 'on' });
  const username = el('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: 'Username', spellcheck: false, autocapitalize: 'none' });
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
      : 'Pick a username and password. This first account is the owner: only it can see your data. Your browser can save the password for you.';
    msg.textContent = '';
  };
  toggle.onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(); username.focus(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true; msg.className = 'small muted'; msg.textContent = mode === 'in' ? 'Signing in…' : 'Creating your account…';
    try {
      await (mode === 'in' ? signIn : signUp)(username.value, password.value);
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
  form.append(hint, username, password, el('div', { className: 'row', style: 'margin-top:4px;justify-content:space-between;flex-wrap:wrap' }, submit, toggle), msg);
  box.append(form);
}
