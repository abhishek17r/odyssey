// For an eval run: why each Hermes idea was dropped. node scripts/brain/why-dropped.mjs <results.jsonl>
import { readFileSync } from 'node:fs';
import { PERSONAS, todayOf } from './personas.mjs';
import { buildRequest } from '../../lib/athenaAI.js';
import { parseHermes, isValid } from '../../lib/hermes.js';
import { weekKeyOf } from '../../lib/score.js';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => ['hermes','moment'].includes(r.job) && !r.pass);
for (const r of rows) {
  const p = PERSONAS.find((x) => x.id === r.person); const s = p.build(); s.notes ??= {}; s.settings ??= {}; const day = todayOf(p);
  const req = r.job === 'moment' ? [10, 20].map((hour) => buildRequest('moment', s, day, weekKeyOf(day), null, { hour })).find(Boolean) : buildRequest('hermes', s, day, weekKeyOf(day));
  for (const x of JSON.parse(r.raw).ideas.slice(0, 3)) {
    if (parseHermes(req, { ideas: [x] }, s, day)?.length) continue;
    const loose = parseHermes(req, { ideas: [x] }, null, day)?.length;
    const i = { ...x }; for (const k of Object.keys(i)) if (i[k] == null) delete i[k];
    console.log(`${r.person} · ${x.kind} "${x.title}" → ${loose ? `isValid=${isValid(s, x, day)}` : 'text/number/id check'}\n   ${JSON.stringify(i)}`);
  }
}
