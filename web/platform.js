// The web app's stand-in for the chrome.* APIs the extension code uses, so the same modules run in a
// browser: storage (localStorage, with change events), alarms (timers, while the app is open),
// notifications (through the service worker), tabs (navigation). Loaded before any module.
(() => {
  const P = 'odyssey:';
  const listeners = [];
  const readKey = (k) => { const v = localStorage.getItem(P + k); return v == null ? undefined : JSON.parse(v); };
  const allKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(P)).map((k) => k.slice(P.length));
  const fire = (changes) => { if (Object.keys(changes).length) for (const f of listeners) setTimeout(() => f(changes, 'local'), 0); };
  const local = {
    async get(keys) {
      const list = keys == null ? allKeys() : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of list) { const v = readKey(k); if (v !== undefined) out[k] = v; }
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        const oldValue = readKey(k);
        const s = JSON.stringify(v);
        localStorage.setItem(P + k, s);
        changes[k] = { oldValue, newValue: JSON.parse(s) };
      }
      fire(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) { const oldValue = readKey(k); if (oldValue !== undefined) { localStorage.removeItem(P + k); changes[k] = { oldValue }; } }
      fire(changes);
    },
    async clear() {
      const changes = {};
      for (const k of allKeys()) { changes[k] = { oldValue: readKey(k) }; localStorage.removeItem(P + k); }
      fire(changes);
    },
  };
  // other tabs / windows of the app
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(P)) return;
    const k = e.key.slice(P.length);
    fire({ [k]: { oldValue: e.oldValue ? JSON.parse(e.oldValue) : undefined, newValue: e.newValue ? JSON.parse(e.newValue) : undefined } });
  });

  // alarms: only while the app is open; the app re-creates what it needs when it comes back
  const alarms = new Map();
  const alarmListeners = [];
  const ring = (name) => alarmListeners.forEach((f) => f({ name }));
  const alarmsApi = {
    create(name, info = {}) {
      alarmsApi.clear(name);
      const when = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
      const a = { name, scheduledTime: when, periodInMinutes: info.periodInMinutes };
      a.timer = setTimeout(function go() {
        ring(name);
        if (a.periodInMinutes) { a.scheduledTime = Date.now() + a.periodInMinutes * 60000; a.timer = setTimeout(go, a.periodInMinutes * 60000); } else alarms.delete(name);
      }, Math.max(0, when - Date.now()));
      alarms.set(name, a);
    },
    async clear(name) { const a = alarms.get(name); if (a) { clearTimeout(a.timer); alarms.delete(name); } return !!a; },
    async get(name) { const a = alarms.get(name); return a ? { name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes } : undefined; },
    async getAll() { return [...alarms.values()].map(({ name, scheduledTime, periodInMinutes }) => ({ name, scheduledTime, periodInMinutes })); },
    onAlarm: { addListener: (f) => alarmListeners.push(f) },
  };

  const notifications = {
    async create(id, opts) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker?.ready;
      if (reg) reg.showNotification(opts.title, { body: opts.message, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: String(id).split('-')[0], data: { url: opts.url || './' } });
      else new Notification(opts.title, { body: opts.message });
    },
    onClicked: { addListener() {} }, onButtonClicked: { addListener() {} }, clear() {},
  };

  window.chrome = {
    storage: { local, onChanged: { addListener: (f) => listeners.push(f) } },
    alarms: alarmsApi,
    notifications,
    runtime: { getURL: (p) => p, id: 'web', sendMessage() {}, onMessage: { addListener() {} } },
    // extension page names → the web app's clean addresses (dashboard.html#x → dashboard#x, index.html → ./)
    tabs: { create: ({ url }) => { if (/^https?:/.test(url)) window.open(url, '_blank', 'noopener'); else location.href = url.replace(/^(popup|index)\.html/, './').replace(/\.html(?=$|[#?])/, ''); } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, openPopup: async () => { location.href = './'; } },
  };
  window.ODYSSEY_WEB = true;
})();
