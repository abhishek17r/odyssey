// The launch splash (phone app only): at least 4 s, and until the first sync has loaded your data
// (at most 9 s). Tap to skip.
(() => {
  const s = document.getElementById('splash');
  if (!s) return;
  const web = document.body.classList.contains('web');
  let seen = false;
  try { seen = !!sessionStorage.getItem('splashed'); sessionStorage.setItem('splashed', '1'); } catch { /* private mode */ }
  if (!web || seen) { s.remove(); return; }
  const go = () => { if (!s.isConnected || s.classList.contains('out')) return; s.classList.add('out'); setTimeout(() => s.remove(), 900); };
  s.addEventListener('click', go);
  let minDone = false;
  const maybe = () => { if (minDone && window.odysseyReady) go(); };
  setTimeout(() => { minDone = true; maybe(); }, 4000);
  addEventListener('odyssey:ready', maybe);
  setTimeout(go, 9000);
})();
