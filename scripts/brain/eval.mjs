#!/usr/bin/env node
// B0: run the brain's test set on each model and write a report (docs/brain.md → Evaluation, milestone B0).
//
//   node scripts/brain/eval.mjs --dry                      no calls: builds every request, prints sizes and a cost estimate
//   node scripts/brain/eval.mjs                            every person × job × model (needs keys; costs real money, ~US$1–2)
//   node scripts/brain/eval.mjs --models claude-haiku-5-5,gpt-5-nano --jobs morning --people gym-stall,low-mood --repeat 2
//
// Keys: OPENAI_API_KEY and ANTHROPIC_API_KEY from the environment, or from .secrets/brain.env (KEY=value lines,
// never committed). Claude also works with an `ant auth login` profile. Output: scripts/brain/out/<time>/ (ignored by git).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONAS, todayOf } from './personas.mjs';
import { JOBS, buildJob, check } from './jobs.mjs';
import { MODELS, PRICES, call, costOf, providerOf } from './providers.mjs';
import { digest } from '../../lib/digest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = (name, def = null) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const list = (name, all) => (arg(name) ? arg(name).split(',').map((s) => s.trim()).filter(Boolean) : all);
const dry = process.argv.includes('--dry');
const models = list('models', MODELS);
const jobs = list('jobs', Object.keys(JOBS));
const people = PERSONAS.filter((p) => list('people', PERSONAS.map((x) => x.id)).includes(p.id));
const repeat = Number(arg('repeat', 1)) || 1;

// keys: env first, then .secrets/brain.env
const keys = { ...process.env };
const envFile = path.join(root, '.secrets', 'brain.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m && !keys[m[1]]) keys[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
if (keys.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = keys.ANTHROPIC_API_KEY;

// every request: person × job (evening only where there's a reflection)
const requests = [];
for (const p of people) {
  const state = p.build();
  const day = todayOf(p);
  const d = digest(state, day, { hour: 8 });
  for (const job of jobs) {
    const reflection = state.days?.[day]?.reflection || null;
    if (job === 'evening' && !reflection) continue;
    if (p.id === 'low-mood' && job !== 'evening') continue; // the safety case is only about the evening reply
    requests.push({ p, d, req: buildJob(job, d, { reflection: job === 'evening' ? reflection : null }) });
  }
}

const estIn = (r) => Math.round((r.req.system.length + r.req.user.length + JSON.stringify(r.req.schema).length) / 3.6);
const EST_OUT = { morning: 350, evening: 350, weekly: 900, proposals: 900 }; // incl. a little thinking/reasoning
const fmt$ = (x) => (x < 0.01 ? `$${x.toFixed(5)}` : `$${x.toFixed(4)}`);

if (dry) {
  console.log(`${requests.length} requests × ${models.length} models × ${repeat} = ${requests.length * models.length * repeat} calls\n`);
  for (const job of jobs) {
    const rs = requests.filter((r) => r.req.job === job);
    if (!rs.length) continue;
    const avg = Math.round(rs.reduce((a, r) => a + estIn(r), 0) / rs.length);
    console.log(`${job.padEnd(10)} ${String(rs.length).padStart(2)} people · ~${avg} input tokens · ~${EST_OUT[job]} output`);
  }
  console.log('\nEstimated cost of a full run, per model:');
  let total = 0;
  for (const m of models) {
    const c = requests.reduce((a, r) => a + costOf({ model: m, tin: estIn(r), tout: EST_OUT[r.req.job] }), 0) * repeat;
    total += c;
    console.log(`  ${m.padEnd(18)} ${fmt$(c)}`);
  }
  console.log(`  ${'all'.padEnd(18)} ${fmt$(total)}`);
  const missing = [...new Set(models.map(providerOf))].filter((pv) => (pv === 'openai' ? !keys.OPENAI_API_KEY : !keys.ANTHROPIC_API_KEY));
  if (missing.length) console.log(`\nNo key yet for: ${missing.join(', ')} (env or .secrets/brain.env${missing.includes('anthropic') ? '; or `ant auth login`' : ''}).`);
  const out = path.join(here, 'out', 'dry');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'requests.jsonl'), requests.map((r) => JSON.stringify({ person: r.p.id, job: r.req.job, system: r.req.system, user: JSON.parse(r.req.user) })).join('\n'));
  console.log(`\nRequests written to ${path.relative(root, out)}/requests.jsonl`);
  process.exit(0);
}

if (models.some((m) => providerOf(m) === 'openai') && !keys.OPENAI_API_KEY) { console.error('OPENAI_API_KEY missing (env or .secrets/brain.env). Use --models to run Claude only.'); process.exit(1); }

// ---------- run ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(here, 'out', stamp);
fs.mkdirSync(out, { recursive: true });
const jobsToRun = [];
for (let i = 0; i < repeat; i++) for (const r of requests) for (const m of models) jobsToRun.push({ ...r, model: m, i });
const results = [];
let done = 0;
async function worker() {
  while (jobsToRun.length) {
    const j = jobsToRun.shift();
    const a = await call(j.req, j.model, keys);
    const c = a.ok ? check(j.req, a.text, j.p, j.d) : { pass: false, checks: [{ name: 'call', ok: false, detail: a.error }], text: '' };
    const row = { person: j.p.id, job: j.req.job, model: j.model, servedBy: a.model, run: j.i, ok: a.ok, pass: c.pass, failed: c.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ''}`), text: c.text, raw: a.text, tin: a.tin, tout: a.tout, cachedIn: a.cachedIn || 0, cost: costOf(a), ms: a.ms, stop: a.stop, fallback: a.fallback || false, error: a.error || null };
    results.push(row);
    fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n');
    process.stdout.write(`\r${++done} calls`);
  }
}
await Promise.all(Array.from({ length: Number(arg('concurrency', 4)) }, worker));
console.log('');

// ---------- report ----------
const by = (xs, f) => xs.reduce((a, x) => ((a[f(x)] ??= []).push(x), a), {});
const pct = (xs) => `${Math.round((100 * xs.filter((x) => x.pass).length) / (xs.length || 1))}%`;
const mean = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / (xs.length || 1);
const p50 = (xs) => { const s = xs.map((x) => x.ms).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 0; };
// per active user per month: 30 mornings, 20 evening replies, 30 proposal runs, 4.3 weekly reads
const MONTH = { morning: 30, evening: 20, proposals: 30, weekly: 4.3 };

const lines = [`# Brain B0 · test-set run ${stamp}`, '', `${people.length} people · jobs ${jobs.join(', ')} · ${results.length} calls · total ${fmt$(results.reduce((a, r) => a + r.cost, 0))}`, ''];
lines.push('## Pass rate, cost and speed', '', '| Model | Job | Pass | Calls | Avg in | Avg out | Cost / call | p50 ms |', '|---|---|---|---|---|---|---|---|');
const cell = {};
for (const m of models) for (const job of jobs) {
  const xs = results.filter((r) => r.model === m && r.job === job);
  if (!xs.length) continue;
  cell[`${m}|${job}`] = { pass: xs.filter((x) => x.pass).length / xs.length, cost: mean(xs, (x) => x.cost) };
  lines.push(`| ${m} | ${job} | ${pct(xs)} | ${xs.length} | ${Math.round(mean(xs, (x) => x.tin))} | ${Math.round(mean(xs, (x) => x.tout))} | ${fmt$(mean(xs, (x) => x.cost))} | ${p50(xs)} |`);
}
lines.push('', '## Cost per active user per month (one model for everything)', '', '| Model | Pass (all jobs) | US$ / user / month | ₹ / user / month (₹88/$) |', '|---|---|---|---|');
for (const m of models) {
  const xs = results.filter((r) => r.model === m);
  const month = jobs.reduce((a, job) => a + (cell[`${m}|${job}`]?.cost || 0) * (MONTH[job] || 0), 0);
  lines.push(`| ${m} | ${pct(xs)} | $${month.toFixed(4)} | ₹${(month * 88).toFixed(2)} |`);
}
// best per tier: the cheapest model within 5 points of the best pass rate on that tier's jobs
const tierPick = {};
for (const tier of ['small', 'large']) {
  const tj = jobs.filter((j) => JOBS[j].tier === tier);
  if (!tj.length) continue;
  const score = models.map((m) => { const xs = results.filter((r) => r.model === m && tj.includes(r.job)); return { m, pass: xs.filter((x) => x.pass).length / (xs.length || 1), cost: mean(xs, (x) => x.cost) }; });
  const best = Math.max(...score.map((s) => s.pass));
  tierPick[tier] = score.filter((s) => s.pass >= best - 0.05).sort((a, b) => a.cost - b.cost)[0];
}
if (tierPick.small || tierPick.large) {
  const month = jobs.reduce((a, job) => { const pick = tierPick[JOBS[job].tier]; return a + (pick ? (cell[`${pick.m}|${job}`]?.cost || 0) * (MONTH[job] || 0) : 0); }, 0);
  lines.push('', `**Suggested by the checks alone:** small tier → ${tierPick.small?.m || '—'}, large tier → ${tierPick.large?.m || '—'} (cheapest within 5 points of the best pass rate) · about $${month.toFixed(4)} (₹${(month * 88).toFixed(2)}) per active user per month. Read the answers below before deciding: the checks catch wrong numbers and unsafe advice, not tone.`);
}
const fails = by(results.flatMap((r) => r.failed.map((f) => ({ ...r, f: f.replace(/ \(.*/, '') }))), (x) => `${x.model} · ${x.f}`);
lines.push('', '## Most common failures', '', ...Object.entries(fails).sort((a, b) => b[1].length - a[1].length).slice(0, 20).map(([k, xs]) => `- ${k}: ${xs.length} (${[...new Set(xs.map((x) => x.person))].slice(0, 4).join(', ')})`));
lines.push('', '## The answers, side by side', '');
for (const p of people) {
  const xs = results.filter((r) => r.person === p.id && r.run === 0);
  if (!xs.length) continue;
  lines.push(`### ${p.id} · ${p.about}`, '', `_A good answer:_ ${p.good}`, '');
  for (const job of jobs) {
    const ys = xs.filter((r) => r.job === job);
    if (!ys.length) continue;
    lines.push(`**${job}**`, '');
    for (const r of ys) {
      const body = r.job === 'proposals' ? (() => { try { return JSON.parse(r.raw).proposals.map((q) => `${q.kind}${q.taskId ? ` ${q.taskId}` : ''}${q.goalId ? ` ${q.goalId}` : ''}${q.to ? ` → ${q.to}` : ''}${q.at ? ` @ ${q.at}` : ''}${q.minutes ? ` ${q.minutes} min` : ''}${q.target != null ? ` target ${q.target}` : ''}${q.tiny ? ` “${q.tiny}”` : ''}${q.steps ? ` [${q.steps.join(' / ')}]` : ''}${q.text ? ` “${q.text}”` : ''} · ${q.why}`).join('<br>') || '(none)'; } catch { return r.text; } })() : r.text;
      lines.push(`- ${r.pass ? '✓' : '✗'} \`${r.model}\`${r.fallback ? ' (fallback)' : ''}: ${body || '—'}${r.failed.length ? ` _(${r.failed.join('; ')})_` : ''}`);
    }
    lines.push('');
  }
}
fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
console.log(`Report: ${path.relative(root, path.join(out, 'report.md'))}`);
