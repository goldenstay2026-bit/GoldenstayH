// Vercel serverless function: every /api/* request lands here (see
// scripts/build-vercel.mjs, which bundles this file into the function).
// The site's pages are served by Vercel's CDN from the static build.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';
import { createContext } from './context.ts';

// Created once per function instance and reused across requests.
let app: ReturnType<typeof createApp> | null = null;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // The route rewrites /api/<path> → /api/index?__path=<path>; restore the original path for Express.
  const url = new URL(req.url ?? '/', 'http://x');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  try {
    app ??= createApp(createContext());
  } catch (e) {
    console.error('[startup]', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The booking server is not configured correctly.', code: 'SERVER_CONFIG' }));
    return;
  }
  return app(req as never, res as never);
}
