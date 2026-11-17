// Focus radio: free internet radio played by the app's own audio player, so it keeps going with the screen
// locked and shows on the lock screen (with your focus session's time on it). Or any stream link you paste.

export const STATIONS = [
  { id: 'groovesalad', name: 'Groove Salad', by: 'SomaFM', vibe: 'Chilled ambient and downtempo beats', icon: '🥗', url: 'https://ice2.somafm.com/groovesalad-128-mp3' },
  { id: 'dronezone', name: 'Drone Zone', by: 'SomaFM', vibe: 'Atmospheric ambient, no beats', icon: '🌫️', url: 'https://ice2.somafm.com/dronezone-128-mp3' },
  { id: 'deepspace', name: 'Deep Space One', by: 'SomaFM', vibe: 'Deep ambient and space music', icon: '🌌', url: 'https://ice2.somafm.com/deepspaceone-128-mp3' },
  { id: 'fluid', name: 'Fluid', by: 'SomaFM', vibe: 'Instrumental hip-hop and future soul', icon: '💧', url: 'https://ice2.somafm.com/fluid-128-mp3' },
  { id: 'sonicuniverse', name: 'Sonic Universe', by: 'SomaFM', vibe: 'Modern jazz', icon: '🎷', url: 'https://ice2.somafm.com/sonicuniverse-128-mp3' },
  { id: 'spacestation', name: 'Space Station Soma', by: 'SomaFM', vibe: 'Spaced-out ambient and mid-tempo electronica', icon: '🛰️', url: 'https://ice2.somafm.com/spacestation-128-mp3' },
  { id: 'raagam', name: 'Raagam', by: 'All India Radio', vibe: 'Hindustani and Carnatic classical, 24 hours', icon: '🪕', url: 'https://airhlspush.pc.cdn.bitgravity.com/httppush/hlspbaudioragam/hlspbaudioragam_Auto.m3u8' },
  { id: 'rpmellow', name: 'Mellow Mix', by: 'Radio Paradise', vibe: 'Calm, eclectic, a few vocals', icon: '🌿', url: 'https://stream.radioparadise.com/mellow-128' },
];

// Your stations: the built-in ones plus any stream links you added (settings.radioCustom [{ id, name, url }]).
export const stationsOf = (settings) => [...STATIONS, ...(settings.radioCustom || []).map((s) => ({ ...s, by: 'Your link', vibe: 'Stream you added', icon: '📻', custom: true }))];
export const stationById = (settings, id) => stationsOf(settings).find((s) => s.id === id) || STATIONS[0];

// A stream link looks like http(s)://… (an .mp3 / .aac / .m3u8 / Icecast address). Playlist files (.pls/.m3u)
// aren't streams: open them and copy the address inside.
export function checkStream(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return 'That isn’t a link.'; }
  if (!/^https?:$/.test(u.protocol)) return 'Use an http(s) stream address.';
  if (/\.(pls|m3u|asx|xspf)$/i.test(u.pathname)) return 'That’s a playlist file. Open it and copy the stream address inside.';
  if (/youtube|youtu\.be|spotify/i.test(u.hostname)) return 'That’s a playlist service, not a radio stream: add it under Playlist instead.';
  return null;
}

// ---------- the player ----------
let el = null;
let current = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f(radioState()));
export const onRadio = (f) => { subs.add(f); return () => subs.delete(f); };
export const radioState = () => ({ station: current, playing: !!el && !el.paused && !!el.src && !el.dataset.error, loading: !!el?.dataset.loading && !el.dataset.error, error: !!el?.dataset.error });
export const radioAudio = () => el;

function ensure() {
  if (el) return el;
  el = new Audio();
  el.preload = 'none';
  el.setAttribute('playsinline', '');
  for (const ev of ['play', 'pause', 'playing', 'ended']) el.addEventListener(ev, () => { if (ev !== 'play') delete el.dataset.loading; emit(); });
  el.addEventListener('error', () => { if (!el.src) return; el.dataset.error = '1'; delete el.dataset.loading; el.pause(); emit(); });
  el.addEventListener('waiting', () => { el.dataset.loading = '1'; emit(); });
  return el;
}

// Call from a tap (browsers only start audio after one). → true if it started.
export async function radioPlay(station) {
  const a = ensure();
  if (station && station.url !== a.dataset.url) { a.src = station.url; a.dataset.url = station.url; current = station; }
  if (!a.src) return false;
  delete a.dataset.error;
  a.dataset.loading = '1';
  emit();
  try { await a.play(); return !a.dataset.error; } catch { delete a.dataset.loading; a.dataset.error = '1'; emit(); return false; }
}
export function radioPause() { if (el && !el.paused) el.pause(); }
// Stop and let go of the stream (no data used while stopped).
export function radioStop() {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  delete el.dataset.url;
  delete el.dataset.error;
  el.load();
  current = null;
  emit();
}
