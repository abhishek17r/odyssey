// The Journey: the voyage as a map (Journey tab), the slim strip on Today, and the side-quest cards.
// Everything here draws from sail() and quests.js; nothing is stored.

import { sail, harbourRewards, HARBOURS } from './sail.js';
import { offers, progress, questsOf } from './quests.js';
import { paceDays, perilIcon } from './voyageSheet.js';
import { esc } from './ui.js';
import { parseKey } from './score.js';

const fmt = (k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const ship = (s = 18) => `<svg class="jyShip" width="${s}" height="${s}" viewBox="0 0 26 24" aria-hidden="true"><path d="M3 16h20l-3 5H6z" fill="#e3b768"/><path d="M13 2v13M13 3l7 10h-7" fill="#fff" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

// Today's strip: where the ship is, Kleos to the next harbour, and what today's quest would do.
export function voyageStrip(btn, state, today, rewards) {
  const v = sail(state, today);
  const q = questsOf(state).active;
  if (v.peril) {
    const p = v.peril;
    btn.className = 'jyStrip peril';
    btn.innerHTML = `<div class="jsTop"><span>A STORM · ${esc(p.name.toUpperCase())}</span><span>${p.progress.have} of ${p.progress.need} ⚡ today</span></div>
      <div class="jsLine">The ship waits out a hard week. One good day, two things done, and you sail on. Nothing is lost.</div>`;
  } else {
    const days = paceDays(v, state);
    btn.className = 'jyStrip';
    btn.innerHTML = `<div class="jsTop"><span>THE VOYAGE · HARBOUR ${v.harbour + 1} OF 12</span><span>+${v.week} Kleos this week</span></div>
      <div class="jsRoute"><b>${esc(v.at.name)}</b><span class="jsTrack"><i style="width:${v.pct}%"></i><span style="left:${v.pct}%">${ship(24)}</span></span><b>${esc(v.next.name)}</b></div>
      <div class="jsLine">${v.toNext} ⚡ to ${esc(v.next.name)}${days ? `, about ${days} day${days > 1 ? 's' : ''} at your pace` : ''}${q ? `. Your quest pays +${q.pts} ⚡` : ''}.</div>`;
  }
  btn.ariaLabel = v.peril ? `Waiting out a storm at ${v.peril.name}` : `At ${v.at.name}, ${v.toNext} Kleos to ${v.next.name}. Open the journey.`;
  return v;
}

// The Journey tab's map: where you've been, the ship at sea, the next harbour (and its reward), what's after.
export function journeyMap(box, state, today, rewards) {
  const v = sail(state, today);
  const R = harbourRewards(v, rewards, state.settings?.claims);
  const reward = R.filter((r) => r.here === v.nextIndex && !r.unlocked).map((r) => `${esc(r.icon)} ${esc(r.name)}`).join(', ');
  const days = paceDays(v, state);
  const port = (dot, name, line, cls = '') => `<div class="jyPort ${cls}"><span class="jyRail">${dot}<em></em></span><div><b>${name}</b><small>${line}</small></div></div>`;
  const left = HARBOURS.length - 2 - v.harbour;
  box.className = `jyMap ${v.peril ? 'peril' : ''}`;
  box.innerHTML = v.peril
    ? port('<i class="on"></i>', esc(v.at.name), `Your last harbour. ${esc(v.at.line)}`)
      + port(`<span class="jyIco">${perilIcon(20)}</span>`, `A storm at ${esc(v.peril.name)}`, `One good day, two things done, and you sail on (${v.peril.progress.have} of ${v.peril.progress.need} Kleos today).`, 'here')
      + port('<i></i>', esc(v.next.name), `${v.toNext} ⚡ to go once you're back on course.`, 'last')
    : port('<i class="on"></i>', esc(v.at.name), esc(v.at.line))
      + port(ship(18), `At sea, ${v.pct}% of the way`, `${v.toNext} ⚡ to go${days ? `, about ${days} day${days > 1 ? 's' : ''} at your pace` : ''}. A side quest shortens it.`, 'here')
      + port('<i></i>', esc(v.next.name), `${esc(v.next.line)}${reward ? ` Waiting there: ${reward}.` : ''}`)
      + (left > 0 ? port('<i class="far"></i>', `${left} more harbour${left > 1 ? 's' : ''} to Ithaca`, 'A hard week is a storm: the ship waits, and one good day sails you on. Nothing is lost.', 'last') : '');
  return v;
}

// A quest as a card: the active one (with progress) or an offer.
export function questCardHTML(q, state, today, { active = false } = {}) {
  const p = active ? progress(q, state, today) : null;
  const kind = { coldturkey: 'COLD TURKEY', stretch: 'STRETCH', fast: 'FAST DAY', focus: 'FOCUS', oldtask: 'THE OLD TASK' }[q.kind] || 'QUEST';
  const when = q.day ? fmt(q.day) : `by ${fmt(q.until)}`;
  return `<span class="qIcon k-${q.kind}" aria-hidden="true">${QICON[q.kind] || ''}</span><span class="qMain"><small>${active ? `SIDE QUEST · ${esc(p.label.toUpperCase())}` : kind}</small><b>${esc(q.title)}</b>${active ? '' : `<span class="qWhy">${esc(q.why)}</span>`}<span class="qMeta">${esc(when)} · +${q.pts} ⚡</span></span>`;
}
const QICON = {
  fast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/></svg>',
  coldturkey: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg>',
  stretch: '<svg viewBox="0 0 24 24"><path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  oldtask: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 13l2 2 4-4"/></svg>',
};

export { offers };
