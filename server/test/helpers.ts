// Test harness: in-memory DB, controllable clock, and a MOCK PhonePe server.
// The mock exists only inside the test process — production code refuses the
// API-base override when NODE_ENV=production.

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.ts';
import { backgroundIdle } from '../background.ts';
import type { Ctx } from '../bookings.ts';
import type { Config } from '../config.ts';
import { createStore } from '../firebase.ts';
import type { BookingRow, PaymentRow } from '../bookings.ts';
import { hashPassword } from '../auth.ts';
import { createPhonePeClient } from '../phonepe.ts';

export const ADMIN_PASSWORD = 'correct horse battery';
export const WEBHOOK_USER = 'gs-webhook';
export const WEBHOOK_PASS = 'gs-webhook-secret-123';
export const CLIENT_SECRET = 'test-client-secret-should-never-leak';

/** Mock of PhonePe's PG endpoints used by the client. */
export async function startMockPhonePe(clock: { ms: number }) {
  const orders = new Map<string, { state: 'PENDING' | 'FAILED' | 'COMPLETED'; amount: number; reportedAmount?: number }>();
  const refunds = new Map<string, { state: string; amount: number }>();
  const calls: string[] = [];
  let failNextPay = false;

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url!, 'http://x');
    calls.push(`${req.method} ${url.pathname}`);
    const send = (code: number, json: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };

    if (url.pathname === '/auth/v1/oauth/token') {
      const f = new URLSearchParams(body);
      if (f.get('client_secret') !== CLIENT_SECRET || f.get('grant_type') !== 'client_credentials') return send(401, { code: 'UNAUTHORIZED' });
      return send(200, { access_token: 'tok-' + crypto.randomUUID(), token_type: 'O-Bearer', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (!String(req.headers.authorization ?? '').startsWith('O-Bearer tok-')) return send(401, { code: 'UNAUTHORIZED' });

    if (req.method === 'POST' && url.pathname === '/pg/checkout/v2/pay') {
      const j = JSON.parse(body);
      if (failNextPay) {
        failNextPay = false;
        return send(500, { code: 'INTERNAL_SERVER_ERROR', message: 'boom' });
      }
      if (orders.has(j.merchantOrderId)) return send(400, { code: 'BAD_REQUEST', message: 'exists' });
      orders.set(j.merchantOrderId, { state: 'PENDING', amount: j.amount });
      return send(200, { orderId: 'OMO' + j.merchantOrderId, state: 'PENDING', expireAt: clock.ms + 900_000, redirectUrl: `https://mercury-uat.phonepe.com/transact?token=${j.merchantOrderId}` });
    }
    const st = /^\/pg\/checkout\/v2\/order\/([^/]+)\/status$/.exec(url.pathname);
    if (req.method === 'GET' && st) {
      const o = orders.get(decodeURIComponent(st[1]));
      if (!o) return send(404, { code: 'ORDER_NOT_FOUND' });
      const amount = o.reportedAmount ?? o.amount;
      return send(200, {
        orderId: 'OMO' + st[1],
        state: o.state,
        amount,
        expireAt: Date.now() + 900_000,
        paymentDetails:
          o.state === 'PENDING'
            ? []
            : [{ paymentMode: 'UPI_QR', transactionId: 'OM' + st[1], timestamp: Date.now(), amount, state: o.state, ...(o.state === 'FAILED' ? { errorCode: 'TXN_FAILED' } : {}) }],
      });
    }
    if (req.method === 'POST' && url.pathname === '/pg/payments/v2/refund') {
      const j = JSON.parse(body);
      refunds.set(j.merchantRefundId, { state: 'PENDING', amount: j.amount });
      return send(200, { refundId: 'OMR' + j.merchantRefundId, amount: j.amount, state: 'PENDING' });
    }
    const rs = /^\/pg\/payments\/v2\/refund\/([^/]+)\/status$/.exec(url.pathname);
    if (req.method === 'GET' && rs) {
      const r = refunds.get(decodeURIComponent(rs[1]));
      if (!r) return send(404, { code: 'NOT_FOUND' });
      return send(200, { state: r.state, amount: r.amount });
    }
    send(404, { code: 'NOT_FOUND' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    orders,
    refunds,
    calls,
    failNextPay: () => (failNextPay = true),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const TG_TOKEN = '123456:TEST-bot-token';
export const TG_CHAT = '987654321';
export const SHEETS_SECRET = 'sheets-shared-secret-xyz';
export const OWNER_LINK_SECRET = 'owner-link-secret-for-tests-0123456789abcdef';

/**
 * Mock Telegram Bot API + Google Apps Script web app. The Sheets mock answers
 * POST with a 302 to an "echo" URL, like Google does, and only accepts the
 * shared secret. Behaviour can be switched per test.
 */
export async function startMockNotify() {
  const telegram: { chat_id: string; text: string; parse_mode: string; reply_markup?: unknown }[] = [];
  const rows: Record<string, unknown>[] = [];
  const emails: Record<string, any>[] = [];
  /** Mock "Bookings" tab: latest row per booking ID, plus every upsert received. */
  const bookingRows = new Map<string, Record<string, any>>();
  const upserts: Record<string, any>[] = [];
  const mode = { telegram: 'ok' as 'ok' | 'fail' | 'reject-links', sheets: 'ok' as 'ok' | 'fail' | 'html' };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url!, 'http://x');
    const json = (code: number, j: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(j));
    };
    if (req.method === 'POST' && url.pathname === `/bot${TG_TOKEN}/sendMessage`) {
      const j = JSON.parse(body);
      if (mode.telegram === 'fail') return json(502, { ok: false, description: 'Bad Gateway' });
      if (mode.telegram === 'reject-links' && String(j.text).includes('href="tel:')) {
        return json(400, { ok: false, description: "Bad Request: can't parse entities" });
      }
      if (j.chat_id !== TG_CHAT) return json(400, { ok: false, description: 'Bad Request: chat not found' });
      telegram.push(j);
      return json(200, { ok: true, result: { message_id: telegram.length } });
    }
    if (url.pathname.startsWith('/bot')) return json(401, { ok: false, description: 'Unauthorized' });
    if (req.method === 'POST' && url.pathname === '/macros/s/TEST/exec') {
      if (mode.sheets === 'html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>Sign in</html>');
      }
      const j = JSON.parse(body);
      let result: Record<string, unknown>;
      if (mode.sheets === 'fail' || j.secret !== SHEETS_SECRET) result = { ok: false, error: 'unauthorized' };
      else if (j.action === 'booking_confirmed') result = (emails.push(j), { ok: true });
      else if (j.action === 'booking_upsert') {
        upserts.push(j.booking);
        const cur = bookingRows.get(j.booking.ref);
        if (!cur || cur.version <= j.booking.version) bookingRows.set(j.booking.ref, j.booking);
        result = { ok: true };
      }
      else {
        const { action: _action, ...row } = j;
        result = (rows.push(row), { ok: true, row: rows.length + 1 });
      }
      res.writeHead(302, { Location: `/echo?r=${encodeURIComponent(JSON.stringify(result))}` });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/echo') return json(200, JSON.parse(url.searchParams.get('r')!));
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, telegram, rows, emails, bookingRows, upserts, mode, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** Fake Firebase ID tokens for tests: "test:<uid>:<email>". */
export const idToken = (uid = 'u-riya', email = 'riya@example.com') => `test:${uid}:${email}`;
export const authAs = (uid?: string, email?: string) => ({ Authorization: `Bearer ${idToken(uid, email)}` });

export async function startHarness(opts: { gateway?: boolean; rateLimits?: boolean; notify?: boolean; firebase?: boolean } = {}) {
  const clock = { ms: Date.parse('2026-10-11T06:00:00Z') }; // 11 Oct 2026, 11:30 IST
  const mirror: { uid: string; ref: string; data: Record<string, unknown> }[] = [];
  const mock = opts.gateway ? await startMockPhonePe(clock) : null;
  const notify = opts.notify ? await startMockNotify() : null;
  const config: Config = {
    nodeEnv: 'test',
    port: 0,
    siteUrl: 'https://goldenstay.test',
    trustProxy: false,
    holdMinutes: 30,
    admin: { passwordHash: hashPassword(ADMIN_PASSWORD), sessionHours: 12, emails: ['owner@goldenstay.test'] },
    qr: { upiId: 'Q089453569@ybl', payeeLabel: 'P.S', imageUrl: '/images/phonepe-merchant-qr.jpg' },
    phonepe: {
      enabled: Boolean(opts.gateway),
      env: 'sandbox',
      clientId: 'TESTCLIENT',
      clientSecret: CLIENT_SECRET,
      clientVersion: '1',
      webhookUsername: WEBHOOK_USER,
      webhookPassword: WEBHOOK_PASS,
      orderExpirySeconds: 900,
      apiBaseOverride: mock ? { auth: `${mock.base}/auth`, pg: `${mock.base}/pg` } : undefined,
    },
    ownerLinkSecret: OWNER_LINK_SECRET,
    // A fresh, empty Firestore (emulator) project for every harness, so test files never share data.
    firebase: { projectId: `demo-gs-${process.pid}-${crypto.randomBytes(4).toString('hex')}`, serviceAccount: '', serviceAccountFile: '' },
    notify: notify
      ? {
          telegramBotToken: TG_TOKEN,
          telegramChatId: TG_CHAT,
          sheetsWebhookUrl: `${notify.base}/macros/s/TEST/exec`,
          sheetsSecret: SHEETS_SECRET,
          telegramApiBase: notify.base,
        }
      : { telegramBotToken: '', telegramChatId: '', sheetsWebhookUrl: '', sheetsSecret: '' },
  };
  const ctx: Ctx = {
    db: createStore(config.firebase),
    config,
    phonepe: opts.gateway ? createPhonePeClient(config.phonepe, 'test') : null,
    now: () => new Date(clock.ms),
    // Fake Firebase: accepts "test:<uid>:<email>" tokens and records Firestore booking copies.
    firebase:
      opts.firebase === false
        ? null
        : {
            async verifyIdToken(token: string) {
              // "test:<uid>:<email>" (verified) or "test:<uid>:<email>:unverified"
              const m = /^test:([^:]+):([^:]*)(:unverified)?$/.exec(token);
              if (!m) throw new Error('invalid token');
              return { uid: m[1], email: m[2].toLowerCase(), emailVerified: !m[3] };
            },
            async mirrorBooking(uid: string, ref: string, data: Record<string, unknown>) {
              mirror.push({ uid, ref, data });
            },
          },
  };
  const app = createApp(ctx, { rateLimits: opts.rateLimits ?? false });
  const server = await new Promise<http.Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = '';

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('gs_admin=')) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  const guest = (token: string) => ({ 'X-Booking-Token': token });

  const stay = (over: Record<string, unknown> = {}) => ({
    roomId: 'ac-1bhk',
    checkIn: '2026-10-20',
    checkOut: '2026-10-22',
    guests: 2,
    name: 'Riya Sharma',
    phone: '+91 98765 43210',
    email: 'riya@example.com',
    message: 'Arriving around 6 pm',
    ...over,
  });

  /** Creates a booking as a signed-in guest (default: Riya). Pass auth = {} to book signed out. */
  async function book(over: Record<string, unknown> = {}, auth: Record<string, string> = authAs()) {
    return api('POST', '/api/bookings', stay(over), auth);
  }

  function webhook(event: string, merchantOrderId: string, auth = crypto.createHash('sha256').update(`${WEBHOOK_USER}:${WEBHOOK_PASS}`).digest('hex'), state = 'COMPLETED') {
    return api('POST', '/api/webhooks/phonepe', { event, payload: { merchantOrderId, state, amount: 1 } }, { Authorization: auth });
  }

  /** Webhooks are processed after the 200 is sent; give the async work a moment. */
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 20));
    await backgroundIdle();
  };

  /** Test-only reads straight from the database. */
  const byRef = async (ref: string) => (await ctx.db.query<BookingRow>('bookings', { where: [['ref', '==', ref]] }))[0];
  const paymentsOf = async (ref: string) => {
    const b = await byRef(ref);
    return ctx.db.query<PaymentRow>('payments', { where: [['booking_id', '==', b.id]], orderBy: [['id']] });
  };
  const auditCount = async (ref: string, action: string) => {
    const b = await byRef(ref);
    return (await ctx.db.query<{ action: string }>('audit_log', { where: [['booking_id', '==', b.id]] })).filter((a) => a.action === action).length;
  };
  const night = (unit: string, date: string) => ctx.db.get<{ booking_id: number }>('booking_nights', `${unit}_${date}`);

  async function login() {
    return api('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
  }

  return {
    ctx,
    base,
    clock,
    mock,
    mirror,
    notify,
    api,
    guest,
    stay,
    book,
    webhook,
    settle,
    login,
    byRef,
    paymentsOf,
    auditCount,
    night,
    clearCookie: () => (cookie = ''),
    close: async () => {
      await settle();
      await new Promise<void>((r) => server.close(() => r()));
      await mock?.close();
      await notify?.close();
    },
  };
}
