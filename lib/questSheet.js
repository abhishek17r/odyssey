// The side-quest sheets: the board (what's on offer, the active one, fasting on/off, done so far), one quest's
// detail (with the fast-day clock and who should skip it), and the moment a quest is done.

import { el, openDrawer, toast, toggle } from './controls.js';
import { offers, progress, questsOf, fastClock, FAST_SKIP } from './quests.js';
import { takeQuest, reportQuest, stopQuest, skipQuest, setFasting } from './questStore.js';
import { questCardHTML } from './journey.js';
import { weekKeyOf, parseKey } from './score.js';
import { esc } from './ui.js';
import { track } from './usage.js';

const hm = (min) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

export function openQuests({ getState, today, onChanged = () => {} }) {
  const body = el('div', { className: 'qSheet' });
  const d = openDrawer('Side quests', body);
  const draw = () => {
    const state = getState();
    const Q = questsOf(state);
    body.innerHTML = '';
    body.append(el('p', { className: 'qIntro', textContent: 'Picked from your own week. One at a time; a finished quest pays bonus Kleos and sails the ship. New ones come each Saturday.' }));
    if (Q.active) {
      const b = el('button', { type: 'button', className: 'questCard active', innerHTML: questCardHTML(Q.active, state, today, { active: true }) });
      b.onclick = () => openQuest({ getState, today, onChanged: () => { onChanged(); draw(); } });
      body.append(b);
    }
    const list = offers(state, today);
    if (list.length) {
      body.append(el('h3', { className: 'rpSec', textContent: Q.active ? 'Next, once that one’s done' : 'Picked for you' }));
      for (const q of list) {
        const c = el('div', { className: 'questCard', innerHTML: questCardHTML(q, state, today) });
        const acts = el('div', { className: 'qActs' });
        const take = el('button', { type: 'button', className: 'primary small', textContent: 'Take it', disabled: !!Q.active });
        take.onclick = async () => { await takeQuest(q); track('quest_take', { k: q.kind }); toast('Quest taken'); onChanged(); draw(); };
        const no = el('button', { type: 'button', className: 'linkBtn', textContent: 'Not this one' });
        no.onclick = async () => { await skipQuest(q.id, weekKeyOf(today)); onChanged(); draw(); };
        acts.append(no, take);
        c.append(acts);
        body.append(c);
      }
    } else if (!Q.active) {
      body.append(el('div', { className: 'card emptyLine', textContent: 'Nothing on offer right now. Quests come when your week has room for a stretch: after a steady week or two, never in a hard one.' }));
    }
    // fasting quests were cut in 1.11 (the switch is gone)
    const done = (Q.log || []).filter((x) => x.status === 'done').slice(-5).reverse();
    if (done.length) {
      body.append(el('h3', { className: 'rpSec', textContent: `Done · ${(Q.log || []).filter((x) => x.status === 'done').length}` }));
      body.append(el('ul', { className: 'card qLog', innerHTML: done.map((x) => `<li><span>${esc(x.title)}</span><b>+${x.pts} ⚡</b></li>`).join('') }));
    }
  };
  draw();
  return d;
}

export function openQuest({ getState, today, onChanged = () => {} }) {
  const body = el('div', { className: 'qSheet qDetail' });
  const d = openDrawer('Side quest', body);
  let timer = null;
  const draw = () => {
    const state = getState();
    const q = questsOf(state).active;
    body.innerHTML = '';
    if (!q) { body.append(el('p', { className: 'emptyLine', textContent: 'No quest running.' })); return; }
    const p = progress(q, state, today);
    body.append(el('div', { className: 'qHead', innerHTML: `<small>+${q.pts} ⚡</small><h3>${esc(q.title)}</h3><p>${esc(q.why)}</p>` }));
    if (q.kind === 'fast') {
      const c = fastClock(q);
      const total = q.window.hours * 60;
      const frac = c.phase === 'fasting' ? c.fastedMin / total : c.phase === 'before' ? 0 : 1;
      const big = c.phase === 'fasting' ? hm(c.fastedMin) : c.phase === 'before' ? '0 h' : `${q.window.hours} h`;
      const line = c.phase === 'before' ? `Your fast starts at ${q.window.to === '20:00' ? '8 pm' : q.window.to} the evening before, in ${hm(c.startsIn)}.`
        : c.phase === 'fasting' ? `Your eating window opens at ${q.window.from === '12:00' ? '12 noon' : '10 am'}, in ${hm(c.toWindowMin)}, and closes at 8 pm.`
          : c.phase === 'eating' ? `Window open: eat as you normally would until 8 pm (${hm(c.closesIn)} left).` : 'The window has closed. How did it go?';
      const R = 42, L = 2 * Math.PI * R;
      body.append(el('div', { className: 'card qClock', innerHTML: `<svg width="96" height="96" viewBox="0 0 100 100" role="img" aria-label="${esc(big)} of ${q.window.hours} hours"><circle cx="50" cy="50" r="${R}" fill="none" stroke="#f0ebe0" stroke-width="10"/><circle cx="50" cy="50" r="${R}" fill="none" stroke="#b9833f" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(L * frac).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 50 50)"/><text x="50" y="49" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${esc(big)}</text><text x="50" y="65" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">of ${q.window.hours} h</text></svg><p>${esc(line)}</p>` }));
      body.append(el('h3', { className: 'rpSec', textContent: 'What counts' }));
      body.append(el('ul', { className: 'card qRules', innerHTML: '<li>Water, black coffee and plain tea are fine any time.</li><li>Eat as you normally would in the window: it’s not a diet.</li><li>When the window closes, tell Odyssey how it went. One honest tap.</li>' }));
      body.append(el('h3', { className: 'rpSec', textContent: 'Skip this quest if' }));
      body.append(el('p', { className: 'card qSkipCard', textContent: FAST_SKIP }));
      const kept = el('button', { type: 'button', className: 'primary', textContent: 'I kept the window', disabled: c.phase === 'before' || c.phase === 'fasting' });
      kept.onclick = async () => { await reportQuest(); onChanged(); d.close(); };
      body.append(el('div', { className: 'qBtns' }, kept, stopBtn()));
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.body.contains(body)) draw(); }, 60000);
    } else {
      body.append(el('div', { className: 'card qProg', innerHTML: `<b>${esc(p.label)}</b><span>${p.need > 1 ? `${p.have} of ${p.need}` : ''}</span>` }));
      body.append(el('p', { className: 'small muted', textContent: q.kind === 'coldturkey' ? 'Log the day at 0 as usual; it counts once the day is over. If it slips, no Kleos are lost: the quest just ends.' : 'It counts by itself from what you log; nothing else to tap. Not done in time? No Kleos are lost.' }));
      body.append(el('div', { className: 'qBtns' }, stopBtn()));
    }
  };
  const stopBtn = () => {
    const b = el('button', { type: 'button', className: 'soft', textContent: 'Stop this quest' });
    b.onclick = async () => { await stopQuest(today); toast('Quest stopped. No Kleos lost.'); onChanged(); d.close(); };
    return b;
  };
  draw();
  return d;
}

// The moment it's done: Kleos, and the ship sails.
export function questDone(q, before, after) {
  const box = el('div', { className: 'qDone', role: 'dialog', ariaLabel: 'Side quest complete' });
  box.innerHTML = `<small>SIDE QUEST COMPLETE</small><h2>${esc(q.title)}</h2><div class="qdPts">+${q.pts} ⚡</div>
    <div class="qdRoute"><span>${esc(after.at.name)}</span><span class="jsTrack"><i style="width:${after.pct}%"></i></span><span>${esc(after.next.name)}</span></div>
    <p>${after.harbour > before.harbour ? `You reached ${esc(after.at.name)}.` : `The ship sailed from ${before.pct}% to ${after.pct}% of the way. ${after.toNext} ⚡ to ${esc(after.next.name)}.`}</p>`;
  const ok = el('button', { type: 'button', className: 'primary', textContent: 'Onward' });
  ok.onclick = () => box.remove();
  box.append(ok);
  document.body.append(box);
}
