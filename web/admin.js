// The owner's admin page: who uses Odyssey, which features, and what Athena's AI costs, per feature and per
// account, with the caps. Reads one owner-only database function (odyssey_admin); nothing here is linked
// from the app. Open /admin.html, signed in as the owner.

import { signIn, currentUser, rpc, callFunction, cloudOn } from './lib/cloud.js';
import { HARBOURS } from './lib/harbours.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const usd = (n, d = 4) => `$${Number(n || 0).toFixed(d)}`;
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const ago = (t) => {
  if (!t) return '—';
  const m = (Date.now() - Date.parse(t)) / 60000;
  return m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const FEATURE = {
  app_open: 'Opened the app (once a day)', view: 'Switched tab', sheet: 'Opened Plan / Review / Rewards', habit_log: 'Logged a habit',
  task_add: 'Added a task', subtask_add: 'Added a subtask', task_edit: 'Edited a task', task_done: 'Finished a task', subtask_done: 'Finished a subtask',
  task_delete: 'Deleted a task', focus_start: 'Started focus', focus_end: 'Ended focus', urge: 'Urge pause', pause: 'Paused the app',
  market_claim: 'Claimed a reward', onboarding_done: 'Finished onboarding', onboarding_edit: 'Edited onboarding', athena_dismiss: 'Dismissed Athena’s line',
  proposal: 'Answered a suggestion', radio_play: 'Played focus radio',
};

let data = null;

async function load() {
  if (!cloudOn()) { $('#out').innerHTML = '<p class="err">No Supabase project in config.js.</p>'; return; }
  const me = await currentUser();
  $('#signin').hidden = !!me;
  $('#who').textContent = me ? `Signed in as ${me.username}` : '';
  if (!me) { $('#out').innerHTML = ''; return; }
  $('#out').innerHTML = '<p class="muted">Loading…</p>';
  try {
    data = await rpc('odyssey_admin', { days: Number($('#days').value) });
    render();
  } catch (e) {
    $('#out').innerHTML = `<p class="err">${esc(/owner only/i.test(e.message) ? 'This account isn’t the owner.' : /could not find|does not exist/i.test(e.message) ? 'Run supabase/ops.sql in the Supabase SQL Editor first.' : e.message)}</p>`;
  }
}

function bars(rows, key, fmt, cls = '') {
  const W = 600, H = 110, pad = 18;
  const max = Math.max(...rows.map((r) => Number(r[key]) || 0), 0.000001);
  const w = (W - 4) / Math.max(rows.length, 1);
  const rects = rows.map((r, i) => {
    const h = ((Number(r[key]) || 0) / max) * (H - pad);
    return `<rect x="${(i * w + 2).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${Math.max(1, w - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(r.day.slice(0, 10))}: ${esc(fmt(r[key]))}</title></rect>`;
  }).join('');
  const first = rows[0]?.day.slice(5, 10) || '', last = rows.at(-1)?.day.slice(5, 10) || '';
  return `<div class="chart ${cls}"><svg viewBox="0 0 ${W} ${H - pad}" preserveAspectRatio="none">${rects}</svg>
    <div class="axis"><span>${first}</span><span>peak ${esc(fmt(max))}</span><span>${last}</span></div></div>`;
}

function hints(d) {
  const out = [];
  const k = d.ai_by_kind;
  const calls = k.reduce((a, x) => a + Number(x.calls), 0);
  const cost = k.reduce((a, x) => a + Number(x.cost), 0);
  if (!calls) return ['No AI calls yet. Once the Athena job runs, cost per feature and per account shows up here.'];
  const rej = k.reduce((a, x) => a + Number(x.rejected), 0);
  const err = k.reduce((a, x) => a + Number(x.errors), 0);
  if (rej / calls > 0.1) out.push(`${Math.round((rej / calls) * 100)}% of answers fail the checks and are thrown away (paid for, not used). Tighten the prompt, or let more through.`);
  if (err / calls > 0.05) out.push(`${Math.round((err / calls) * 100)}% of calls error. See the recent calls below.`);
  const top = [...k].sort((a, b) => b.cost - a.cost)[0];
  if (top && cost > 0) out.push(`${top.kind} (${top.model}) is ${Math.round((top.cost / cost) * 100)}% of the spend at ${usd(top.cost_per_used, 5)} per note used.${top.model.includes('mini') ? ' Try routing it to the small model and compare rejections.' : ''}`);
  const tin = k.reduce((a, x) => a + Number(x.avg_in) * Number(x.calls), 0);
  const cin = k.reduce((a, x) => a + Number(x.cached_in), 0);
  if (tin) out.push(`${Math.round((cin / tin) * 100)}% of prompt tokens came from OpenAI’s cache (a tenth of the price). The shared system prompt is the part that caches.`);
  const gw = k.reduce((a, x) => a + Number(x.gateway_cache), 0);
  out.push(gw ? `${gw} calls were answered by the AI Gateway cache (free).` : 'The AI Gateway cache hasn’t answered anything: prompts carry personal facts, so they rarely repeat. The note cache (one note per draft) is doing the saving.');
  const active = Number(d.totals.active_30d) || Number(d.totals.users) || 1;
  const days = Math.max(1, d.daily.length);
  const perUserMonth = (cost / active) * (30 / days);
  out.push(`At this rate: about ${usd(perUserMonth, 4)} per active account a month. 1,000 accounts ≈ ${usd(perUserMonth * 1000, 2)} a month.`);
  return out;
}

function render() {
  const d = data, t = d.totals, c = d.config || {};
  const capFrac = Math.min(1, Number(t.ai_cost_month) / Math.max(0.0001, Number(c.monthly_cap_usd)));
  const maxUsers = Math.max(1, Number(t.users));
  const alerts = (d.recent_calls || []).filter((r) => String(r.detail || '').startsWith('cost alert'));
  $('#out').innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${num(t.users)}</b><small>accounts</small></div>
      <div class="tile"><b>${num(t.active_1d)} · ${num(t.active_7d)} · ${num(t.active_30d)}</b><small>active today · 7 days · 30 days</small></div>
      <div class="tile"><b>${num(t.events)}</b><small>feature events in the period</small></div>
      <div class="tile"><b>${num(t.ai_calls)}</b><small>AI calls in the period · ${usd(t.ai_cost)}</small></div>
      <div class="tile"><b>${usd(t.ai_cost_month, 3)}</b><small>AI this month, of ${usd(c.monthly_cap_usd, 2)} cap${c.enabled === false ? ' · AI OFF' : ''}</small>
        <div class="meter ${capFrac > 0.8 ? 'hot' : ''}"><i style="width:${(capFrac * 100).toFixed(1)}%"></i></div></div>
      <div class="tile"><b>${usd(t.ai_cost_today, 4)}</b><small>AI today</small></div>
      <div class="tile"><b>${num(alerts.length)}</b><small>cost alerts in recent calls (a call over ~3× its usual cost)</small></div>
    </div>

    <h2>Every day</h2>
    <div class="charts">
      <div class="card"><small class="muted">Active accounts</small>${bars(d.daily, 'users', (v) => num(v))}</div>
      <div class="card"><small class="muted">AI cost (US$)</small>${bars(d.daily, 'ai_cost', (v) => usd(v), 'cost')}</div>
    </div>

    <h2>AI cost by feature</h2>
    <div class="card"><table>
      <tr><th>Feature</th><th>Model</th><th class="n">Calls</th><th class="n">Used</th><th class="n">Rejected</th><th class="n">Errors</th><th class="n">Avg in / out</th><th class="n">Cached in</th><th class="n">Avg time</th><th class="n">Cost</th><th class="n">Per note used</th></tr>
      ${d.ai_by_kind.map((k) => `<tr><td>${esc(k.kind)}</td><td>${esc(k.model)}</td><td class="n">${num(k.calls)}</td><td class="n">${num(k.used)}</td><td class="n">${num(k.rejected)}</td><td class="n">${num(k.errors)}</td>
        <td class="n">${num(k.avg_in)} / ${num(k.avg_out)}</td><td class="n">${num(k.cached_in)}</td><td class="n">${k.avg_ms ? `${(k.avg_ms / 1000).toFixed(1)} s` : '—'}</td><td class="n">${usd(k.cost)}</td><td class="n">${k.cost_per_used == null ? '—' : usd(k.cost_per_used, 5)}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">No AI calls yet.</td></tr>'}
    </table></div>

    <h2>For planning: caching and routing</h2>
    <div class="card"><ul class="hints">${hints(d).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>

    <h2>Accounts</h2>
    <div class="card"><table>
      <tr><th>Account</th><th>Last seen</th><th>Last sync</th><th class="n">Days active</th><th class="n">Events</th><th class="n">Focus</th><th class="n">AI calls</th><th class="n">AI cost</th><th class="n">This month</th><th>App</th></tr>
      ${d.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${ago(u.last_seen)}</td><td>${ago(u.last_sync)}</td><td class="n">${num(u.days_active)}</td><td class="n">${num(u.events)}</td>
        <td class="n">${num(Math.round(u.focus_min))} min</td><td class="n">${num(u.ai_calls)}</td><td class="n">${usd(u.ai_cost)}</td><td class="n">${usd(u.ai_cost_month)}</td><td>${esc(u.version || '—')}</td></tr>`).join('')}
    </table></div>

    <h2>Features</h2>
    <div class="card"><table>
      <tr><th>Feature</th><th class="n">Events</th><th>Accounts using it</th><th>Last</th></tr>
      ${d.features.map((f) => `<tr><td>${esc(FEATURE[f.name] || f.name)} <span class="muted">${esc(f.name)}</span></td><td class="n">${num(f.events)}</td>
        <td><span class="bar" style="width:${Math.round((f.users / maxUsers) * 80)}px"></span>${num(f.users)}</td><td>${ago(f.last)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No events yet. They arrive from v0.6.0 on, from signed-in phones.</td></tr>'}
    </table>
    ${Object.keys(d.views).length ? `<p class="muted">Tabs and sheets opened: ${Object.entries(d.views).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${num(v)}`).join(' · ')}</p>` : ''}</div>

    <h2>AI caps</h2>
    <div class="card"><form class="caps" id="caps">
      <label>AI on<select name="enabled"><option value="true" ${c.enabled !== false ? 'selected' : ''}>On</option><option value="false" ${c.enabled === false ? 'selected' : ''}>Off (templates only)</option></select></label>
      <label>Monthly cap (US$)<input type="number" step="0.5" min="0" name="monthly_cap_usd" value="${esc(c.monthly_cap_usd)}" /></label>
      <label>Per account, 24 h (US$)<input type="number" step="0.001" min="0" name="user_daily_cap_usd" value="${esc(c.user_daily_cap_usd)}" /></label>
      ${c.user_monthly_cap_usd != null ? `<label>Per account, month (US$)<input type="number" step="0.01" min="0" name="user_monthly_cap_usd" value="${esc(c.user_monthly_cap_usd)}" /></label>` : '<p class="muted">Run supabase/guardrails.sql to add the per-account monthly cap.</p>'}
      <label>Skip accounts idle for (days)<input type="number" step="1" min="1" name="inactive_days" value="${esc(c.inactive_days)}" /></label>
      <button class="primary">Save caps</button>
      <button type="button" id="runNow">Run Athena now (my account)</button>
    </form><pre id="runOut" hidden></pre></div>

    <h2>Recent AI calls</h2>
    <div class="card"><table>
      <tr><th>When</th><th>Account</th><th>Feature</th><th>Model</th><th class="n">In / out</th><th class="n">Cost</th><th class="n">Time</th><th>Outcome</th></tr>
      ${d.recent_calls.map((r) => `<tr><td>${ago(r.at)}</td><td>${esc(r.user)}</td><td>${esc(r.kind)}</td><td>${esc(r.model)}</td><td class="n">${num(r.in)} / ${num(r.out)}</td><td class="n">${usd(r.cost, 5)}</td>
        <td class="n">${r.ms ? `${(r.ms / 1000).toFixed(1)} s` : '—'}</td><td><span class="tag ${esc(r.outcome)}" title="${esc(r.detail || '')}">${esc(r.outcome)}</span>${String(r.detail || '').startsWith('cost alert') ? ' <span class="tag error">cost alert</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">None yet.</td></tr>'}
    </table></div>`;

  $('#caps').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const cfg = Object.fromEntries([...f.entries()]);
    try { await rpc('odyssey_admin_set', { cfg }); await load(); } catch (err) { alert(err.message); }
  };
  loadRewards();
  $('#runNow').onclick = async () => {
    const out = $('#runOut');
    out.hidden = false;
    out.textContent = 'Running…';
    try { out.textContent = JSON.stringify(await callFunction('odyssey-athena', { force: true }), null, 2); load(); } catch (err) { out.textContent = err.message; }
  };
}

$('#signin').onsubmit = async (e) => {
  e.preventDefault();
  $('#signinErr').textContent = '';
  try { await signIn($('#u').value, $('#p').value); load(); } catch (err) { $('#signinErr').textContent = err.message; }
};
$('#refresh').onclick = load;
$('#days').onchange = load;
load();

// ---------- rewards at the voyage's harbours (supabase/voyage.sql) ----------
async function loadRewards() {
  const box = document.createElement('div');
  box.id = 'rewardsBox';
  document.querySelector('#rewardsBox')?.remove();
  $('#out').append(box);
  let r;
  try { r = await rpc('odyssey_rewards_admin', {}); } catch (e) {
    box.innerHTML = `<h2>Rewards at harbours</h2><div class="card"><p class="muted">${esc(/could not find|does not exist/i.test(e.message) ? 'Run supabase/voyage.sql in the Supabase SQL Editor first.' : e.message)}</p></div>`;
    return;
  }
  const opt = (i) => `<option value="${i + 1}">${i + 1} · ${esc(HARBOURS[i].name)}</option>`;
  box.innerHTML = `<h2>Rewards at harbours</h2>
    <div class="card"><p class="muted" style="margin-top:0">What each harbour unlocks on the voyage. “Everyone” shows to every account; pick an account for a reward of its own. Users can’t add or buy rewards.</p>
    <table><tr><th>Harbour</th><th>Reward</th><th>For</th><th></th></tr>
      ${r.rewards.map((x) => `<tr><td>${x.harbour} · ${esc(HARBOURS[x.harbour - 1]?.name || '')}</td><td>${esc(x.icon)} ${esc(x.name)}</td><td>${esc(x.user || 'Everyone')}</td>
        <td class="n"><button type="button" data-rm="${esc(x.id)}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet. The app falls back to its four built-in rewards.</td></tr>'}
    </table>
    <form class="caps" id="addReward" style="margin-top:12px">
      <label>Harbour<select name="harbour">${HARBOURS.map((_, i) => opt(i)).join('')}</select></label>
      <label>Icon<input name="icon" value="🎁" maxlength="4" style="width:64px" /></label>
      <label>Reward<input name="name" required maxlength="80" placeholder="e.g. New running shoes" /></label>
      <label>For<select name="user_id"><option value="">Everyone</option>${r.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>
      <button class="primary">Add reward</button>
    </form></div>`;
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this reward?')) return;
    try { await rpc('odyssey_rewards_set', { op: 'remove', r: { id: b.dataset.rm } }); loadRewards(); } catch (err) { alert(err.message); }
  }));
  box.querySelector('#addReward').onsubmit = async (e) => {
    e.preventDefault();
    const r2 = Object.fromEntries(new FormData(e.target).entries());
    try { await rpc('odyssey_rewards_set', { op: 'add', r: r2 }); loadRewards(); } catch (err) { alert(err.message); }
  };
}
