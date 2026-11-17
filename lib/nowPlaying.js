// The running focus session on the iPhone lock screen, through "Now Playing": a silent audio loop keeps the
// app's media session alive, and its title / progress / play-pause mirror the session.
// iPhone shows one Now Playing at a time: starting Spotify or Apple Music replaces this one.

let audio = null;   // the silent loop
let carrier = null; // real audio playing (focus radio): the card rides on it, no silence needed
let handlers = {};

// One second of silence as a WAV file (8 kHz, 16-bit mono), made in the browser.
function silence() {
  const rate = 8000, n = rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export const nowPlayingSupported = () => 'mediaSession' in navigator && typeof Audio !== 'undefined';
export const nowPlayingActive = () => (!!audio && !audio.paused) || (!!carrier && !carrier.paused);

// Focus radio playing → it carries the lock-screen card; the silent loop steps aside.
export function setCarrier(el) {
  carrier = el;
  if (el && !el.paused && audio && !audio.paused) audio.pause();
}

// The lock screen's ⏯ (set once; works whichever audio is playing).
export function bindHandlers(on = {}) {
  if (!nowPlayingSupported()) return;
  handlers = on;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', async () => { if (!(carrier && carrier.src)) await audio?.play().catch(() => {}); handlers.play?.(); });
  ms.setActionHandler('pause', () => { handlers.pause?.(); });
  for (const a of ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto']) { try { ms.setActionHandler(a, on[a] || null); } catch { /* not supported */ } }
}

// Call from a tap (browsers only start audio after a user gesture). on: { play(), pause() }
export async function nowPlayingOn(on = {}) {
  if (!nowPlayingSupported()) return false;
  bindHandlers(on);
  if (carrier && !carrier.paused) return true; // the radio already carries it
  if (!audio) {
    audio = new Audio(silence());
    audio.loop = true;
    audio.setAttribute('playsinline', '');
  }
  try { await audio.play(); } catch { return false; }
  return true;
}

export function nowPlayingOff() {
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (nowPlayingSupported()) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
}

// The lock-screen picture: a focus ring with the minutes left and today's focus time, drawn on a canvas.
let art = { key: '', url: '' };
const hm = (min) => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
export function artwork({ phase, mins, frac, todayMin }) {
  const key = `${phase}|${mins}|${Math.round(frac * 100)}|${Math.round(todayMin)}`;
  if (art.key === key) return art.url;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#1f2638'); sky.addColorStop(.55, '#3d3550'); sky.addColorStop(1, '#a8573a');
  g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
  const glow = g.createRadialGradient(256, 560, 20, 256, 560, 340);
  glow.addColorStop(0, 'rgba(255,207,94,.75)'); glow.addColorStop(1, 'rgba(255,138,58,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 512, 512);
  const font = (w, px, fam = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif') => `${w} ${px}px ${fam}`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(246,230,200,.85)'; g.font = font(600, 22, 'Georgia, serif');
  g.fillText('O D Y S S E Y', 256, 50);
  // ring
  const cx = 256, cy = 245, r = 150;
  g.lineWidth = 24; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  if (frac > 0) {
    const ring = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ring.addColorStop(0, phase === 'paused' ? '#8e8e93' : '#ffd25e'); ring.addColorStop(1, phase === 'paused' ? '#636366' : '#ff7a3d');
    g.strokeStyle = ring; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac)); g.stroke();
  }
  g.fillStyle = '#fff';
  const big = phase === 'procrast' ? '—' : mins <= 0 ? '0' : String(mins);
  g.font = font(700, big.length > 2 ? 104 : 128); g.fillText(big, cx, cy + 40);
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(600, 28);
  g.fillText(phase === 'procrast' ? 'not started' : phase === 'paused' ? 'min left · paused' : mins <= 0 ? 'time’s up' : 'min left', cx, cy + 84);
  g.fillStyle = '#ffe08a'; g.font = font(700, 30);
  g.fillText(`Today ${hm(todayMin)} focused`, 256, 470);
  if (art.url) URL.revokeObjectURL(art.url);
  // a blob URL (synchronous data URL → blob)
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  art = { key, url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) };
  return art.url;
}

// Mirror the session: title, the phase, how far through it is, today's focus time.
// { title, phase: 'procrast' | 'work' | 'paused', leftMs, lengthMs, workedMs, task, todayMin }
export function nowPlayingUpdate(s) {
  if ((!audio && !carrier) || !nowPlayingSupported()) return;
  const mins = Math.max(0, Math.ceil(s.leftMs / 60000));
  const head = s.phase === 'procrast' ? 'Not started yet' : s.phase === 'paused' ? `Paused · ${mins} min left` : s.leftMs <= 0 ? 'Time’s up' : `${mins} min left`;
  const todayMin = s.todayMin ?? s.workedMs / 60000;
  let pic = null;
  try { pic = artwork({ phase: s.phase, mins, frac: s.workedMs / Math.max(1, s.lengthMs), todayMin }); } catch { /* no canvas */ }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: head,
    artist: s.task,
    album: `${s.station ? `📻 ${s.station} · ` : ''}Today ${hm(todayMin)} focused`,
    artwork: [
      ...(pic ? [{ src: pic, sizes: '512x512', type: 'image/png' }] : []),
      { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
    ],
  });
  navigator.mediaSession.playbackState = s.phase === 'work' || (carrier && !carrier.paused) ? 'playing' : 'paused';
  try {
    const dur = Math.max(1, s.lengthMs / 1000);
    navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(dur, Math.max(0, s.workedMs / 1000)), playbackRate: s.phase === 'work' ? 1 : 0.0001 });
  } catch { /* older browsers */ }
}
