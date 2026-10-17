import compression from 'compression';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { PublicConfig } from '../shared/types.ts';
import { adminActor, adminIdentity, createSession, destroySession, requireAdmin, verifyPassword } from './auth.ts';
import {
  approveRequest,
  bookedNights,
  calendarData,
  conflictMessage,
  createAdminBooking,
  declineRequest,
  displayPhone,
  listRequests,
  optionsAvailability,
  pendingRequestCount,
  unitsFor,
  updateAdminBooking,
  whatsappNumber,
  type RequestOption,
} from './calendar.ts';
import { addEventClient } from './events.ts';
import { isOptionId, optionById } from '../shared/catalog.ts';
import { addDaysISO, parseISODate, todayInIndia } from '../shared/validate.ts';
import {
  amountPaid,
  audit,
  createBooking,
  getBookingById,
  getBookingByRef,
  getBookingForGuest,
  iso,
  listRooms,
  paymentsFor,
  quote,
  sweepExpiredHolds,
  toView,
  type BookingRow,
  type Ctx,
} from './bookings.ts';
import { alertQrSubmitted, handleEnquiry } from './enquiry.ts';
import type { Identity } from './firebase.ts';
import { verifyOwnerLinkToken } from './ownerLinks.ts';
import { formatIndianMobile } from '../shared/validate.ts';
import { HttpError, errorHandler, rateLimit, route } from './http.ts';
import {
  adminCancel,
  adminClearAttention,
  adminRefund,
  adminRejectQr,
  adminVerifyQr,
  getPaymentByOrderId,
  reconcileGatewayPayment,
  refreshGatewayPayments,
  refreshRefund,
  startGatewayPayment,
  submitQrPayment,
} from './payments.ts';

const guestToken = (req: Request) => {
  const t = req.get('x-booking-token');
  return typeof t === 'string' ? t : undefined;
};

const bearer = (req: Request) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
  return m ? m[1].trim() : undefined;
};

// When running against the Firebase Emulator Suite, the browser also talks to localhost ports.
const emulatorHosts =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST
    ? ' http://127.0.0.1:9099 http://localhost:9099 http://127.0.0.1:8085 http://localhost:8085'
    : '';

function securityHeaders(prod: boolean) {
  return (_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com${emulatorHosts}`,
        'frame-src https://www.google.com',
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function createApp(ctx: Ctx, opts: { staticDir?: string; rateLimits?: boolean } = {}) {
  const app = express();
  const rl: typeof rateLimit = opts.rateLimits === false ? () => (_req, _res, next) => next() : rateLimit;
  app.disable('x-powered-by');
  // gzip HTML, JS, CSS and JSON (about a third of the bytes on the wire — matters on mobile networks).
  app.use(compression());
  if (ctx.config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders(ctx.config.nodeEnv === 'production'));
  app.use(express.json({ limit: '20kb' }));

  /** The signed-in Firebase user, if an ID token was sent. Throws 401 for a bad/expired token. */
  const identityFrom = async (req: Request): Promise<Identity | null> => {
    const token = bearer(req);
    if (!token || !ctx.firebase) return null;
    try {
      return await ctx.firebase.verifyIdToken(token);
    } catch {
      throw new HttpError(401, 'Your sign-in has expired. Please sign in again.', 'BAD_ID_TOKEN');
    }
  };
  const requireUser = async (req: Request): Promise<Identity> => {
    if (!ctx.firebase) throw new HttpError(503, 'Online booking sign-in isn’t set up yet. Please enquire on WhatsApp.', 'SIGNIN_NOT_CONFIGURED');
    const id = await identityFrom(req);
    if (!id) throw new HttpError(401, 'Please sign in to book.', 'SIGNIN_REQUIRED');
    if (!id.email) throw new HttpError(400, 'Your account has no email address. Please sign in with email and password.', 'NO_EMAIL');
    return id;
  };
  /** Booking access for the guest: private link token, or signed in as the booking's owner. */
  const guestBooking = async (req: Request) => {
    const token = guestToken(req);
    const uid = bearer(req) ? (await identityFrom(req))?.uid : undefined;
    return getBookingForGuest(ctx, String(req.params.ref), token, uid);
  };

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---------- public ----------

  api.get('/config', (_req, res) => {
    const body: PublicConfig = {
      gatewayEnabled: ctx.config.phonepe.enabled,
      qr: ctx.config.qr,
      holdMinutes: ctx.config.holdMinutes,
    };
    res.json(body);
  });

  api.get('/rooms', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(listRooms(ctx));
  });

  // Public availability: which NIGHTS are taken — never who booked them.
  const dateParam = (v: unknown, field: string) => {
    const d = String(v ?? '');
    if (parseISODate(d) === null) throw new HttpError(400, 'Invalid date.', 'INVALID_INPUT', field);
    return d;
  };
  api.get('/availability', rl('availability', 240, 60_000), (req, res) => {
    const option = String(req.query.option ?? 'any');
    if (option !== 'any' && !isOptionId(option)) throw new HttpError(400, 'Unknown room.', 'INVALID_INPUT', 'option');
    const from = dateParam(req.query.from, 'from');
    const to = dateParam(req.query.to, 'to');
    if (to <= from || to > addDaysISO(from, 190)) throw new HttpError(400, 'Choose a range of up to six months.', 'INVALID_INPUT', 'to');
    res.json({ option, from, to, booked: bookedNights(ctx, option as RequestOption, from, to) });
  });
  api.get('/availability/options', rl('availability', 240, 60_000), (req, res) => {
    const checkIn = dateParam(req.query.checkIn, 'checkIn');
    const checkOut = dateParam(req.query.checkOut, 'checkOut');
    if (checkOut <= checkIn || checkOut > addDaysISO(checkIn, 90)) throw new HttpError(400, 'Invalid dates.', 'INVALID_INPUT', 'checkOut');
    res.json({ checkIn, checkOut, available: optionsAvailability(ctx, checkIn, checkOut) });
  });

  api.post('/quote', rl('quote', 120, 60_000), (req, res) => {
    res.json(quote(ctx, req.body ?? {}));
  });

  api.post(
    '/bookings',
    rl('create', 10, 10 * 60_000),
    route(async (req, res) => {
      // Guests must be signed in; the email comes from their verified Firebase account.
      const user = await requireUser(req);
      // Any client-supplied amount fields are ignored — the price comes from the database.
      const { booking, token } = createBooking(ctx, { ...(req.body ?? {}), email: user.email }, user.uid);
      res.status(201).json({ token, booking: toView(ctx, booking) });
    }),
  );

  /** The signed-in guest's own bookings, newest first. */
  api.get(
    '/me/bookings',
    rl('view', 120, 60_000),
    route(async (req, res) => {
      const user = await requireUser(req);
      sweepExpiredHolds(ctx);
      const rows = ctx.db.prepare('SELECT * FROM bookings WHERE user_uid = ? ORDER BY id DESC LIMIT 50').all(user.uid) as BookingRow[];
      res.json(rows.map((b) => toView(ctx, b)));
    }),
  );

  api.get(
    '/bookings/:ref',
    rl('view', 120, 60_000),
    route(async (req, res) => {
      const b = await guestBooking(req);
      // When the guest returns from PhonePe, ask PhonePe directly rather than waiting for the webhook.
      if (req.query.refresh === '1') await refreshGatewayPayments(ctx, b.id, 'guest-return');
      sweepExpiredHolds(ctx);
      res.json(toView(ctx, getBookingByRef(ctx, b.ref)!));
    }),
  );

  api.post(
    '/bookings/:ref/pay/gateway',
    rl('pay', 20, 10 * 60_000),
    route(async (req, res) => {
      const b = await guestBooking(req);
      res.json(await startGatewayPayment(ctx, b, guestToken(req)));
    }),
  );

  api.post(
    '/bookings/:ref/pay/qr',
    rl('qr', 10, 10 * 60_000),
    route(async (req, res) => {
      const b = await guestBooking(req);
      const updated = submitQrPayment(ctx, b, req.body?.utr);
      alertQrSubmitted(ctx, updated, paymentsFor(ctx, updated.id).filter((p) => p.method === 'qr').at(-1)?.utr ?? null);
      res.json(toView(ctx, updated));
    }),
  );

  // ---------- owner's "Review & confirm booking" email link ----------

  const ownerLink = (req: Request) => {
    const check = verifyOwnerLinkToken(ctx.config.ownerLinkSecret, String(req.params.token), ctx.now().getTime());
    if (!check.ok) {
      throw check.reason === 'expired'
        ? new HttpError(410, 'This link has expired. Please confirm the booking from the admin page.', 'LINK_EXPIRED')
        : new HttpError(404, 'This link isn’t valid.', 'LINK_INVALID');
    }
    const p = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(check.paymentId) as
      | { id: number; booking_id: number; method: string; state: string; amount_paise: number; utr: string | null; created_at: string }
      | undefined;
    const b = p ? getBookingById(ctx, p.booking_id) : undefined;
    if (!p || !b || p.method !== 'qr') throw new HttpError(404, 'This link isn’t valid.', 'LINK_INVALID');
    return { p, b };
  };

  api.get('/owner-action/:token', rl('owner-link', 30, 10 * 60_000), (req, res) => {
    const { p, b } = ownerLink(req);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json({
      ref: b.ref,
      bookingStatus: b.status,
      paymentState: p.state,
      amountPaise: p.amount_paise,
      utr: p.utr,
      paidAt: p.created_at,
      guestName: b.guest_name,
      guestPhone: formatIndianMobile(b.guest_phone),
      guestEmail: b.guest_email,
      roomName: b.room_name,
      checkIn: b.check_in,
      checkOut: b.check_out,
      nights: b.nights,
      guests: b.guests,
      needsAttention: b.needs_attention,
    });
  });

  api.post('/owner-action/:token', rl('owner-link', 30, 10 * 60_000), (req, res) => {
    const { p, b } = ownerLink(req);
    if (p.state !== 'submitted') throw new HttpError(409, p.state === 'verified' ? 'Already confirmed.' : 'This payment was already handled.', 'ALREADY_HANDLED');
    const decision = req.body?.decision;
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (decision === 'confirm') adminVerifyQr(ctx, b, p.id, `Confirmed from the owner email link${reason ? ` — ${reason}` : ''}`, 'owner-email-link');
    else if (decision === 'reject') adminRejectQr(ctx, b, p.id, `Rejected from the owner email link${reason ? ` — ${reason}` : ''}`, 'owner-email-link');
    else throw new HttpError(400, 'Choose confirm or reject.', 'BAD_DECISION');
    res.json({ ok: true, bookingStatus: getBookingById(ctx, b.id)!.status });
  });

  // ---------- website enquiry form → Telegram + Google Sheets ----------

  api.post(
    '/enquiry',
    rl('enquiry', 5, 10 * 60_000),
    route((req, res) => handleEnquiry(ctx, req, res)),
  );
  api.all('/enquiry', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' });
  });

  api.post('/bookings/:ref/cancel', rl('cancel', 10, 10 * 60_000), route(async (req, res) => {
    const b = await guestBooking(req);
    if (b.status !== 'pending_payment' || amountPaid(ctx, b.id) > 0 || paymentsFor(ctx, b.id).some((p) => p.state === 'pending')) {
      throw new HttpError(409, 'This booking can’t be cancelled online. Please contact us.', 'NOT_CANCELLABLE');
    }
    adminCancel(ctx, b, 'Cancelled by guest before payment', 'guest');
    res.json(toView(ctx, getBookingByRef(ctx, b.ref)!));
  }));

  // ---------- PhonePe webhook (no rate limit, per PhonePe guidance) ----------

  api.post('/webhooks/phonepe', (req, res) => {
    const body = (req.body ?? {}) as { event?: string; payload?: Record<string, unknown> };
    const authOk = ctx.phonepe?.verifyWebhookAuth(req.get('authorization')) ?? false;
    const merchantOrderId = typeof body.payload?.merchantOrderId === 'string' ? body.payload.merchantOrderId : null;
    const ev = ctx.db
      .prepare('INSERT INTO webhook_events (received_at, event, merchant_order_id, auth_ok, body_json) VALUES (?, ?, ?, ?, ?)')
      .run(iso(ctx), String(body.event ?? ''), merchantOrderId, authOk ? 1 : 0, JSON.stringify(body).slice(0, 16_000));
    if (!authOk) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Acknowledge fast (PhonePe expects 2xx within a few seconds), then process.
    res.status(200).json({ ok: true });
    void processWebhook(ctx, Number(ev.lastInsertRowid), body).catch((e) => console.error('[webhook]', e));
  });

  // ---------- admin ----------

  const admin = express.Router();
  admin.post('/login', rl('login', 5, 15 * 60_000), (req, res) => {
    const pw = String(req.body?.password ?? '');
    const ok = ctx.config.admin.passwordHash !== '' && verifyPassword(pw, ctx.config.admin.passwordHash);
    audit(ctx, 'admin', ok ? 'admin.login' : 'admin.login_failed', null, { ip: req.ip });
    if (!ok) throw new HttpError(401, 'Incorrect password.', 'BAD_PASSWORD');
    createSession(ctx, req, res);
    res.json({ ok: true });
  });
  // Access probe for the admin page: always 200, so a signed-out visit doesn't log an error.
  admin.get(
    '/me',
    route(async (req, res) => {
      let who;
      try {
        who = await adminIdentity(ctx, req);
      } catch (e) {
        if (e instanceof HttpError) return void res.json({ authenticated: e.status === 403, isAdmin: false, code: e.code });
        throw e;
      }
      if (!who) return void res.json({ authenticated: false, isAdmin: false });
      res.json({
        authenticated: true,
        isAdmin: true,
        email: who.via === 'firebase' ? who.email : null,
        gatewayEnabled: ctx.config.phonepe.enabled,
        phonepeEnv: ctx.config.phonepe.env,
      });
    }),
  );
  admin.post('/logout', (req, res) => {
    destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  const guarded = express.Router();
  guarded.use(requireAdmin(ctx));
  const actor = adminActor;
  const byRef = (ref: unknown): BookingRow => {
    const b = getBookingByRef(ctx, String(ref));
    if (!b) throw new HttpError(404, 'Booking not found.', 'NOT_FOUND');
    return b;
  };

  guarded.get('/bookings', (req, res) => {
    sweepExpiredHolds(ctx);
    const filter = String(req.query.filter ?? 'all');
    const view = String(req.query.view ?? '');
    const unit = String(req.query.unit ?? '');
    const q = String(req.query.q ?? '').trim();
    const where: string[] = [];
    const args: string[] = [];
    if (filter === 'action') where.push(`(status = 'pending_verification' OR needs_attention IS NOT NULL)`);
    else if (filter !== 'all') {
      where.push('status = ?');
      args.push(filter);
    }
    // Upcoming / Today (arriving, staying or leaving today) / Past
    const today = todayInIndia(ctx.now());
    let order = 'id DESC';
    if (view === 'upcoming') {
      where.push('check_in > ?');
      args.push(today);
      order = 'check_in ASC, id';
    } else if (view === 'today') {
      where.push('check_in <= ? AND check_out >= ?');
      args.push(today, today);
      order = 'check_in ASC, id';
    } else if (view === 'past') {
      where.push('check_out < ?');
      args.push(today);
      order = 'check_in DESC, id DESC';
    }
    // A room's filter includes the options that hold it: the 2BHK and the entire homestay.
    if (unit === 'ac') where.push(`room_id IN ('ac-1bhk', '2bhk', 'entire')`);
    else if (unit === 'nonac') where.push(`room_id IN ('nonac-1bhk', '2bhk', 'entire')`);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const byPhone = digits.length >= 3;
      where.push(`(ref LIKE ? OR guest_name LIKE ? OR guest_email LIKE ?${byPhone ? ' OR guest_phone LIKE ?' : ''})`);
      const like = `%${q}%`;
      args.push(like, like, like, ...(byPhone ? [`%${digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits}%`] : []));
    }
    const rows = ctx.db
      .prepare(`SELECT * FROM bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`)
      .all(...args) as BookingRow[];
    res.json(
      rows.map((b) => ({
        ref: b.ref,
        status: b.status,
        paymentStatus: b.payment_status,
        needsAttention: b.needs_attention,
        roomName: b.room_name,
        checkIn: b.check_in,
        checkOut: b.check_out,
        nights: b.nights,
        guests: b.guests,
        guestName: b.guest_name,
        guestPhone: b.guest_phone ? displayPhone(b.guest_phone) : '',
        whatsapp: b.guest_phone ? whatsappNumber(b.guest_phone) : '',
        optionId: b.room_id,
        kind: b.kind,
        source: b.source,
        occasion: b.occasion,
        notes: b.notes,
        totalPaise: b.total_paise,
        amountPaidPaise: amountPaid(ctx, b.id),
        method: paymentsFor(ctx, b.id).at(-1)?.method ?? null,
        createdAt: b.created_at,
      })),
    );
  });

  guarded.get('/bookings/:ref', (req, res) => {
    const b = byRef(req.params.ref);
    const payments = paymentsFor(ctx, b.id).map((p) => ({
      id: p.id,
      method: p.method,
      state: p.state,
      amountPaise: p.amount_paise,
      merchantOrderId: p.merchant_order_id,
      gatewayOrderId: p.gateway_order_id,
      gatewayTransactionId: p.gateway_transaction_id,
      paymentMode: p.gateway_payment_mode,
      errorCode: p.gateway_error_code,
      utr: p.utr,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
    const refunds = ctx.db
      .prepare(
        `SELECT r.id, r.payment_id AS paymentId, r.method, r.merchant_refund_id AS merchantRefundId, r.amount_paise AS amountPaise,
                r.state, r.note, r.created_at AS createdAt FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.booking_id = ? ORDER BY r.id`,
      )
      .all(b.id);
    const history = ctx.db.prepare('SELECT at, actor, action, details FROM audit_log WHERE booking_id = ? ORDER BY id').all(b.id);
    res.json({
      ...toView(ctx, b),
      needsAttention: b.needs_attention,
      guestPhone: b.guest_phone ? displayPhone(b.guest_phone) : '',
      whatsapp: b.guest_phone ? whatsappNumber(b.guest_phone) : '',
      kind: b.kind,
      source: b.source,
      occasion: b.occasion,
      notes: b.notes,
      guestEmail: b.guest_email,
      userUid: b.user_uid,
      guestMessage: b.guest_message,
      payments,
      refunds,
      history,
    });
  });

  guarded.post('/bookings/:ref/verify-qr', (req, res) => {
    adminVerifyQr(ctx, byRef(req.params.ref), req.body?.paymentId, req.body?.note, actor(req));
    res.json({ ok: true });
  });
  guarded.post('/bookings/:ref/reject-qr', (req, res) => {
    adminRejectQr(ctx, byRef(req.params.ref), req.body?.paymentId, req.body?.note, actor(req));
    res.json({ ok: true });
  });
  guarded.post('/bookings/:ref/cancel', (req, res) => {
    adminCancel(ctx, byRef(req.params.ref), req.body?.note, actor(req));
    res.json({ ok: true });
  });
  guarded.post('/bookings/:ref/clear-attention', (req, res) => {
    adminClearAttention(ctx, byRef(req.params.ref), req.body?.note, actor(req));
    res.json({ ok: true });
  });
  guarded.post(
    '/bookings/:ref/refresh',
    route(async (req, res) => {
      const b = byRef(req.params.ref);
      await refreshGatewayPayments(ctx, b.id, actor(req));
      const pending = ctx.db
        .prepare(`SELECT r.merchant_refund_id AS id FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.booking_id = ? AND r.state = 'pending'`)
        .all(b.id) as { id: string }[];
      for (const r of pending) await refreshRefund(ctx, r.id, actor(req));
      res.json({ ok: true });
    }),
  );
  guarded.post(
    '/bookings/:ref/refund',
    route(async (req, res) => {
      await adminRefund(ctx, byRef(req.params.ref), req.body?.paymentId, req.body?.amount, req.body?.note, actor(req));
      res.json({ ok: true });
    }),
  );

  // ---------- calendar, owner bookings & blocks, website requests ----------

  guarded.get('/calendar', (req, res) => {
    sweepExpiredHolds(ctx);
    const from = dateParam(req.query.from, 'from');
    const to = dateParam(req.query.to, 'to');
    if (to <= from || to > addDaysISO(from, 120)) throw new HttpError(400, 'Invalid range.', 'INVALID_INPUT', 'to');
    res.json({ today: todayInIndia(ctx.now()), ...calendarData(ctx, from, to), pendingRequests: pendingRequestCount(ctx) });
  });

  /** Live check for the booking form: "AC 1BHK is already booked on 22–23 Nov." */
  guarded.get('/check', (req, res) => {
    const option = String(req.query.optionId ?? '');
    if (!isOptionId(option)) throw new HttpError(400, 'Unknown option.', 'INVALID_INPUT', 'optionId');
    const checkIn = dateParam(req.query.checkIn, 'checkIn');
    const checkOut = dateParam(req.query.checkOut, 'checkOut');
    if (checkOut <= checkIn) return void res.json({ ok: false, message: 'Check-out must be after check-in.' });
    const exclude = req.query.exclude ? getBookingByRef(ctx, String(req.query.exclude))?.id : undefined;
    const message = conflictMessage(ctx, unitsFor(option), checkIn, checkOut, exclude);
    res.json({ ok: !message, message, optionName: optionById(option).name });
  });

  guarded.post('/manual-bookings', (req, res) => {
    const b = createAdminBooking(ctx, req.body ?? {}, actor(req));
    res.status(201).json({ ref: b.ref });
  });
  guarded.put('/manual-bookings/:ref', (req, res) => {
    const b = updateAdminBooking(ctx, String(req.params.ref), req.body ?? {}, actor(req));
    res.json({ ref: b.ref });
  });

  guarded.get('/requests', (_req, res) => res.json(listRequests(ctx)));
  guarded.post('/requests/:id/approve', (req, res) => {
    const b = approveRequest(ctx, Number(req.params.id), req.body?.optionId, actor(req));
    res.json({ ref: b.ref });
  });
  guarded.post('/requests/:id/decline', (req, res) => {
    declineRequest(ctx, Number(req.params.id), actor(req));
    res.json({ ok: true });
  });

  /** Live updates (Server-Sent Events, read with fetch so the Firebase token can be sent). */
  guarded.get('/events', (req, res) => {
    const done = addEventClient(res);
    req.on('close', done);
  });

  guarded.get('/rooms', (_req, res) => res.json(listRooms(ctx)));
  guarded.put('/rooms/:id', (req, res) => {
    const room = ctx.db.prepare('SELECT * FROM rooms WHERE id = ?').get(String(req.params.id)) as
      | { id: string; price_paise: number; bookable: number }
      | undefined;
    if (!room) throw new HttpError(404, 'Room not found.', 'NOT_FOUND');
    const pricePaise = Math.round(Number(req.body?.price) * 100);
    const bookable = req.body?.bookable === false ? 0 : 1;
    const note = String(req.body?.note ?? '').trim();
    if (!Number.isInteger(pricePaise) || pricePaise < 100 || pricePaise > 10_000_000) throw new HttpError(400, 'Enter a nightly price between ₹1 and ₹1,00,000.', 'INVALID_PRICE', 'price');
    if (note.length < 3) throw new HttpError(400, 'Please add a short note for the audit log.', 'NOTE_REQUIRED', 'note');
    ctx.db.prepare('UPDATE rooms SET price_paise = ?, bookable = ?, updated_at = ? WHERE id = ?').run(pricePaise, bookable, iso(ctx), room.id);
    audit(ctx, actor(req), 'room.updated', null, { room: room.id, from: room.price_paise, to: pricePaise, bookable: bookable === 1, note });
    res.json(listRooms(ctx));
  });

  guarded.get('/audit', (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    res.json(
      ctx.db
        .prepare('SELECT a.at, a.actor, a.action, a.details, b.ref FROM audit_log a LEFT JOIN bookings b ON b.id = a.booking_id ORDER BY a.id DESC LIMIT ?')
        .all(limit),
    );
  });

  admin.use(guarded);
  api.use('/admin', admin);
  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  // ---------- static site (production) ----------
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(['/admin', '/booking', '/account', '/confirm'], (_req, res, next) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });
    app.use(
      express.static(opts.staticDir, {
        setHeaders(res, file) {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else res.setHeader('Cache-Control', 'public, max-age=86400');
        },
      }),
    );
  }

  app.use(errorHandler);
  return app;
}

/**
 * Webhook processing: authenticated payloads are treated only as a trigger —
 * the authoritative state is fetched from PhonePe's status APIs before
 * anything changes, so a forged or replayed body can't confirm a booking.
 */
async function processWebhook(ctx: Ctx, eventId: number, body: { event?: string; payload?: Record<string, unknown> }) {
  const setResult = (r: string) => ctx.db.prepare('UPDATE webhook_events SET result = ? WHERE id = ?').run(r, eventId);
  const event = String(body.event ?? '');
  if (!ctx.phonepe) return setResult('gateway_disabled');

  if (event.startsWith('checkout.order.')) {
    const id = body.payload?.merchantOrderId;
    const p = typeof id === 'string' ? getPaymentByOrderId(ctx, id) : undefined;
    if (!p) return setResult('unknown_order');
    const status = await ctx.phonepe.orderStatus(p.merchant_order_id!);
    reconcileGatewayPayment(ctx, p.id, status, 'phonepe-webhook');
    return setResult(`reconciled:${status.state}`);
  }
  if (event.startsWith('pg.refund.')) {
    const id = body.payload?.merchantRefundId;
    if (typeof id !== 'string') return setResult('no_refund_id');
    await refreshRefund(ctx, id, 'phonepe-webhook');
    return setResult('refund_refreshed');
  }
  setResult('ignored');
}
