'use strict';
// Builds dist/lunaria-phone.html: the whole app (UI + engines + a local
// backend) in one self-contained file that runs in a phone browser with no
// server. `npm run build:phone`
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const swapApi = {
  name: 'swap-api',
  setup(build) {
    // Every `./api.js` / `../api.js` import in the UI gets the in-browser backend.
    build.onResolve({ filter: /(^|\/)api\.js$/ }, (args) => (args.importer.includes(`${path.sep}public${path.sep}`)
      ? { path: path.join(root, 'standalone', 'local-api.js') }
      : undefined));
  },
};

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'public', 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020', 'safari15'],
    minify: true,
    write: false,
    plugins: [swapApi],
    logLevel: 'warning',
  });
  const icon = `data:image/svg+xml;base64,${Buffer.from(read('public/icons/icon.svg')).toString('base64')}`;
  const js = result.outputFiles[0].text.replaceAll('/icons/icon.svg', icon).replace(/<\/script/gi, '<\\/script');
  const css = read('public/css/styles.css');
  const nav = read('public/index.html').match(/<nav[\s\S]*?<\/nav>/)[0];

  const html = `<meta charset="utf-8">
<title>Lunaria</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#b03a6f">
<link rel="icon" href="${icon}">
<style>
${css}
</style>
<div id="app"><p class="empty">Loading Lunaria…</p></div>
${nav}
<script>window.LUNARIA_STANDALONE = true;</script>
<script>
${js}
</script>
`;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', 'lunaria-phone.html');
  fs.writeFileSync(out, html);
  console.log(`Built ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
