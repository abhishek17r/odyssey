// The launch splash (phone app only): at least 3 s, and until your data has loaded (at most 4.5 s). Tap to skip.
// Under the name, a small "loading" line from the voyage: one, picked at random on each launch, with dots that count
// 1, 2, 3, none, and round again.
const VOYAGE_LINES = [
  'Setting the mast',
  'Trimming the sails',
  'Steering your ship',
  'Reading the stars',
  'Checking the winds',
  'Raising the anchor',
  'Waking the crew',
  'Charting today’s course',
  'Rowing out of the harbour',
  'Lighting the lamps',
  'Catching a fair wind',
  'Rough seas ahead, holding the course',
  'Asking Athena for a fair wind',
  'Plotting a course for Ithaca',
];
(() => {
  const s = document.getElementById('splash');
  if (!s) return;
  const web = document.body.classList.contains('web');
  let seen = false;
  try { seen = !!sessionStorage.getItem('splashed'); sessionStorage.setItem('splashed', '1'); } catch { /* private mode */ }
  if (!web || seen) { s.remove(); return; }
  // one line for this launch, and its dots
  const line = s.querySelector('.spLine');
  let dots = null;
  if (line) {
    line.textContent = VOYAGE_LINES[Math.floor(Math.random() * VOYAGE_LINES.length)];
    const d = document.createElement('span');
    d.className = 'spDots';
    d.ariaHidden = 'true';
    line.append(d);
    let n = 0;
    dots = setInterval(() => { n = (n + 1) % 4; d.textContent = '.'.repeat(n); }, 400);
  }
  const go = () => { if (!s.isConnected || s.classList.contains('out')) return; clearInterval(dots); s.classList.add('out'); setTimeout(() => s.remove(), 500); };
  s.addEventListener('click', go);
  let minDone = false;
  const maybe = () => { if (minDone && window.odysseyReady) go(); };
  setTimeout(() => { minDone = true; maybe(); }, 3000);
  addEventListener('odyssey:ready', maybe);
  setTimeout(go, 4500);
})();
