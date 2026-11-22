// Hermes on screen, part 2: the Hermes button (top right of every tab, with the unread count), the thread
// (everything Hermes sends, in order, plus the chat) and the app icon's badge.

import { el, openDrawer, toast } from './controls.js';
import { load, save } from './storage.js';
import { answer, finish, tick, changeText, history, undoable } from './hermes.js';
import { threadItems, unreadCount, ideaState } from './hermesThread.js';
import { withMessages, markRemember, leftToday, chatMsgs, CHAT_PER_DAY } from './hermesChat.js';
import { crisisIn, CRISIS_LINE } from './safety.js';
import { addLine, MEMORY_ID } from './memory.js';
import { openFollowUp } from './hermesSheet.js';
import { callFunction, currentUser } from './cloud.js';
import { esc } from './ui.js';
import { track } from './usage.js';

const MARK = '<span class="hmMark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c3-1 5-4 6-8 1 4 4 7 8 8"/><path d="M7 18h10"/><path d="M3 10l3 1M21 10l-3 1"/></svg></span>';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const when = (ms) => { const d = new Date(ms); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 864e5); return days === 0 ? `Today, ${t}` : days === 1 ? `Yesterday, ${t}` : d.toLocaleDateString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }); };

async function write(fn) {
  const st = await load();
  const patch = fn(st);
  if (patch && Object.keys(patch).length) await save(patch);
  return patch;
}

// ---------- the button and the badges ----------

// Put the Hermes button in every tab's top bar (once), and show the count on it and on the app icon.
export function drawHermesButtons(ctx) {
  const state = ctx.getState();
  const off = state.settings?.hermesOn === false || state.settings?.athenaOn === false;
  const n = off ? 0 : unreadCount(state, ctx.today);
  for (const bar of document.querySelectorAll('.view .topbar')) {
    let b = bar.querySelector('.hmBtn');
    if (!b) {
      b = el('button', { type: 'button', className: 'hmBtn', innerHTML: `${MARK.replace('width="16" height="16"', 'width="20" height="20"')}<span class="hmBadge" hidden></span>` });
      b.onclick = () => openThread(ctx);
      const right = bar.querySelector('.miniRing, .rpNav, #rpPrev')?.parentElement === bar ? bar.querySelector('.miniRing, .rpNav, #rpPrev') : null;
      right ? bar.insertBefore(b, right) : bar.append(b);
    }
    b.hidden = off;
    b.setAttribute('aria-label', n ? `Hermes, ${n} new` : 'Hermes');
    const badge = b.querySelector('.hmBadge');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
  }
  try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch { /* no badging */ }
}

// ---------- the thread ----------

export function openThread(ctx, { draft = '' } = {}) {
  const list = el('div', { className: 'hmThread' });
  const box = el('textarea', { className: 'hmInput', rows: 1, placeholder: 'What’s going on?', maxLength: 500, value: draft });
  const send = el('button', { type: 'button', className: 'hmSend', ariaLabel: 'Send', innerHTML: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>' });
  const left = el('div', { className: 'hmLeft' });
  const body = el('div', { className: 'hmChat' }, list, left, el('div', { className: 'hmComposer' }, box, send));
  openDrawer('Hermes', body);
  track('sheet', { s: 'hermes-thread' });
  let busy = false;
  let signedIn = true;
  currentUser().then((u) => { signedIn = !!u; draw(); }).catch(() => {});

  const markSeen = async () => { await write((st) => ({ settings: { ...st.settings, hermesSeen: Date.now() } })); await ctx.onChanged(); };

  const ideaCard = (i) => {
    const state = ctx.getState();
    const day = ctx.today;
    const st = ideaState(state, i, day);
    const c = el('div', { className: `hmPc ${st}` });
    c.innerHTML = `<b>${esc(i.title)}</b>${['gone', 'undone'].includes(st) ? '' : `<div class="hmChange"><b>If you accept:</b> ${esc(changeText(state, i, day))}</div>`}`;
    if (st === 'open') {
      const a = el('button', { type: 'button', className: 'primary', textContent: 'Accept' });
      a.onclick = async () => { await write((s) => answer(s, i, 'accepted', ctx.today)); track('hermes_accept', { k: i.kind, from: i.chat ? 'chat' : 'thread' }); toast(['pause_days', 'move_task'].includes(i.kind) ? 'Done' : 'Trying it for 7 days'); await ctx.onChanged(); draw(); };
      const no = el('button', { type: 'button', className: 'linkBtn', textContent: 'Not now' });
      no.onclick = async () => { await write((s) => answer(s, i, 'notnow', ctx.today)); track('hermes_notnow', { k: i.kind }); await ctx.onChanged(); draw(); };
      c.append(el('div', { className: 'hmBtns' }, a, no));
    } else if (st === 'accepted') {
      const h = undoable(state, day).find((x) => x.ideaId === i.id);
      const row = el('div', { className: 'hmDoneLine', innerHTML: '<span>✓ Accepted</span>' });
      if (h) {
        const u = el('button', { type: 'button', className: 'linkBtn', textContent: h.undo ? 'Undo' : 'Stop' });
        u.onclick = async () => { await write((s) => finish(s, h, 'stopped')); toast(h.undo ? 'Undone' : 'Stopped'); await ctx.onChanged(); draw(); };
        row.append(u);
      }
      c.append(row);
    } else c.append(el('div', { className: 'hmDoneLine muted', textContent: st === 'notnow' ? 'Not now' : st === 'undone' ? 'Undone' : 'No longer applies' }));
    return c;
  };

  const hermesSays = (html) => el('div', { className: 'hmWho', innerHTML: `${MARK}<div class="hmBub">${html}</div>` });

  function draw() {
    const state = ctx.getState();
    const day = ctx.today;
    list.innerHTML = '';
    const items = threadItems(state, day);
    const seen = Number(state.settings?.hermesSeen) || 0;
    if (!items.length) list.append(hermesSays('Tell me what’s going on today or this week: a trip, a bad night, a deadline. I’ll suggest changes to your plan. Nothing changes until you say yes.'));
    let lastStamp = 0; let newShown = false;
    for (const x of items) {
      if (!newShown && seen && x.at > seen && x.kind !== 'you') { list.append(el('div', { className: 'hmNew', textContent: 'NEW' })); newShown = true; }
      if (x.at - lastStamp > 30 * 60000) list.append(el('div', { className: 'hmStamp', textContent: when(x.at) }));
      lastStamp = x.at;
      if (x.kind === 'you') { list.append(el('div', { className: 'hmBub me', textContent: x.text })); continue; }
      if (x.kind === 'ideas' || x.kind === 'moment' || x.kind === 'hermes') {
        list.append(hermesSays(esc(x.text)));
        for (const i of x.ideas || []) list.append(ideaCard(i));
        const m = x.msg;
        if (m?.remember && !m.rememberDone) {
          const r = el('div', { className: 'hmRem', innerHTML: `<b>Remember:</b> “${esc(m.remember)}”` });
          const yes = el('button', { type: 'button', className: 'primary', textContent: 'Remember' });
          yes.onclick = async () => { await write((s) => ({ notes: { ...markRemember(s, m.id, 'yes').notes, [MEMORY_ID]: addLine(s.notes?.[MEMORY_ID], 'know', m.remember) } })); toast('Athena will keep it in mind'); await ctx.onChanged(); draw(); };
          const no = el('button', { type: 'button', className: 'linkBtn', textContent: 'No thanks' });
          no.onclick = async () => { await write((s) => markRemember(s, m.id, 'no')); await ctx.onChanged(); draw(); };
          r.append(el('div', { className: 'hmBtns' }, yes, no));
          list.append(r);
        }
        continue;
      }
      if (x.kind === 'followup') {
        const w = hermesSays(esc(x.text));
        if (!x.h.outcome) { const b = el('button', { type: 'button', className: 'soft', textContent: 'See how it went' }); b.onclick = () => openFollowUp(ctx, x.h); w.querySelector('.hmBub').append(el('div', { className: 'hmBtns' }, b)); }
        else w.querySelector('.hmBub').append(el('div', { className: 'hmDoneLine', textContent: x.h.outcome === 'kept' ? '✓ Kept' : 'Dropped, and undone' }));
        list.append(w);
        continue;
      }
      if (x.kind === 'checkin') {
        const w = hermesSays(esc(x.text));
        const t = x.h.ticks?.[day];
        if (t == null) {
          const btns = el('div', { className: 'hmBtns' });
          for (const [label, v] of [['Yes', true], ['Not today', false]]) {
            const b = el('button', { type: 'button', className: v ? 'primary' : 'soft', textContent: label });
            b.onclick = async () => { await write((s) => tick(s, x.h, day, v)); await ctx.onChanged(); draw(); };
            btns.append(b);
          }
          w.querySelector('.hmBub').append(btns);
        } else w.querySelector('.hmBub').append(el('div', { className: 'hmDoneLine', textContent: t ? '✓ Yes' : 'Not today' }));
        list.append(w);
      }
    }
    if (busy) list.append(hermesSays('<span class="hmDots"><i></i><i></i><i></i></span>'));
    const n = leftToday(state, day);
    left.textContent = signedIn ? `${n} of ${CHAT_PER_DAY} messages left today` : 'Sign in (Me → Account) to talk to Hermes';
    send.disabled = busy || !n || !signedIn;
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  async function sendIt() {
    const text = box.value.trim();
    if (!text || busy) return;
    const now = Date.now();
    const day = ctx.today;
    const me = { id: uid(), from: 'you', text, at: now, day };
    box.value = '';
    if (crisisIn(text)) { // never sent to the AI: the fixed line, from code
      await write((s) => withMessages(s, [{ ...me, local: true }, { id: uid(), from: 'hermes', text: CRISIS_LINE, at: now + 1, local: true }]));
      await ctx.onChanged(); draw(); return;
    }
    await write((s) => withMessages(s, [me]));
    busy = true; await ctx.onChanged(); draw();
    track('hermes_chat');
    let r = null; let err = null;
    try { r = await callFunction('odyssey-athena', { chat: { text } }); } catch (e) { err = e; }
    busy = false;
    const ok = r && typeof r.reply === 'string';
    const reply = ok
      ? { id: uid(), from: 'hermes', text: r.reply, at: Date.now(), ideas: r.ideas || [], remember: r.remember || null }
      : { id: uid(), from: 'hermes', text: err?.status === 429 ? 'That’s today’s 10 messages. Talk tomorrow.' : 'I couldn’t answer that just now. Try again in a minute.', at: Date.now(), local: true };
    if (!ok) console.warn('hermes chat', err?.message || r?.error);
    await write((s) => withMessages(s, [reply]));
    await markSeen();
    draw();
  }
  send.onclick = sendIt;
  box.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendIt(); } };
  box.oninput = () => { box.style.height = 'auto'; box.style.height = `${Math.min(120, box.scrollHeight)}px`; };
  draw();
  markSeen().then(draw);
  if (draft) setTimeout(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }, 250);
}
