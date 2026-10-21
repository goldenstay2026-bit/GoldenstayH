// Builds the Vercel deployment (Vercel "Build Output API" v3) in .vercel/output:
//
//   static/                     the website (from dist/, built by `npm run build`)
//   functions/api/index.func/   the booking server: server/vercel.ts bundled with esbuild,
//                               plus exactly the node_modules files it needs (traced by @vercel/nft)
//   config.json                 routing (/api/* → the function) and security headers
//
// Run via `npm run vercel-build` (Vercel's build command, see vercel.json).

import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.vercel', 'output');
const func = path.join(out, 'functions', 'api', 'index.func');

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(func, { recursive: true });

// 1. Website → static/
fs.cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true });

// 2. Server → one ESM file; npm packages stay external and are copied below.
const entry = path.join(func, 'index.mjs');
await build({
  entryPoints: [path.join(root, 'server', 'vercel.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: 'inline',
  logLevel: 'warning',
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

// 3. Copy every node_modules file the bundle can load.
const { fileList, warnings } = await nodeFileTrace([entry], { base: root });
let copied = 0;
for (const rel of fileList) {
  if (!rel.startsWith('node_modules')) continue;
  const from = path.join(root, rel);
  const to = path.join(func, rel);
  const stat = fs.lstatSync(from);
  if (stat.isDirectory()) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}
for (const w of warnings) if (!/Failed to resolve dependency|Failed to parse/.test(String(w))) console.warn('[nft]', String(w).slice(0, 200));
fs.writeFileSync(path.join(func, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
  path.join(func, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 30 }, null, 2),
);

// 4. Routing + headers (the same headers the Express server sends when self-hosted).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com",
  'frame-src https://www.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const pages = ['admin', 'booking', 'account', 'confirm', 'book'];
const config = {
  version: 3,
  routes: [
    {
      src: '/(.*)',
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': csp,
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      },
      continue: true,
    },
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    // Private pages: never indexed, never leak their URL (booking links carry a token).
    { src: '^/(admin|booking|account|confirm)(/.*)?$', headers: { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }, continue: true },
    // The booking server.
    { src: '^/api/(.*)$', dest: '/api/index?__path=$1' },
    // Pages: /admin → /admin/, and /admin/ → admin/index.html.
    ...pages.map((p) => ({ src: `^/${p}$`, status: 308, headers: { Location: `/${p}/` } })),
    ...pages.map((p) => ({ src: `^/${p}/$`, dest: `/${p}/index.html`, headers: { 'Cache-Control': 'no-cache' } })),
    { src: '^/$', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
    { handle: 'filesystem' },
  ],
};
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true }).reduce((s, d) => (d.isFile() ? s + fs.statSync(path.join(d.parentPath, d.name)).size : s), 0);
console.log(`Vercel output ready: static ${(size(path.join(out, 'static')) / 1e6).toFixed(1)} MB, function ${(size(func) / 1e6).toFixed(1)} MB (${copied} dependency files).`);
