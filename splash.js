// The launch splash (phone app only): a short moment (at least 1.2 s), and until your data has loaded
// (at most 3 s). Tap to skip.
(() => {
  const s = document.getElementById('splash');
  if (!s) return;
  const web = document.body.classList.contains('web');
  let seen = false;
  try { seen = !!sessionStorage.getItem('splashed'); sessionStorage.setItem('splashed', '1'); } catch { /* private mode */ }
  if (!web || seen) { s.remove(); return; }
  const go = () => { if (!s.isConnected || s.classList.contains('out')) return; s.classList.add('out'); setTimeout(() => s.remove(), 500); };
  s.addEventListener('click', go);
  let minDone = false;
  const maybe = () => { if (minDone && window.odysseyReady) go(); };
  setTimeout(() => { minDone = true; maybe(); }, 1200);
  addEventListener('odyssey:ready', maybe);
  setTimeout(go, 3000);
})();
