// Long-running server (npm start / npm run dev). On Vercel, server/vercel.ts is used instead.
import path from 'node:path';
import { createApp } from './app.ts';
import { backgroundIdle } from './background.ts';
import { sweepExpiredHolds } from './bookings.ts';
import { createContext } from './context.ts';
import { refreshGatewayPayments } from './payments.ts';
import type { PaymentRow } from './bookings.ts';

const ctx = createContext();
const { config } = ctx;

const staticDir = path.resolve(import.meta.dirname, '..', 'dist');
// Serves the built site from dist/ when present (npm run build). In development, Vite serves the site instead.
const app = createApp(ctx, { staticDir });

// Background safety net: expire stale holds, and poll PhonePe for open orders
// in case a webhook was missed (PhonePe recommends the status API as fallback).
const sweep = async () => {
  try {
    await sweepExpiredHolds(ctx, true);
    if (!ctx.phonepe) return;
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const open = (await ctx.db.query<PaymentRow>('payments', { where: [['method', '==', 'gateway']] })).filter(
      (p) => (p.state === 'pending' || p.state === 'created') && p.created_at < cutoff,
    );
    for (const id of new Set(open.map((p) => p.booking_id))) await refreshGatewayPayments(ctx, id, 'system-sweep');
  } catch (e) {
    console.error('[sweep]', e);
  }
};
const timer = setInterval(sweep, 60_000);

const server = app.listen(config.port, () => {
  const db = process.env.FIRESTORE_EMULATOR_HOST ? `Firestore emulator (${process.env.FIRESTORE_EMULATOR_HOST})` : `Firestore (${config.firebase.projectId})`;
  console.log(`Golden Stay server on http://localhost:${config.port}  (env=${config.nodeEnv}, db=${db})`);
  console.log(`  PhonePe gateway: ${config.phonepe.enabled ? `ON (${config.phonepe.env})` : 'OFF — QR payments only'}`);
  console.log(`  Admin: Firebase sign-in for ${config.admin.emails.join(', ') || '(no ADMIN_EMAILS)'}${config.admin.passwordHash ? ' + backup password' : ''}`);
});

const shutdown = () => {
  clearInterval(timer);
  server.close(async () => {
    await backgroundIdle(5000);
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
