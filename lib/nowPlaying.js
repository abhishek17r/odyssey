// The running focus session on the iPhone lock screen, through "Now Playing": a silent audio loop keeps the
// app's media session alive, and its title / progress / play-pause mirror the session.
// iPhone shows one Now Playing at a time: starting Spotify or Apple Music replaces this one.

let audio = null;
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
export const nowPlayingActive = () => !!audio && !audio.paused;

// Call from a tap (browsers only start audio after a user gesture). on: { play(), pause() }
export async function nowPlayingOn(on = {}) {
  if (!nowPlayingSupported()) return false;
  handlers = on;
  if (!audio) {
    audio = new Audio(silence());
    audio.loop = true;
    audio.setAttribute('playsinline', '');
  }
  try { await audio.play(); } catch { return false; }
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', async () => { await audio.play().catch(() => {}); handlers.play?.(); });
  ms.setActionHandler('pause', () => { handlers.pause?.(); });
  for (const a of ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto']) { try { ms.setActionHandler(a, null); } catch { /* not supported */ } }
  return true;
}

export function nowPlayingOff() {
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (nowPlayingSupported()) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
}

// Mirror the session: title, the phase, how far through it is.
// { title, phase: 'procrast' | 'work' | 'paused', leftMs, lengthMs, workedMs, task }
export function nowPlayingUpdate(s) {
  if (!audio || !nowPlayingSupported()) return;
  const mins = Math.max(0, Math.ceil(s.leftMs / 60000));
  const head = s.phase === 'procrast' ? 'Not started yet' : s.phase === 'paused' ? `Paused · ${mins} min left` : s.leftMs <= 0 ? 'Time’s up' : `${mins} min left`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `${head} · ${s.task}`,
    artist: s.phase === 'work' ? 'Odyssey · Focus' : s.phase === 'paused' ? 'Odyssey · Paused' : 'Odyssey · Start when you’re ready',
    album: 'Focus session',
    artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
  });
  navigator.mediaSession.playbackState = s.phase === 'work' ? 'playing' : 'paused';
  try {
    const dur = Math.max(1, s.lengthMs / 1000);
    navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(dur, Math.max(0, s.workedMs / 1000)), playbackRate: s.phase === 'work' ? 1 : 0.0001 });
  } catch { /* older browsers */ }
}
