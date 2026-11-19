// B0: one adapter per provider, same in and out. in: a job request from jobs.mjs; out:
// { ok, text, model, tin, tout, cachedIn, cacheWrite, ms, stop, error?, fallback? }.
// OpenAI is called the way the odyssey-athena function calls it today (fetch); Claude through the Anthropic SDK.

// US$ per million tokens: [input, output, cached input]
export const PRICES = {
  // OpenAI, standard tier, short context (developers.openai.com/api/docs/pricing, read 20 Nov 2026)
  'gpt-5-nano': [0.05, 0.4, 0.005],
  'gpt-5-mini': [0.25, 2.0, 0.025],
  'gpt-5.4-nano': [0.20, 1.25, 0.02],
  'gpt-5.4-mini': [0.75, 4.50, 0.075],
  'gpt-5.4': [2.50, 15.0, 0.25],
  'gpt-5.6-luna': [0.20, 1.20, 0.02],
  'gpt-5.6-terra': [2.0, 12.0, 0.20],
  'gpt-5.6-sol': [4.0, 20.0, 0.40], // promotional until 30 Nov 2026
  'gpt-5.5': [5.0, 30.0, 0.50],
  'gpt-4.1-mini': [0.40, 1.60, 0.10],
  // Anthropic
  'claude-haiku-5-5': [0.10, 0.50, 0.01], // prompts under 100K tokens
  'claude-sonnet-5-5': [2.0, 10.0, 0.10],
};
export const costOf = (r) => {
  const p = PRICES[r.model] || PRICES[Object.keys(PRICES).find((k) => String(r.model).startsWith(k))] || [0, 0, 0];
  if (r.cached) return 0; // answered from the local cache
  const fresh = Math.max(0, (r.tin || 0) - (r.cachedIn || 0));
  return (fresh * p[0] + (r.cachedIn || 0) * p[2] + (r.cacheWrite || 0) * p[0] * 0.25 + (r.tout || 0) * p[1]) / 1e6;
};

export const MODELS = ['gpt-5-nano', 'gpt-5-mini', 'claude-haiku-5-5', 'claude-sonnet-5-5'];
export const providerOf = (model) => (model.startsWith('claude-') ? 'anthropic' : 'openai');

// gpt-4.1 has no reasoning; gpt-5 takes 'minimal'; later models call the lowest setting 'none'
const effortOf = (model, tier) => (model.startsWith('gpt-4') ? null : model.startsWith('gpt-5-') || model === 'gpt-5' ? (tier === 'large' ? 'low' : 'minimal') : (tier === 'large' ? 'low' : 'none'));

async function openai(req, model, key) {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      response_format: { type: 'json_schema', json_schema: { name: req.job, schema: req.schema, strict: true } },
      ...(effortOf(model, req.tier) ? { reasoning_effort: effortOf(model, req.tier) } : {}),
      max_completion_tokens: 4000,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  const u = body.usage || {};
  return {
    ok: res.ok, text: body.choices?.[0]?.message?.content || '', model: body.model || model, ms: Date.now() - t0,
    tin: u.prompt_tokens || 0, tout: u.completion_tokens || 0, cachedIn: u.prompt_tokens_details?.cached_tokens || 0,
    stop: body.choices?.[0]?.finish_reason || null, ...(res.ok ? {} : { error: String(body.error?.message || res.status).slice(0, 200) }),
  };
}

let client = null;
async function anthropic(req, model) {
  if (!client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ timeout: 60_000, maxRetries: 2 }); // ANTHROPIC_API_KEY or an `ant auth login` profile
  }
  const t0 = Date.now();
  const params = {
    model,
    max_tokens: 4000,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    // thinking stays adaptive (the default on these models); effort keeps it short for small jobs
    output_config: { effort: req.tier === 'large' ? 'medium' : 'low', format: { type: 'json_schema', schema: req.schema } },
  };
  try {
    // Sonnet 5.5: the server-side refusal fallback, so a false-positive decline still gets an answer (recorded)
    const r = model === 'claude-sonnet-5-5'
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    const u = r.usage || {};
    const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return {
      ok: r.stop_reason !== 'refusal', text, model: r.model || model, ms: Date.now() - t0, stop: r.stop_reason,
      tin: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tout: u.output_tokens || 0,
      cachedIn: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
      fallback: (u.iterations || []).some((e) => e.type === 'fallback_message') || undefined,
      ...(r.stop_reason === 'refusal' ? { error: `refusal: ${r.stop_details?.category || 'unknown'}` } : {}),
    };
  } catch (e) {
    return { ok: false, text: '', model, ms: Date.now() - t0, tin: 0, tout: 0, error: `${e?.constructor?.name || 'Error'} ${e?.status || ''}: ${String(e?.message).slice(0, 160)}` };
  }
}

export async function call(req, model, keys) {
  try {
    return providerOf(model) === 'anthropic' ? await anthropic(req, model) : await openai(req, model, keys.OPENAI_API_KEY);
  } catch (e) {
    return { ok: false, text: '', model, ms: 0, tin: 0, tout: 0, error: String(e?.message || e).slice(0, 200) };
  }
}
