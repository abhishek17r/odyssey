// Safety, in code: words that suggest crisis or self-harm get one fixed, kind line before anything else runs
// (template or AI). The AI is told the same, but this doesn't depend on it.

const CRISIS = [
  /\bsuicid/i, /\bkill(ing)? myself\b/i, /\b(hurt|harm)(ing)? myself\b/i, /\bself[- ]?harm/i, /\bcut(ting)? myself\b/i,
  /\bend (it all|my life|everything)\b/i, /\bwant to die\b/i, /\bwish i (was|were) dead\b/i, /\bbetter off without me\b/i,
  /\b(don'?t|do not) want to (live|be here|be alive|wake up)\b/i, /\bno (point|reason) (in )?(living|being alive|going on)\b/i,
  /\b(can'?t|cannot) (see the point|go on|take (it|this) anymore)\b/i, /\bnothing (i do )?matters( anymore)?\b/i, /\bhopeless\b/i,
  /\bnot worth living\b/i, /\bgive up on (life|everything)\b/i,
];

// phones type curly apostrophes (don’t); match both
export const crisisIn = (text) => { const t = String(text || '').replace(/[\u2018\u2019\u02bc]/g, "'"); return CRISIS.some((re) => re.test(t)); };

// India first (Tele-MANAS, the government's free mental-health line, 24×7).
export const CRISIS_LINE = 'That sounds really heavy, and I’m glad you wrote it down. Please talk to someone you trust tonight, or call Tele-MANAS on 14416: it’s free, any time.';
