#!/usr/bin/env node
// Re-check a finished run with the current checks (no new calls): node scripts/brain/rescore.mjs scripts/brain/out/<time>
import fs from 'node:fs';
import path from 'node:path';
import { PERSONAS, todayOf } from './personas.mjs';
import { buildJob, check } from './jobs.mjs';
import { digest } from '../../lib/digest.js';

const dir = process.argv[2];
const rows = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const cache = {};
for (const r of rows) {
  if (!r.ok) continue;
  const p = PERSONAS.find((x) => x.id === r.person);
  const state = p.build(); const day = todayOf(p);
  const d = (cache[p.id] ??= digest(state, day, { hour: 8 }));
  const req = buildJob(r.job, d, { reflection: r.job === 'evening' ? state.days?.[day]?.reflection : null, state });
  const c = check(req, r.raw, p, d);
  r.pass = c.pass; r.failed = c.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ''}`);
}
const t = {};
for (const r of rows) { const k = `${r.model} | ${r.job}`; (t[k] ??= [0, 0]); t[k][1]++; if (r.pass) t[k][0]++; }
for (const [k, [a, b]] of Object.entries(t)) console.log(`${k.padEnd(32)} ${Math.round((100 * a) / b)}%  (${a}/${b})`);
fs.writeFileSync(path.join(dir, 'results.rescored.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'));
