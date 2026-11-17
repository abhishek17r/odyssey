// Builds the web app (PWA) into dist/web from the same source as the Chrome extension.
//   node scripts/build-web.mjs
// Then deploy dist/web to any static host (see SETUP.md for Cloudflare Pages).
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, 'dist', 'web');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const copy = (from, to = from) => cp(join(root, from), join(out, to), { recursive: true });
for (const f of ['lib', 'icons', 'config.js', 'rewards.config.js', 'styles.css', 'popup.css', 'dashboard.css', 'popup.js', 'dashboard.js']) await copy(f);
for (const f of ['platform.js', 'app.js', 'web.css', 'manifest.webmanifest']) await copy(join('web', f), f);
await cp(join(root, 'web', 'icons'), join(out, 'icons'), { recursive: true });

const HEAD = `
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0c1a3a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Odyssey" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" href="icons/logo.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />`;

async function page(src, dest, bodyClass) {
  let html = await readFile(join(root, src), 'utf8');
  html = html.replace(/<meta name="viewport"[^>]*>\s*/i, '');
  html = html.replace('</head>', `${HEAD}\n  <link rel="stylesheet" href="web.css" />\n</head>`);
  html = html.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs} class="web ${bodyClass}">`);
  html = html.replace(/<script type="module" src="(\w+)\.js"><\/script>/,
    '<script src="platform.js"></script>\n  <script type="module" src="$1.js"></script>\n  <script type="module" src="app.js"></script>');
  await writeFile(join(out, dest), html);
}
await page('popup.html', 'index.html', 'home');
await page('dashboard.html', 'dashboard.html', 'dash');

// service worker with the file list and a build stamp
async function list(dir) {
  const files = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) files.push(...(await list(p)));
    else files.push(relative(out, p));
  }
  return files;
}
// pages are cached under their clean addresses ("./", "dashboard"), the way the host serves them
const files = (await list(out)).filter((f) => f !== 'sw.js' && f !== 'index.html').map((f) => f.replace(/\.html$/, '')).sort();
const build = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const sw = (await readFile(join(root, 'web', 'sw.js'), 'utf8'))
  .replace('__BUILD__', build)
  .replace('__FILES__', JSON.stringify(['./', ...files], null, 2));
await writeFile(join(out, 'sw.js'), sw);

const { CLOUD } = await import(join(root, 'config.js'));
console.log(`Built dist/web (${files.length + 1} files, build ${build}).`);
if (!CLOUD.url || !CLOUD.anonKey) console.log('Note: config.js has no Supabase URL / key yet, so the app runs local-only until you add them.');
