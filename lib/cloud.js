// Talking to Supabase with plain fetch: username + password sign-in (Supabase Auth), staying signed in
// (token refresh), and the two owner-only functions that read and write records.
// The session lives in local storage under `auth` (never exported, never synced).

import { CLOUD } from '../config.js';

export const cloudOn = () => !!(CLOUD.url && CLOUD.anonKey);
const base = () => CLOUD.url.replace(/\/$/, '');

async function call(path, { body, token, method = 'POST' } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { apikey: CLOUD.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const e = new Error(friendly(json?.msg || json?.error_description || json?.message || json?.error || `HTTP ${res.status}`));
    e.status = res.status;
    e.code = json?.error_code || json?.code;
    throw e;
  }
  return json;
}

// Supabase's messages, said plainly.
function friendly(m) {
  if (/invalid login credentials/i.test(m)) return 'Wrong username or password.';
  if (/user already registered/i.test(m)) return 'That username is taken. Sign in instead.';
  if (/email not confirmed/i.test(m)) return 'Supabase still wants email confirmation: turn off “Confirm email” (see SETUP.md), then try again.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'New accounts are switched off in Supabase. Sign in with your existing account.';
  if (/password should be at least/i.test(m)) return m.replace(/^.*?Password/i, 'Password');
  if (/not signed in/i.test(m)) return 'Your sign-in ended. Sign in again.';
  return m;
}

// "abhishek" → "abhishek@odyssey.test" (Supabase wants an email; .test is a reserved, never-mailed domain).
// A real email address is used as is.
export const toEmail = (u) => {
  const v = String(u || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@odyssey.test`;
};
export const toUsername = (email) => (email || '').replace(/@odyssey\.test$/, '');

const getAuth = async () => (await chrome.storage.local.get('auth')).auth || null;
const setAuth = (auth) => (auth ? chrome.storage.local.set({ auth }) : chrome.storage.local.remove('auth'));
const fromSession = (s, email) => ({
  access_token: s.access_token, refresh_token: s.refresh_token,
  expires_at: Date.now() + (Number(s.expires_in) || 3600) * 1000,
  user_id: s.user?.id || null, email: s.user?.email || email,
});

const validName = (u) => /^[a-z0-9._-]{3,40}$/i.test(String(u).trim()) || String(u).includes('@');

export async function signIn(username, password) {
  if (!validName(username)) throw new Error('Username: 3–40 letters, numbers, dots, dashes or underscores.');
  const email = toEmail(username);
  const s = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
  const auth = fromSession(s, email);
  await setAuth(auth);
  return auth;
}

export async function signUp(username, password) {
  if (!validName(username)) throw new Error('Username: 3–40 letters, numbers, dots, dashes or underscores.');
  if (String(password).length < 8) throw new Error('Use a password of at least 8 characters.');
  const email = toEmail(username);
  const s = await call('/auth/v1/signup', { body: { email, password } });
  if (!s?.access_token) throw new Error('Account created, but Supabase wants email confirmation first: turn off “Confirm email” (see SETUP.md), then sign in.');
  const auth = fromSession(s, email);
  await setAuth(auth);
  return auth;
}

// An invite or password-reset link lands on the app with the session in the address (#access_token=…&type=invite).
// → 'invite' | 'recovery' | null. Saves the session; the app then asks for a password.
export async function adoptLinkSession(hash = location.hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const access = p.get('access_token');
  if (!access) {
    if (p.get('error_description')) throw new Error(p.get('error_description').replace(/\+/g, ' '));
    return null;
  }
  const user = await call('/auth/v1/user', { method: 'GET', token: access });
  await setAuth({
    access_token: access, refresh_token: p.get('refresh_token'),
    expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
    user_id: user?.id || null, email: user?.email || '',
  });
  return p.get('type') || 'magiclink';
}

export async function setPassword(password) {
  if (String(password).length < 8) throw new Error('Use a password of at least 8 characters.');
  await call('/auth/v1/user', { method: 'PUT', body: { password }, token: await token() });
}

// Sends a reset link (needs a real email and the project's SMTP set up).
export async function sendReset(email) {
  if (!String(email).includes('@') || /@odyssey\.test$/i.test(email)) throw new Error('Password resets need a real email address. Ask the owner to reset it in Supabase.');
  await call('/auth/v1/recover', { body: { email: toEmail(email) } });
}

export const signOut = async () => { await setAuth(null); await chrome.storage.local.remove('syncMeta'); };
export const currentUser = async () => { const a = await getAuth(); return a ? { username: toUsername(a.email), id: a.user_id } : null; };

// A valid access token, refreshed when it's about to expire. null when signed out.
let refreshing = null;
export async function token() {
  const a = await getAuth();
  if (!a) return null;
  if (a.expires_at - Date.now() > 60000) return a.access_token;
  refreshing ??= call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: a.refresh_token } })
    .then(async (s) => { const n = fromSession(s, a.email); await setAuth(n); return n.access_token; })
    .catch(async (e) => { if (e.status === 400 || e.status === 401) await setAuth(null); throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ---------- the records API used by sync.js ----------

export const api = {
  async push(rows) {
    if (!rows.length) return 0;
    const t = await token();
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) n += await call('/rest/v1/rpc/odyssey_push', { body: { rows: rows.slice(i, i + 500) }, token: t });
    return n;
  },
  // Rows changed on the server since `since` (ISO), oldest first, all pages.
  async pull(since) {
    const t = await token();
    const out = [];
    for (let page_offset = 0; ; page_offset += 1000) {
      const page = await call('/rest/v1/rpc/odyssey_pull', { body: { since: since || null, page_offset }, token: t });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  },
};

// ---------- owner-only database functions and Edge Functions ----------

export async function rpc(fn, body) {
  return call(`/rest/v1/rpc/${fn}`, { body, token: await token() });
}

export async function callFunction(name, body = {}) {
  return call(`/functions/v1/${name}`, { body, token: await token() });
}
