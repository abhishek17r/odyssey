// Focus music links → an embeddable player. YouTube (playlists, videos, youtu.be, YouTube Music) and
// Spotify (playlists, albums, tracks, podcasts; open.spotify.com links or spotify: addresses).
// The player always starts paused and plays inline on iPhone.
// Pasted share text works too: the first link in it is used.

export const firstLink = (text) => {
  const t = String(text || '').trim();
  return (t.match(/https?:\/\/\S+/i) || t.match(/spotify:[a-z]+:[A-Za-z0-9]+/i) || [t])[0].replace(/[).,!]+$/, '');
};

function youtube(u) {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (!['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null;
  const list = u.searchParams.get('list');
  let video = u.searchParams.get('v');
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0] || null;
  const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
  if (m && m[1] !== 'videoseries') video = m[1];
  if (!list && !video) return 'bad';
  const p = new URLSearchParams({ autoplay: '0', playsinline: '1', rel: '0', modestbranding: '1' });
  if (list) p.set('list', list);
  return {
    service: 'youtube', label: 'YouTube', kind: list ? 'playlist' : 'video',
    src: `https://www.youtube-nocookie.com/embed/${video || 'videoseries'}?${p}`,
    open: list ? `https://${u.hostname.startsWith('music.') ? 'music' : 'www'}.youtube.com/playlist?list=${list}` : `https://www.youtube.com/watch?v=${video}`,
  };
}

const SPOTIFY_KINDS = ['playlist', 'album', 'track', 'episode', 'show', 'artist'];
function spotifyFrom(kind, id) {
  if (!SPOTIFY_KINDS.includes(kind) || !/^[A-Za-z0-9]{10,}$/.test(id)) return 'bad';
  return {
    service: 'spotify', label: 'Spotify', kind: kind === 'show' ? 'podcast' : kind,
    src: `https://open.spotify.com/embed/${kind}/${id}?utm_source=odyssey`,
    open: `https://open.spotify.com/${kind}/${id}`,
  };
}
function spotify(u) {
  if (u.protocol === 'spotify:') { const [kind, id] = u.pathname.split(':'); return spotifyFrom(kind, id); }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'spotify.link' || host === 'spoti.fi') return 'short';
  if (host !== 'open.spotify.com' && host !== 'play.spotify.com') return null;
  const parts = u.pathname.split('/').filter(Boolean).filter((p) => !/^intl-/.test(p) && p !== 'embed');
  return spotifyFrom(parts[0], parts[1] || '');
}

// → { service, label, kind, src, open } | { error } | null (empty)
export function musicEmbed(link) {
  const v = firstLink(link);
  if (!v) return null;
  let u;
  try { u = new URL(/^[a-z]+:/i.test(v) ? v : `https://${v}`); } catch { return { error: 'That doesn’t look like a link.' }; }
  const r = youtube(u) || spotify(u);
  if (r === 'short') return { error: 'That’s a short Spotify link. Open it, then use Share → Copy link from the playlist page (an open.spotify.com address).' };
  if (r === 'bad') return { error: 'Use a link to a playlist, album, track or video.' };
  if (!r) return { error: 'Use a YouTube, YouTube Music or Spotify link.' };
  return r;
}
