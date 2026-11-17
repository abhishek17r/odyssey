// The launch splash (phone app only): shown once per launch for ~2 s, tap to skip.
(() => {
  const s = document.getElementById('splash');
  if (!s) return;
  const web = document.body.classList.contains('web');
  let seen = false;
  try { seen = !!sessionStorage.getItem('splashed'); sessionStorage.setItem('splashed', '1'); } catch { /* private mode */ }
  if (!web || seen || matchMedia('(prefers-reduced-motion: reduce)').matches && seen) { s.remove(); return; }
  const go = () => { if (!s.isConnected || s.classList.contains('out')) return; s.classList.add('out'); setTimeout(() => s.remove(), 700); };
  s.addEventListener('click', go);
  setTimeout(go, 2200);
})();
