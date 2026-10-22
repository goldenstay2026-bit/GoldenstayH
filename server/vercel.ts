// Vercel serverless function: every /api/* request lands here (see
// scripts/build-vercel.mjs, which bundles this file into the function).
// The site's pages are served by Vercel's CDN from the static build.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';
import { createContext } from './context.ts';

// A stray background error must never take the whole function down.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

// Created once per function instance and reused across requests.
let app: ReturnType<typeof createApp> | null = null;
let startupError: string | null = null;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/** GET /api/health — what is configured (yes/no only, never values) and whether Firestore answers. */
async function health(res: ServerResponse) {
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const settings = Object.fromEntries(
    [
      'NODE_ENV', 'SITE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT', 'OWNER_LINK_SECRET', 'ADMIN_EMAILS',
      'ADMIN_PASSWORD_HASH', 'SHEETS_WEBHOOK_URL', 'SHEETS_SECRET', 'TELEGRAM_BOT_TOKEN', 'VITE_FIREBASE_API_KEY',
    ].map((k) => [k, has(k)]),
  );
  let key = 'missing';
  if (has('FIREBASE_SERVICE_ACCOUNT')) {
    try {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT!.trim();
      if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
      const j = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      key = j.private_key && j.client_email ? `ok (project ${j.project_id})` : 'JSON is missing private_key or client_email';
    } catch {
      key = 'not valid JSON — paste the whole key file';
    }
  }
  let firestore = 'not checked';
  if (app) {
    try {
      const ctx = createContext();
      await ctx.db.get('meta', 'changes-bookings');
      firestore = 'ok';
    } catch (e) {
      firestore = `error: ${String((e as Error).message).slice(0, 200)}`;
    }
  }
  json(res, startupError ? 500 : 200, { ok: !startupError && firestore === 'ok', node: process.version, settings, serviceAccountKey: key, startup: startupError ?? 'ok', firestore });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // The route rewrites /api/<path> → /api/index?__path=<path>; restore the original path for Express.
  const url = new URL(req.url ?? '/', 'http://x');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  if (!app) {
    try {
      app = createApp(createContext());
      startupError = null;
    } catch (e) {
      startupError = String((e as Error).message).slice(0, 300);
      console.error('[startup]', e);
    }
  }
  if (new URL(req.url ?? '/', 'http://x').pathname === '/api/health') return health(res);
  if (!app) return json(res, 500, { error: 'The booking server is not configured correctly.', code: 'SERVER_CONFIG', detail: startupError });
  return app(req as never, res as never);
}
