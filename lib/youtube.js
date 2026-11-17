// YouTube links → an embeddable player address. Playlists, single videos, youtu.be and YouTube Music
// links all work. The player starts paused (no autoplay) and plays inline on iPhone.

export function youtubeEmbed(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (!['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null;
  const list = u.searchParams.get('list');
  let video = u.searchParams.get('v');
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0] || null;
  const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
  if (m && m[1] !== 'videoseries') video = m[1];
  if (!list && !video) return null;
  const p = new URLSearchParams({ autoplay: '0', playsinline: '1', rel: '0', modestbranding: '1' });
  if (list) p.set('list', list);
  const base = 'https://www.youtube-nocookie.com/embed/';
  return { src: `${base}${video || 'videoseries'}?${p}`, kind: list ? 'playlist' : 'video' };
}
