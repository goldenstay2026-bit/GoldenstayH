import path from 'node:path';
import { createApp } from './app.ts';
import { sweepExpiredHolds, type Ctx } from './bookings.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { refreshGatewayPayments } from './payments.ts';
import { createFirebase } from './firebase.ts';
import { createPhonePeClient } from './phonepe.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
const ctx: Ctx = {
  db,
  config,
  phonepe: config.phonepe.enabled ? createPhonePeClient(config.phonepe, config.nodeEnv) : null,
  now: () => new Date(),
  firebase: createFirebase(config.firebase),
};

const staticDir = path.resolve(import.meta.dirname, '..', 'dist');
// Serves the built site from dist/ when present (npm run build). In development, Vite serves the site instead.
const app = createApp(ctx, { staticDir });

// Background safety net: expire stale holds, and poll PhonePe for open orders
// in case a webhook was missed (PhonePe recommends the status API as fallback).
const sweep = async () => {
  try {
    sweepExpiredHolds(ctx);
    if (!ctx.phonepe) return;
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const open = db
      .prepare(`SELECT DISTINCT booking_id AS id FROM payments WHERE method = 'gateway' AND state IN ('pending', 'created') AND created_at < ?`)
      .all(cutoff) as { id: number }[];
    for (const { id } of open) await refreshGatewayPayments(ctx, id, 'system-sweep');
  } catch (e) {
    console.error('[sweep]', e);
  }
};
const timer = setInterval(sweep, 60_000);

const server = app.listen(config.port, () => {
  console.log(`Golden Stay server on http://localhost:${config.port}  (env=${config.nodeEnv}, db=${config.dbPath})`);
  console.log(`  PhonePe gateway: ${config.phonepe.enabled ? `ON (${config.phonepe.env})` : 'OFF — QR payments only'}`);
  console.log(`  Guest sign-in (Firebase): ${ctx.firebase ? `ON (${config.firebase.projectId})` : 'OFF — set FIREBASE_PROJECT_ID; online booking disabled'}`);
  if (!config.admin.passwordHash) console.log('  Admin: no ADMIN_PASSWORD_HASH set — admin login disabled (run: npm run admin:hash)');
});

const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
