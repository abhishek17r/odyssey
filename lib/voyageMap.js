// The voyage map: Troy (bottom left) to Ithaca (top right) along a winding sea route, the ship where you are.
// An SVG string; colours come from the page's CSS variables, so it suits light and dark.

import { PORTS } from './voyage.js';
import { galley } from './figures.js';

// hand-placed ports on a 340 × 200 chart
const P = [
  [22, 170], [62, 148], [44, 112], [84, 92], [128, 112], [164, 146], [208, 158],
  [244, 128], [222, 92], [256, 64], [294, 82], [312, 46], [300, 18],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// a smooth path through points (Catmull-Rom → cubic Bézier)
function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// items: [{ icon, unlockLeg, unlocked }] marked at their ports
export function voyageSvg(v, items = []) {
  const leg = v.leg;
  const to = Math.min(leg + 1, P.length - 1);
  // the ship: at the port reached, nudged toward the next by this week's progress (never all the way)
  const f = Math.min(0.85, v.progress) * 0.8;
  const ship = [P[leg][0] + (P[to][0] - P[leg][0]) * f, P[leg][1] + (P[to][1] - P[leg][1]) * f];
  const done = smooth(P.slice(0, leg + 1));
  const ahead = smooth(P.slice(leg));
  const dots = P.map(([x, y], i) => {
    const reached = i <= leg;
    const home = i === P.length - 1;
    return home
      ? `<g class="vmHome"><circle cx="${x}" cy="${y}" r="7"/><path d="M${x - 4} ${y + 2}h8M${x - 3} ${y + 2}v-4M${x} ${y + 2}v-4M${x + 3} ${y + 2}v-4M${x - 5} ${y - 2}l5 -3l5 3z"/></g>`
      : `<circle class="${reached ? 'vmPortOn' : 'vmPort'}" cx="${x}" cy="${y}" r="${i === leg ? 4.5 : 3}"/>`;
  }).join('');
  const lbl = (i, text, anchor = 'start', dx = 8, dy = 4) => `<text class="vmLabel" x="${P[i][0] + dx}" y="${P[i][1] + dy}" text-anchor="${anchor}">${esc(text)}</text>`;
  const labels = [
    leg !== 0 ? lbl(0, 'Troy', 'start', 8, 4) : '',
    lbl(P.length - 1, 'Ithaca', 'end', -10, 4),
    leg > 0 && leg < P.length - 1 ? lbl(leg, PORTS[leg].name, P[leg][0] > 200 ? 'end' : 'start', P[leg][0] > 200 ? -8 : 8, -8) : '',
    leg === 0 ? lbl(0, 'Troy', 'start', 8, 4) : '',
  ].join('');
  const gifts = items.filter((it) => it.unlockLeg > 0 && it.unlockLeg < P.length).map((it) => {
    const [x, y] = P[it.unlockLeg];
    return `<g class="vmGift ${it.unlocked ? 'on' : ''}" transform="translate(${x} ${y + 15})"><circle r="8"/><text y="4" text-anchor="middle">${it.icon}</text></g>`;
  }).join('');
  return `<svg class="voyageMap" viewBox="0 0 340 200" role="img" aria-label="${esc(`Voyage ${v.voyage}: ${v.legsSailed % 12} of 12 legs sailed, next port ${v.next?.name || 'Ithaca'}`)}">
    <path class="vmWave" d="M10 186 q10 -4 20 0 t20 0 t20 0 M120 30 q10 -4 20 0 t20 0 M180 186 q10 -4 20 0 t20 0 t20 0 M30 40 q10 -4 20 0 t20 0"/>
    <path class="vmAhead" d="${ahead}"/>
    <path class="vmDone" d="${done}"/>
    ${dots}${gifts}${labels}
    <g class="vmShipAt" transform="translate(${ship[0].toFixed(1)} ${ship[1].toFixed(1)})"><circle class="vmShipHalo" r="13"/><g transform="translate(-13 -15)">${galley(26).replace('<svg ', '<svg x="0" y="0" ')}</g></g>
  </svg>`;
}
