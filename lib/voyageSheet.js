// The voyage in the app: the Week card, the voyage sheet (on course or on a peril), "How Kleos works", and the
// two moments (reaching a harbour, blown off course). Kleos earned is the only number. Rewards are set by the
// owner (admin page); here they're only shown and claimed.

import { sail, harbourRewards, HARBOURS, PERILS } from './sail.js';
import { POINTS, VOYAGE } from '../rewards.config.js';
import { el, openDrawer, toast } from './controls.js';
import { load, save } from './storage.js';
import { galley } from './figures.js';
import { esc } from './ui.js';
import { parseKey } from './score.js';
import { track } from './usage.js';

const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'short' });
// a peril: a dark rock with one eye
export const perilIcon = (s = 34) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64" aria-hidden="true"><path d="M4 50 Q12 26 26 22 Q36 14 46 24 Q58 30 60 50 Z" fill="#4a4f5c"/><ellipse cx="34" cy="34" rx="7" ry="4.5" fill="#f4e7c8"/><circle cx="34" cy="34" r="2.6" fill="#2a2420"/><path d="M2 52 Q16 48 32 52 T62 52" stroke="#7d8fa3" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
const bar = (pct, cls = '') => `<span class="vyBar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;

// How many days to the next harbour at your usual pace (last 4 weeks), or null.
function paceDays(v, state) {
  const perDay = Math.max(0, v.earned / Math.max(7, Math.min(28, (Date.now() - parseKey(POINTS.start).getTime()) / 864e5)));
  return perDay > 1 ? Math.max(1, Math.round(v.toNext / perDay)) : null;
}

// ---------- the Week card ----------
export function weekCard(btn, state, today, rewards) {
  const v = sail(state, today);
  const R = harbourRewards(v, rewards, state.settings.claims);
  if (v.peril) {
    const p = v.peril;
    btn.className = 'voyageStrip vyCard peril';
    btn.innerHTML = `<span class="vyIcon">${perilIcon(34)}</span><span class="vyMain"><span class="vyTop"><b>${esc(p.name)}</b><span>${p.progress.have} of ${p.progress.need}</span></span>
      ${bar((100 * p.progress.have) / p.progress.need, 'storm')}<small>${esc(p.trial.text.replace(' this week', ''))} by ${fmt(p.by)} to sail back</small></span><span class="chev">›</span>`;
  } else {
    const waiting = R.filter((r) => r.here === v.nextIndex && !r.unlocked).length;
    btn.className = 'voyageStrip vyCard';
    btn.innerHTML = `<span class="vyIcon">${galley(34)}</span><span class="vyMain"><span class="vyTop"><b>${esc(v.at.name)}</b><span>${v.toNext} ⚡ to ${esc(v.next.name)}</span></span>
      ${bar(v.pct, 'gold')}<small>Harbour ${v.harbour + 1} of 12${waiting ? ` · ${waiting} reward${waiting > 1 ? 's' : ''} waiting there` : ''}</small></span><span class="chev">›</span>`;
  }
  btn.ariaLabel = v.peril ? `On ${v.peril.name}: ${v.peril.trial.text}` : `At ${v.at.name}, ${v.toNext} Kleos to ${v.next.name}`;
  return v;
}

// ---------- the voyage sheet ----------
export function openVoyage({ getState, today, getRewards, onChanged = () => {} }) {
  const body = el('div', { className: 'vySheet' });
  const d = openDrawer('Your voyage', body);
  const draw = () => {
    const state = getState();
    const v = sail(state, today);
    const R = harbourRewards(v, getRewards(), state.settings.claims);
    body.innerHTML = '';
    body.append(el('p', { className: 'vySub', textContent: `${v.earned.toLocaleString('en-IN')} ⚡ earned${v.voyageNo > 1 ? ` · voyage ${v.voyageNo}` : ''}` }));
    const nextItems = R.filter((r) => r.here === v.nextIndex);
    if (v.peril) {
      const p = v.peril;
      body.append(el('section', { className: 'card vyHero peril', innerHTML: `<span class="vyBig">${perilIcon(64)}</span><small>Blown off course · day ${p.day}</small><h3>${esc(p.name)}</h3>
        <div class="vyRow"><span>Your way out: <b>${esc(p.trial.text.replace(' this week', ''))}</b></span><span class="muted">${p.progress.have} of ${p.progress.need} · by ${fmt(p.by)}</span></div>${bar((100 * p.progress.have) / p.progress.need, 'storm')}
        <p class="small muted">Pass it and you sail back on course, +${VOYAGE.escapeBonus} ⚡ and the laurel “${esc(p.laurel)}”. Miss it and next week’s trial is a little smaller.</p>` }));
      body.append(el('section', { className: 'card vyHold', innerHTML: `<span class="vyIcon">${galley(30)}</span><span class="vyMain"><span class="vyTop"><span>Then <b>${esc(v.next.name)}</b></span><span class="muted">${v.toNext} ⚡ · on hold</span></span>${bar(v.pct, 'hold')}</span>` }));
      body.append(el('p', { className: 'small muted vyNote', textContent: 'Your harbours and rewards stay yours. Only the sailing waits.' }));
    } else {
      const days = paceDays(v, state);
      body.append(el('section', { className: 'card vyHero', innerHTML: `<span class="vyBig">${galley(60)}</span><small>Harbour ${v.harbour + 1} of 12</small><h3>${esc(v.at.name)}</h3>
        <div class="vyRow"><span>Next: <b>${esc(v.next.name)}</b></span><span class="muted">${v.toNext} ⚡ to go</span></div>${bar(v.pct, 'gold')}
        ${nextItems.length ? `<p class="small muted">Waiting there${days ? ` · about ${days} day${days > 1 ? 's' : ''} at your pace` : ''}</p>${nextItems.map((r) => `<div class="vyItem"><span>${esc(r.icon)}</span><b>${esc(r.name)}</b></div>`).join('')}` : ''}` }));
    }
    // rewards you've reached and not claimed yet
    const open = R.filter((r) => r.unlocked && !r.claimed);
    if (open.length) {
      const box = el('div', { className: 'iosGroup vyClaims' });
      for (const r of open) {
        const b = el('button', { type: 'button', className: 'soft small', textContent: 'I got it ✓' });
        b.onclick = async () => { await claim(r.id); track('market_claim'); toast(`${r.name}: enjoy it`); onChanged(); draw(); };
        box.append(el('div', { className: 'cell static' }, el('span', { className: 'cIcon', textContent: r.icon }), el('span', { className: 'cMain' }, el('b', { textContent: r.name }), el('small', { textContent: `Unlocked at ${HARBOURS[r.here].name}` })), b));
      }
      body.append(el('div', { className: 'groupHead', textContent: 'Yours to claim' }), box);
    }
    // the next three harbours, with their rewards
    const ahead = el('div', { className: 'iosGroup vyAhead' });
    for (let i = 1; i <= 3; i++) {
      const idx = (v.harbour + 1 + i) % HARBOURS.length;
      if (idx === 0) break;
      const icons = R.filter((r) => r.here === idx).map((r) => r.icon).join(' ');
      ahead.append(el('div', { className: 'cell static' }, el('span', { className: 'cMain' }, el('span', { textContent: HARBOURS[idx].name })), el('span', { className: 'vyIcons', textContent: icons })));
    }
    if (ahead.childElementCount) body.append(el('div', { className: 'groupHead', textContent: 'Ahead' }), ahead);
    const behind = v.harbour + (v.voyageNo - 1) * 12;
    const claimed = R.filter((r) => r.claimed).length;
    const how = el('button', { type: 'button', className: 'linkBtn', textContent: 'How Kleos works ›' });
    how.onclick = () => rules();
    body.append(el('p', { className: 'small muted vyNote', textContent: `${behind} harbour${behind === 1 ? '' : 's'} behind you${claimed ? ` · ${claimed} reward${claimed > 1 ? 's' : ''} claimed` : ''}` }), how);
  };
  const rules = () => {
    body.innerHTML = '';
    const back = el('button', { type: 'button', className: 'linkBtn backLink', textContent: '‹ Your voyage' });
    back.onclick = draw;
    const row = (k, v2, cls) => `<div class="cell static"><span class="cMain"><span>${k}</span></span><b class="${cls}">${v2}</b></div>`;
    body.append(back, el('p', { className: 'vySub', textContent: 'Earned by doing, never by planning' }),
      el('div', { className: 'groupHead', textContent: 'Earn' }),
      el('div', { className: 'iosGroup vyRules', innerHTML: [
        ['A habit kept for the day', `+${POINTS.habitDone}`], ['A habit’s week on target', `+${POINTS.weekTargetMet}`], ['Back the day after a miss', `+${POINTS.comeback}`],
        ['A task finished', `+${POINTS.taskDone} to +${POINTS.taskDone + POINTS.sizeBonusMax}`], ['…by its deadline', `+${POINTS.onTime}`],
        ['25 minutes of focus', `+${POINTS.per25MinFocus}`], ['Started within 2 minutes', `+${POINTS.quickStart}`]].map(([k, v2]) => row(k, v2, 'gain')).join('') }),
      el('div', { className: 'groupHead', textContent: 'Lose' }),
      el('div', { className: 'iosGroup vyRules', innerHTML: [
        ['A planned day, nothing logged', `${POINTS.habitMissedPlannedDay}`], ['Skipped, and you said so', `${POINTS.habitSkipped}`],
        ['Over a limit', `${POINTS.limitSlightlyOver} to ${POINTS.limitBroken}`], ['A task past its deadline', `${POINTS.overduePerDay} a day`]].map(([k, v2]) => row(k, v2.replace('-', '−').replace('to -', 'to −'), 'loss')).join('') }),
      el('p', { className: 'small muted vyNote', textContent: `A good week sails you to the next harbour. A week below zero is a storm: you’re blown to a peril until you pass its trial. Food and rule habits, and paused days, never cost Kleos. At most ${POINTS.dailyCap} a day. Harbours and rewards are never taken back.` }));
  };
  draw();
  return d;
}

async function claim(id) {
  const st = await load();
  st.settings.claims = { ...(st.settings.claims || {}), [id]: Date.now() };
  await save({ settings: st.settings });
}

// ---------- the moments: a harbour reached, or blown to a peril (each shown once) ----------
// → the newest unseen moment, or null. Seen ones are remembered in settings.voyageSeen.
export function pendingMoment(state, today) {
  const v = sail(state, today);
  const m = [...v.log].reverse().find((l) => l.type === 'harbour' || l.type === 'storm');
  if (!m) return null;
  const weekAgo = new Date(parseKey(today).getTime() - 7 * 864e5).toISOString().slice(0, 10);
  if (m.day < weekAgo) return null; // old news
  if (m.type === 'storm' && !v.peril) return null; // already out
  const id = `${m.day}|${m.type}|${m.index ?? m.peril}`;
  const seen = state.settings.voyageSeen || '';
  if (seen === id || seen.split('|')[0] > m.day) return null;
  return { ...m, id, v };
}

export function showMoment(m, { state, rewards, onDone = () => {} }) {
  const R = harbourRewards(m.v, rewards, state.settings.claims);
  const root = el('div', { className: `vyMoment ${m.type}`, role: 'dialog', ariaLabel: m.type === 'harbour' ? 'Harbour reached' : 'Blown off course' });
  let card;
  if (m.type === 'harbour') {
    const H = HARBOURS[m.index];
    const items = R.filter((r) => r.here === m.index);
    root.innerHTML = `<div class="vmSky"></div><div class="vmSea"></div><div class="vmSun"></div><div class="vmShip">${galley(72)}</div>
      <div class="vmText"><small>Harbour ${m.index + 1} of 12</small><h2>You reached ${esc(H.name)}</h2><p>${esc(H.line)}</p></div>`;
    card = el('div', { className: 'vmCard' },
      items.length ? el('span', { className: 'vmLabel', textContent: `${items.length} reward${items.length > 1 ? 's' : ''} unlocked` }) : el('span', { className: 'vmLabel', textContent: 'Fair winds. On to the next harbour.' }),
      ...items.map((r) => el('div', { className: 'vmItem', innerHTML: `<span>${esc(r.icon)}</span><b>${esc(r.name)}</b>` })),
      el('p', { className: 'small muted', textContent: items.length ? 'Claim each one in Your voyage when you have it.' : `Next: ${HARBOURS[(m.index + 1) % 12].name}.` }));
  } else {
    const P = PERILS.find((p) => p.id === m.peril) || PERILS[0];
    root.innerHTML = `<div class="vmSky storm"></div><div class="vmSea storm"></div><div class="vmRain"></div><div class="vmRock">${perilIcon(120)}</div><div class="vmShip tossed">${galley(52)}</div>
      <div class="vmText"><small>A stormy week · ${String(m.net).replace('-', '−')} ⚡ net</small><h2>Blown to ${esc(P.name.replace(/^The /, 'the '))}</h2><p>${esc(P.line)}</p></div>`;
    card = el('div', { className: 'vmCard' },
      el('div', { className: 'vmTrial', innerHTML: `<small>Your way out, by Friday</small><b>${esc(m.trial.text)}</b><span>Pass it and you’re back on course, +${VOYAGE.escapeBonus} ⚡ and a laurel.</span>` }),
      el('p', { className: 'small muted', textContent: 'While you’re here, the ship can’t sail on. Nothing you’ve earned is lost.' }));
  }
  const go = el('button', { type: 'button', className: 'primary', textContent: m.type === 'harbour' ? 'Sail on' : 'Take on the trial' });
  card.append(go);
  root.append(card);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('in'));
  const close = async () => {
    root.classList.remove('in');
    setTimeout(() => root.remove(), 300);
    const st = await load();
    st.settings.voyageSeen = m.id;
    await save({ settings: st.settings });
    track('voyage_moment', { t: m.type });
    onDone();
  };
  go.onclick = close;
}
