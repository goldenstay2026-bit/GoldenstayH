// Serves the built Vercel output (.vercel/output) locally, the way Vercel does:
// the routes and headers from config.json, static files from static/, and
// /api/* through the bundled function. For checking a Vercel build before
// deploying:  npm run vercel-build && node scripts/vercel-local.mjs
// (Needs the same environment variables as on Vercel, or the Firestore emulator.)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const out = path.resolve(import.meta.dirname, '..', '.vercel', 'output');
const config = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
const vc = JSON.parse(fs.readFileSync(path.join(out, 'functions', 'api', 'index.func', '.vc-config.json'), 'utf8'));
const { default: handler } = await import(pathToFileURL(path.join(out, 'functions', 'api', 'index.func', vc.handler)).href);
const port = Number(process.env.PORT ?? 3000);
process.env.VERCEL ??= '1';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.ico': 'image/x-icon', '.xml': 'application/xml' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let dest = null;
    for (const r of config.routes) {
      if (r.handle === 'filesystem') break;
      const m = new RegExp(r.src).exec(url.pathname);
      if (!m) continue;
      for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v.replace(/\$(\d)/g, (_, i) => m[i] ?? ''));
      if (r.status) {
        res.statusCode = r.status;
        return res.end();
      }
      if (r.dest) {
        dest = r.dest.replace(/\$(\d)/g, (_, i) => m[i] ?? '');
        if (!r.continue) break;
      }
    }
    if (dest?.startsWith('/api/index')) {
      const d = new URL(dest, 'http://localhost');
      for (const [k, v] of url.searchParams) d.searchParams.append(k, v);
      req.url = d.pathname + d.search;
      return handler(req, res);
    }
    const file = path.join(out, 'static', decodeURIComponent(dest ?? url.pathname));
    if (!file.startsWith(path.join(out, 'static')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    // Vercel's CDN compresses text responses; do the same so speed tests are comparable.
    if (/text|javascript|json|svg|xml/.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding']))) {
      res.setHeader('Content-Encoding', 'gzip');
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
      return;
    }
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Vercel build served on http://localhost:${port}`));
