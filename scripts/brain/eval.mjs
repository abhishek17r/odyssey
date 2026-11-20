#!/usr/bin/env node
// B0: run the brain's test set on each model and write a report (docs/brain.md → Evaluation, milestone B0).
//
//   node scripts/brain/eval.mjs --dry                      no calls: builds every request, prints sizes and a cost estimate
//   node scripts/brain/eval.mjs                            every person × job × model (needs keys; costs real money, ~US$1–2)
//   node scripts/brain/eval.mjs --models claude-haiku-5-5,gpt-5-nano --jobs morning --people gym-stall,low-mood --repeat 2
//   node scripts/brain/eval.mjs --set core --models gpt-5.4-mini        the 7-person core set (about a third of the cost)
//   node scripts/brain/eval.mjs --spend                                 what testing has cost so far
//
// Saving money: every answer is cached (scripts/brain/cache/, by model + exact request), so a rerun only pays for
// requests whose prompt or facts changed (--fresh to ask again). A run that would cost more than --max-spend
// (default US$0.30) stops before it starts.
//
// Keys: OPENAI_API_KEY and ANTHROPIC_API_KEY from the environment, or from .secrets/brain.env (KEY=value lines,
// never committed). Claude also works with an `ant auth login` profile. Output: scripts/brain/out/<time>/ (ignored by git).

import fs from 'node:fs';
import crypto from 'node:crypto';
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
// the core set: one of each kind of hard case (the safety case is answered in code and costs nothing)
const CORE = ['smoker-slipping', 'gym-stall', 'overloaded', 'paused-week', 'deadline-crunch', 'comeback', 'low-mood'];
const people = PERSONAS.filter((p) => list('people', arg('set') === 'core' ? CORE : PERSONAS.map((x) => x.id)).includes(p.id));
const maxSpend = Number(arg('max-spend', 0.30));
const monthlyCap = Number(arg('monthly-cap', 5));      // all testing this calendar month, from the ledger
const personCap = Number(arg('person-cap', 0.01));     // one test person, one run
const fresh = process.argv.includes('--fresh');
const outDir = path.join(here, 'out');
const ledger = path.join(outDir, 'ledger.jsonl');
const fmtUSD = (x) => `$${x.toFixed(x < 1 ? 4 : 2)}`;

if (process.argv.includes('--spend')) {
  const rows = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const total = rows.reduce((a, r) => a + r.spend, 0);
  console.log(`${rows.length} runs · ${rows.reduce((a, r) => a + r.paid, 0)} paid calls · ${rows.reduce((a, r) => a + r.cached, 0)} from cache · spent ${fmtUSD(total)} (₹${(total * 88).toFixed(2)})`);
  for (const r of rows) console.log(`  ${r.at.slice(0, 16)}  ${fmtUSD(r.spend).padStart(8)}  ${String(r.paid).padStart(4)} paid ${String(r.cached).padStart(4)} cached  ${r.models.join(', ')} · ${r.set}`);
  process.exit(0);
}
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

// ---------- cache and estimates ----------
const cacheDir = path.join(here, 'cache');
const cacheKey = (model, req) => crypto.createHash('sha256').update(JSON.stringify([model, req.system, req.user, req.schema])).digest('hex').slice(0, 32);
const fromCache = (model, req) => { if (fresh) return null; const f = path.join(cacheDir, `${cacheKey(model, req)}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const toCache = (model, req, a) => { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, `${cacheKey(model, req)}.json`), JSON.stringify(a)); };
// measured tokens per model and job from earlier runs; a model never run borrows gpt-5-mini's (or the char estimate)
const history = {};
for (const dir of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
  const f = path.join(outDir, dir, 'results.jsonl');
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').trim().split('\n')) { try { const r = JSON.parse(l); if (r.tin && !r.cached) (history[`${r.model}|${r.job}`] ??= []).push(r); } catch { /* skip */ } }
}
const tokensOf = (model, r) => {
  const own = history[`${model}|${r.req.job}`];
  const h = own || history[`gpt-5-mini|${r.req.job}`];
  if (h?.length) return { tin: h.reduce((a, x) => a + x.tin, 0) / h.length, tout: h.reduce((a, x) => a + x.tout, 0) / h.length, measured: !!own };
  return { tin: estIn(r), tout: EST_OUT[r.req.job], measured: false };
};
const estimate = (model, rs) => rs.reduce((a, r) => (r.req.fixed || fromCache(model, r.req) ? a : a + costOf({ model, ...tokensOf(model, r) })), 0);

if (dry) {
  console.log(`${requests.length} requests × ${models.length} models × ${repeat} = ${requests.length * models.length * repeat} calls\n`);
  for (const job of jobs) {
    const rs = requests.filter((r) => r.req.job === job);
    if (!rs.length) continue;
    const avg = Math.round(rs.reduce((a, r) => a + estIn(r), 0) / rs.length);
    console.log(`${job.padEnd(10)} ${String(rs.length).padStart(2)} people · ~${avg} input tokens · ~${EST_OUT[job]} output`);
  }
  console.log('\nEstimated cost, per model:');
  let total = 0;
  for (const m of models) {
    const c = estimate(m, requests) * repeat;
    total += c;
    const cached = requests.filter((r) => fromCache(m, r.req)).length;
    const perUser = Object.entries({ morning: 30, evening: 20, proposals: 30, weekly: 4.3 }).reduce((acc, [job, n]) => {
      const r = requests.find((x) => x.req.job === job && !x.req.fixed);
      return r ? acc + costOf({ model: m, ...tokensOf(m, r) }) * n : acc;
    }, 0);
    console.log(`  ${m.padEnd(18)} ${fmt$(c).padStart(9)} this run · live: $${perUser.toFixed(4)} (₹${(perUser * 88).toFixed(2)}) a user a month${cached ? `  (${cached} of ${requests.length} already cached)` : ''}${requests.every((r) => r.req.fixed || tokensOf(m, r).measured) ? '' : '  · tokens estimated'}`);
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
const unpriced = models.filter((m) => !PRICES[m]);
if (unpriced.length) { console.error(`No price for ${unpriced.join(', ')}: add it to PRICES in providers.mjs first.`); process.exit(1); }
const planned = models.reduce((a, m) => a + estimate(m, requests), 0) * repeat;
console.log(`About ${fmtUSD(planned)} to run (${people.length} people, ${models.join(', ')}).`);
if (planned > maxSpend) { console.error(`That's over the cap of ${fmtUSD(maxSpend)}. Use --set core, fewer --models, or raise --max-spend.`); process.exit(1); }
const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
const spentThisMonth = (fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  .filter((r) => new Date(r.at.length > 19 ? r.at : `${r.at.slice(0, 10)}T${r.at.slice(11).replace(/-/g, ':')}Z`) >= monthStart).reduce((a, r) => a + r.spend, 0);
if (spentThisMonth + planned > monthlyCap) { console.error(`Testing has spent ${fmtUSD(spentThisMonth)} this month; this run would pass the ${fmtUSD(monthlyCap)} monthly cap. Raise --monthly-cap to go on.`); process.exit(1); }
const over = requests.filter((r) => r.req.overBudget);
if (over.length) console.log(`${over.length} request(s) over their input budget will not be sent: ${over.map((r) => `${r.p.id}/${r.req.job} ${r.req.estIn}`).join(', ')}`);

// ---------- run ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(here, 'out', stamp);
fs.mkdirSync(out, { recursive: true });
const jobsToRun = [];
for (let i = 0; i < repeat; i++) for (const r of requests) for (const m of models) jobsToRun.push({ ...r, model: m, i });
const results = [];
const personSpend = {};
let done = 0;
async function worker() {
  while (jobsToRun.length) {
    const j = jobsToRun.shift();
    let a = j.req.fixed ? { ok: true, text: JSON.stringify(j.req.fixed), model: 'code', tin: 0, tout: 0, ms: 0, free: true } : j.i === 0 ? fromCache(j.model, j.req) : null;
    if (a && !a.free) a = { ...a, cached: true };
    const pk = `${j.p.id}|${j.model}|${j.i}`;
    if (!a && j.req.overBudget) a = { ok: false, text: '', model: j.model, tin: 0, tout: 0, ms: 0, error: `over input budget (${j.req.estIn} tokens)` };
    if (!a && (personSpend[pk] || 0) >= personCap) a = { ok: false, text: '', model: j.model, tin: 0, tout: 0, ms: 0, error: `person cap ($${personCap}) reached` };
    if (!a) { a = await call(j.req, j.model, keys); if (a.ok && j.i === 0) toCache(j.model, j.req, a); }
    personSpend[pk] = (personSpend[pk] || 0) + costOf(a);
    const c = a.ok ? check(j.req, a.text, j.p, j.d) : { pass: false, checks: [{ name: 'call', ok: false, detail: a.error }], text: '' };
    const row = { person: j.p.id, job: j.req.job, model: j.model, servedBy: a.model, run: j.i, ok: a.ok, cached: !!a.cached, pass: c.pass, failed: c.checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ''}`), text: c.text, raw: a.text, tin: a.tin, tout: a.tout, cachedIn: a.cachedIn || 0, cost: costOf(a), ms: a.ms, stop: a.stop, fallback: a.fallback || false, error: a.error || null };
    results.push(row);
    fs.appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(row) + '\n');
    process.stdout.write(`\r${++done} calls`);
  }
}
await Promise.all(Array.from({ length: Number(arg('concurrency', 4)) }, worker));
console.log('');
const spent = results.reduce((a, r) => a + r.cost, 0);
fs.appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), models, set: arg('set') || (arg('people') ? 'custom' : 'all'), paid: results.filter((r) => !r.cached && r.servedBy !== 'code').length, cached: results.filter((r) => r.cached).length, spend: spent }) + '\n');
console.log(`Spent ${fmtUSD(spent)} (${results.filter((r) => r.cached).length} answers from the cache).`);

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
// cost alerts: paid calls over 3x the average for their model and job in this run
const avgCost = {};
for (const r of results.filter((x) => !x.cached && x.cost > 0)) (avgCost[`${r.model}|${r.job}`] ??= []).push(r.cost);
const alerts = results.filter((r) => !r.cached && r.cost > 0 && r.cost > 3 * mean(avgCost[`${r.model}|${r.job}`], (x) => x));
lines.push('', '## Cost alerts', '', ...(alerts.length ? alerts.map((r) => `- ${r.model} · ${r.job} · ${r.person}: ${fmt$(r.cost)} (${r.tin} in / ${r.tout} out)`) : ['None: no call cost more than 3× its average.']));
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
