// Bakes the rendered page into dist/index.html so content paints before JS
// runs (faster LCP on phones) and is visible to crawlers without JS.
// Runs after `vite build` and `vite build --ssr`.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const ssrDir = path.join(root, 'dist-ssr');
const entry = fs.readdirSync(ssrDir).find((f) => /^entry-server\.m?js$/.test(f));
const { render } = await import(pathToFileURL(path.join(ssrDir, entry)).href);

const file = path.join(root, 'dist', 'index.html');
const html = fs.readFileSync(file, 'utf-8');
const marker = '<div id="root"></div>';
if (!html.includes(marker)) throw new Error('prerender: #root marker not found in dist/index.html');
let out = html.replace(marker, `<div id="root">${render()}</div>`);

// Inline the (small) stylesheet to save a render-blocking round trip.
out = out.replace(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/, (tag, href) => {
  const css = fs.readFileSync(path.join(root, 'dist', href.replace(/^\//, '')), 'utf-8');
  return `<style>${css}</style>`;
});
fs.writeFileSync(file, out);
fs.rmSync(ssrDir, { recursive: true, force: true });
console.log('prerendered dist/index.html');
