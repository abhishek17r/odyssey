// The cast: small hand-drawn figures that bring the Greek story to life. SVG strings, flat colours in a warm
// classical palette (bronze, terracotta, sea blue, cream) that reads on light and dark. Animations live in
// calm.css and switch off with "reduce motion".

const C = {
  cream: '#f3e7d3', skin: '#e8c3a0', skinShade: '#d6aa84', hair: '#5a3a28', bronze: '#c08a45', bronzeDark: '#8f6230',
  crest: '#c0614f', sea: '#3d6b8f', seaDark: '#2c5373', gold: '#e2b45a', ink: '#2a2420', white: '#fffaf2', leaf: '#5f9475', leafDark: '#467a5d',
  owl: '#9a7d63', owlDark: '#6f5844', owlBelly: '#e9dcc6', beak: '#e0a050', wood: '#7a4f33', woodDark: '#5c3a25', sail: '#f6ead6',
};

// Athena: a helmeted bust, facing you. Her eyes blink and her crest sways (CSS).
export function athena(size = 36, cls = '') {
  return `<svg class="fig figAthena ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="${C.cream}"/>
    <clipPath id="athClip"><circle cx="32" cy="32" r="32"/></clipPath>
    <g clip-path="url(#athClip)">
      <path d="M10 66 Q12 49 32 46 Q52 49 54 66 Z" fill="${C.sea}"/>
      <path d="M22 50 Q32 56 42 50" fill="none" stroke="${C.gold}" stroke-width="2"/>
      <path d="M21.5 26 Q17 38 18.5 50 L25.5 50 Q23 40 24.5 31 Z M42.5 26 Q47 38 45.5 50 L38.5 50 Q41 40 39.5 31 Z" fill="${C.hair}"/>
      <rect x="28.5" y="38" width="7" height="10" rx="3" fill="${C.skinShade}"/>
      <ellipse cx="32" cy="31" rx="9" ry="11" fill="${C.skin}"/>
      <circle cx="27" cy="35" r="1.6" fill="#e9a58c" opacity=".55"/><circle cx="37" cy="35" r="1.6" fill="#e9a58c" opacity=".55"/>
      <g class="athEyes"><ellipse cx="28.2" cy="31" rx="1.5" ry="1.8" fill="${C.ink}"/><ellipse cx="35.8" cy="31" rx="1.5" ry="1.8" fill="${C.ink}"/></g>
      <path d="M29.8 37 Q32 38.4 34.2 37" fill="none" stroke="#b5615a" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M20.5 30 Q19.5 13 32 12 Q44.5 13 43.5 30 L40.6 30 Q40.5 23.5 36 22.6 L32 25 L28 22.6 Q23.5 23.5 23.4 30 Z" fill="${C.bronze}"/>
      <path d="M21 25.5 Q32 21 43 25.5" fill="none" stroke="${C.bronzeDark}" stroke-width="1.2"/>
      <g class="athCrest"><path d="M21 15 Q24 1 33 2 Q43 2 46 14 Q40 8 33 8 Q26 8 21 15 Z" fill="${C.crest}"/>
        <path d="M24 12 Q33 4 43 12" fill="none" stroke="#a84f40" stroke-width="1" opacity=".6"/></g>
    </g>
  </svg>`;
}

// Athena's owl: round, wide-eyed; flaps when it cheers (CSS).
export function owl(size = 56, cls = '') {
  return `<svg class="fig figOwl ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <g class="owlWingL"><path d="M15 30 Q4 38 10 52 Q16 46 19 38 Z" fill="${C.owlDark}"/></g>
    <g class="owlWingR"><path d="M49 30 Q60 38 54 52 Q48 46 45 38 Z" fill="${C.owlDark}"/></g>
    <path d="M32 10 Q47 10 49 30 Q51 52 32 56 Q13 52 15 30 Q17 10 32 10 Z" fill="${C.owl}"/>
    <path d="M18 11 L23 19 L17 19 Z M46 11 L41 19 L47 19 Z" fill="${C.owlDark}"/>
    <ellipse cx="32" cy="40" rx="11" ry="12" fill="${C.owlBelly}"/>
    <path d="M26 38 q2 2 4 0 M34 38 q2 2 4 0 M28 44 q2 2 4 0 M32 44 q2 2 4 0" fill="none" stroke="${C.owl}" stroke-width="1"/>
    <circle cx="25" cy="25" r="7" fill="${C.white}"/><circle cx="39" cy="25" r="7" fill="${C.white}"/>
    <g class="owlEyes"><circle cx="25.5" cy="25.5" r="3.2" fill="${C.ink}"/><circle cx="38.5" cy="25.5" r="3.2" fill="${C.ink}"/>
      <circle cx="26.5" cy="24.4" r="1" fill="${C.white}"/><circle cx="39.5" cy="24.4" r="1" fill="${C.white}"/></g>
    <path d="M30 30 L34 30 L32 34 Z" fill="${C.beak}"/>
    <path d="M26 56 l2 4 l2 -4 M34 56 l2 4 l2 -4" fill="none" stroke="${C.beak}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

// Odysseus' galley: a curved hull, a striped square sail, the hero at the stern; it rocks on the waves (CSS).
export function galley(size = 30, cls = '') {
  return `<svg class="fig figGalley ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <g class="galleyRock">
      <line x1="30" y1="10" x2="30" y2="44" stroke="${C.woodDark}" stroke-width="2"/>
      <path d="M17 13 Q30 10 43 13 L41 36 Q30 39 19 36 Z" fill="${C.sail}" stroke="${C.wood}" stroke-width="1"/>
      <path d="M24 12 L24.5 37.5 M36 12 L35.5 37.5" stroke="${C.crest}" stroke-width="3"/>
      <circle cx="49" cy="35" r="3" fill="${C.skin}"/><path d="M46 34 Q49 28 52 34 Z" fill="${C.bronze}"/><path d="M45.5 31 Q49 26 52.5 31" fill="none" stroke="${C.crest}" stroke-width="1.6"/>
      <path d="M4 42 Q6 40 9 44 L54 44 Q58 40 60 30 Q62 38 58 46 Q52 54 40 54 L20 54 Q8 53 4 42 Z" fill="${C.wood}"/>
      <path d="M8 46 L56 46" stroke="${C.gold}" stroke-width="1.4"/>
      <circle cx="14" cy="49" r="1.6" fill="${C.white}"/>
    </g>
  </svg>`;
}

// A round hoplite shield (an Aegis); full when held, an outline when not.
export function shield(on = true, size = 18) {
  return on
    ? `<svg class="fig figShield on" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="${C.bronze}" stroke="${C.bronzeDark}" stroke-width="1.5"/><circle cx="16" cy="16" r="10.5" fill="none" stroke="${C.gold}" stroke-width="1.5"/><path d="M16 9 L18 14 L23 14 L19 17.5 L20.5 23 L16 19.8 L11.5 23 L13 17.5 L9 14 L14 14 Z" fill="${C.gold}"/></svg>`
    : `<svg class="fig figShield" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3" opacity=".6"/></svg>`;
}

// A laurel wreath: two branches curving up from a tied base.
export function laurel(size = 26) {
  const leaf = (deg, i) => {
    const r = (deg * Math.PI) / 180;
    const x = 16 + Math.cos(r) * 10, y = 15 + Math.sin(r) * 10;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="1.9" ry="4" transform="rotate(${deg.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${i % 2 ? C.leafDark : C.leaf}"/>`;
  };
  const right = [75, 45, 15, -15, -42].map(leaf).join('');
  const left = [105, 135, 165, 195, 222].map(leaf).join('');
  return `<svg class="fig figLaurel" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 25.5 A10 10 0 0 1 7 9 M16 25.5 A10 10 0 0 0 25 9" fill="none" stroke="${C.leafDark}" stroke-width=".9"/>${left}${right}
    <path d="M13.5 27 Q16 25 18.5 27" fill="none" stroke="${C.gold}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

// The owl hops in from the corner to cheer, then flies off. Called when something is done.
let owlTimer = null;
export function owlCheer(words = 'Well done') {
  if (typeof document === 'undefined') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.owlPop')?.remove();
  const el = document.createElement('div');
  el.className = 'owlPop';
  el.innerHTML = `${owl(52)}<span class="owlSays">${words}</span>`;
  document.body.append(el);
  clearTimeout(owlTimer);
  owlTimer = setTimeout(() => el.remove(), 2200);
}
