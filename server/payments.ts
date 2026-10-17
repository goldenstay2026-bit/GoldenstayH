import crypto from 'node:crypto';
import { normaliseUtr } from '../shared/validate.ts';
import {
  queueBookingSync,
  amountPaid,
  audit,
  getBookingById,
  iso,
  paymentsFor,
  releaseNights,
  setBooking,
  sweepExpiredHolds,
  tryReacquireNights,
  type BookingRow,
  type Ctx,
  type PaymentRow,
} from './bookings.ts';
import { inBackground } from './background.ts';
import { onCommit, tx } from './db.ts';
import { notifyBookingConfirmed } from './notify/confirmation.ts';
import { notifyOwnerToVerify } from './notify/ownerVerify.ts';
import { HttpError } from './http.ts';
import { PhonePeError, type OrderStatus } from './phonepe.ts';

const getPayment = (ctx: Ctx, id: number) => ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow | undefined;
export const getPaymentByOrderId = (ctx: Ctx, merchantOrderId: string) =>
  ctx.db.prepare('SELECT * FROM payments WHERE merchant_order_id = ?').get(merchantOrderId) as PaymentRow | undefined;

function setPayment(ctx: Ctx, id: number, fields: Partial<Omit<PaymentRow, 'id' | 'booking_id' | 'method' | 'created_at'>>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  ctx.db
    .prepare(`UPDATE payments SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (fields[k] ?? null) as string | number | null), iso(ctx), id);
  const p = getPayment(ctx, id);
  if (p) queueBookingSync(ctx, p.booking_id);
}

/**
 * Marks a booking confirmed after a VERIFIED payment. Idempotent. If the
 * nights were released (payment arrived after the hold expired) it tries to
 * re-acquire them; if someone else has booked them meanwhile, the booking is
 * flagged for the owner to refund instead of double-booking.
 */
function confirmBooking(ctx: Ctx, bookingId: number, actor: string, details: Record<string, unknown>): boolean {
  return tx(ctx.db, () => {
    const b = getBookingById(ctx, bookingId)!;
    if (b.status === 'confirmed') return true;
    if (!tryReacquireNights(ctx, b)) {
      setBooking(ctx, b.id, {
        payment_status: 'successful',
        needs_attention: 'Payment received after the hold expired and the room is no longer free for these dates — refund or offer other dates.',
      });
      audit(ctx, actor, 'booking.paid_but_unavailable', b.id, details);
      return false;
    }
    setBooking(ctx, b.id, {
      status: 'confirmed',
      payment_status: 'successful',
      hold_expires_at: null,
      confirmed_at: iso(ctx),
    });
    audit(ctx, actor, 'booking.confirmed', b.id, details);
    // Email the owner once the confirmation is committed (never for a rolled-back change).
    onCommit(ctx.db, () => inBackground('confirmation email', () => notifyBookingConfirmed(ctx, b.id)));
    return true;
  });
}

// ---------- Method A: PhonePe Payment Gateway ----------

/**
 * Applies an authoritative PhonePe order status to our payment + booking.
 * Every path (webhook, return page, admin refresh, background sweep) funnels
 * through here, so duplicate notifications are harmless.
 */
export function reconcileGatewayPayment(ctx: Ctx, paymentId: number, status: OrderStatus, source: string) {
  return tx(ctx.db, () => {
    const p = getPayment(ctx, paymentId);
    if (!p || p.method !== 'gateway') return;
    const success = status.paymentDetails.find((d) => d.state === 'COMPLETED');
    const lastAttempt = status.paymentDetails.at(-1);
    const raw = JSON.stringify(status.raw).slice(0, 8000);

    if (p.state === 'completed') {
      // Already final. A later FAILED for a completed order would be anomalous — record, don't regress.
      if (status.state !== 'COMPLETED') audit(ctx, source, 'payment.state_conflict', p.booking_id, { paymentId, reported: status.state });
      return;
    }

    if (status.state === 'COMPLETED') {
      if (status.amount !== p.amount_paise) {
        // Never confirm on a mismatched amount.
        setPayment(ctx, p.id, { state: 'completed', last_response_json: raw, gateway_transaction_id: success?.transactionId ?? null });
        setBooking(ctx, p.booking_id, {
          needs_attention: `PhonePe reported ${status.amount} paise but ${p.amount_paise} paise was requested — check before confirming.`,
        });
        audit(ctx, source, 'payment.amount_mismatch', p.booking_id, { paymentId, expected: p.amount_paise, reported: status.amount });
        return;
      }
      setPayment(ctx, p.id, {
        state: 'completed',
        gateway_order_id: status.orderId ?? p.gateway_order_id,
        gateway_transaction_id: success?.transactionId ?? null,
        gateway_payment_mode: success?.paymentMode ?? null,
        last_response_json: raw,
      });
      audit(ctx, source, 'payment.gateway_completed', p.booking_id, { paymentId, transactionId: success?.transactionId });

      const b = getBookingById(ctx, p.booking_id)!;
      const otherPaid = paymentsFor(ctx, b.id).some((x) => x.id !== p.id && (x.state === 'completed' || x.state === 'verified'));
      if (b.status === 'confirmed' && otherPaid) {
        setBooking(ctx, b.id, { needs_attention: 'A second payment was received for an already-confirmed booking — refund the duplicate.' });
        audit(ctx, source, 'payment.duplicate', b.id, { paymentId });
        return;
      }
      confirmBooking(ctx, b.id, source, { via: 'gateway', paymentId, merchantOrderId: p.merchant_order_id });
      return;
    }

    if (status.state === 'FAILED') {
      if (p.state === 'failed') return;
      setPayment(ctx, p.id, { state: 'failed', gateway_error_code: lastAttempt?.errorCode ?? null, last_response_json: raw });
      const b = getBookingById(ctx, p.booking_id)!;
      if (b.status === 'pending_payment') setBooking(ctx, b.id, { payment_status: 'failed' });
      audit(ctx, source, 'payment.gateway_failed', b.id, { paymentId, errorCode: lastAttempt?.errorCode });
      return;
    }

    // PENDING
    if (p.state !== 'pending') setPayment(ctx, p.id, { state: 'pending', last_response_json: raw });
    else setPayment(ctx, p.id, { last_response_json: raw });
  });
}

/** Asks PhonePe for the latest state of every open gateway attempt on a booking. */
export async function refreshGatewayPayments(ctx: Ctx, bookingId: number, source = 'system') {
  if (!ctx.phonepe) return;
  const open = paymentsFor(ctx, bookingId).filter((p) => p.method === 'gateway' && (p.state === 'pending' || p.state === 'created'));
  for (const p of open) {
    try {
      const status = await ctx.phonepe.orderStatus(p.merchant_order_id!);
      reconcileGatewayPayment(ctx, p.id, status, source);
    } catch (e) {
      // A 'created' order PhonePe never registered → mark failed so it's not retried forever.
      if (p.state === 'created' && e instanceof PhonePeError && (e.status === 400 || e.status === 404)) {
        setPayment(ctx, p.id, { state: 'failed', gateway_error_code: e.code });
      } else {
        console.warn(`[phonepe] status check failed for ${p.merchant_order_id}:`, (e as Error).message);
      }
    }
  }
}

export async function startGatewayPayment(ctx: Ctx, booking: BookingRow, guestToken: string | undefined): Promise<{ redirectUrl: string } | { alreadyPaid: true }> {
  if (!ctx.phonepe || !ctx.config.phonepe.enabled) {
    throw new HttpError(503, 'Online card/UPI checkout isn’t available yet. Please pay using the QR code.', 'GATEWAY_DISABLED');
  }
  // Pick up any payment that already went through before starting a new one.
  await refreshGatewayPayments(ctx, booking.id);
  sweepExpiredHolds(ctx);
  const b = getBookingById(ctx, booking.id)!;
  if (b.status === 'confirmed') return { alreadyPaid: true };
  if (b.status !== 'pending_payment') {
    throw new HttpError(409, b.status === 'expired' ? 'This booking hold has expired. Please start a new booking.' : 'This booking can’t be paid online.', 'NOT_PAYABLE');
  }

  // Idempotency: a double-click or retry reuses the still-open order instead of creating a new one.
  const nowMs = ctx.now().getTime();
  const reusable = paymentsFor(ctx, b.id).find(
    (p) => p.method === 'gateway' && p.state === 'pending' && p.redirect_url && p.expires_at && Date.parse(p.expires_at) - nowMs > 120_000,
  );
  if (reusable) return { redirectUrl: reusable.redirect_url! };

  const attempts = paymentsFor(ctx, b.id).filter((p) => p.method === 'gateway').length;
  const merchantOrderId = `${b.ref}-${attempts + 1}-${crypto.randomBytes(3).toString('hex')}`;
  const now = iso(ctx);
  const paymentId = tx(ctx.db, () => {
    const r = ctx.db
      .prepare(`INSERT INTO payments (booking_id, method, state, amount_paise, merchant_order_id, created_at, updated_at) VALUES (?, 'gateway', 'created', ?, ?, ?, ?)`)
      .run(b.id, b.pay_now_paise, merchantOrderId, now, now);
    // Keep the room held while the guest is on PhonePe's page.
    const holdUntil = new Date(nowMs + (ctx.config.phonepe.orderExpirySeconds + 300) * 1000).toISOString();
    if (!b.hold_expires_at || b.hold_expires_at < holdUntil) setBooking(ctx, b.id, { hold_expires_at: holdUntil });
    audit(ctx, 'guest', 'payment.gateway_initiated', b.id, { merchantOrderId, amountPaise: b.pay_now_paise });
    return Number(r.lastInsertRowid);
  });

  // Signed-in guests get back in via their account; link-token guests via the token.
  const tokenPart = guestToken ? `&t=${encodeURIComponent(guestToken)}` : '';
  const redirectUrl = `${ctx.config.siteUrl}/booking/?ref=${encodeURIComponent(b.ref)}${tokenPart}&return=1`;
  try {
    const order = await ctx.phonepe.createPayment({ merchantOrderId, amountPaise: b.pay_now_paise, redirectUrl, bookingRef: b.ref });
    setPayment(ctx, paymentId, {
      state: 'pending',
      gateway_order_id: order.orderId,
      redirect_url: order.redirectUrl,
      expires_at: order.expireAt ? new Date(order.expireAt).toISOString() : new Date(nowMs + ctx.config.phonepe.orderExpirySeconds * 1000).toISOString(),
    });
    return { redirectUrl: order.redirectUrl };
  } catch (e) {
    setPayment(ctx, paymentId, { state: 'failed', gateway_error_code: e instanceof PhonePeError ? e.code : 'NETWORK' });
    audit(ctx, 'system', 'payment.gateway_init_failed', b.id, { merchantOrderId, error: (e as Error).message });
    throw new HttpError(502, 'We couldn’t start the PhonePe payment. Please try again, or pay using the QR code.', 'GATEWAY_ERROR');
  }
}

// ---------- Method B: merchant QR + guest-submitted UTR ----------

/**
 * Guest says they've paid by UPI. The 12-digit UTR is optional (it helps the
 * owner find the payment); if given, it must be valid and unused. The booking
 * becomes "pending verification" and the owner is emailed a confirm link.
 */
export function submitQrPayment(ctx: Ctx, booking: BookingRow, utrRaw: unknown) {
  const given = String(utrRaw ?? '').trim();
  const utr = given ? normaliseUtr(given) : null;
  if (given && !utr) throw new HttpError(400, 'That doesn’t look like a UPI reference. It should be 12 digits — or leave it empty.', 'INVALID_UTR', 'utr');

  return tx(ctx.db, () => {
    const b = getBookingById(ctx, booking.id)!;
    if (b.status === 'confirmed') throw new HttpError(409, 'This booking is already confirmed.', 'ALREADY_CONFIRMED');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled. Please contact us.', 'NOT_PAYABLE');

    const clash = utr
      ? (ctx.db
          .prepare(`SELECT booking_id FROM payments WHERE utr = ? AND state <> 'rejected' AND booking_id <> ?`)
          .get(utr, b.id) as { booking_id: number } | undefined)
      : undefined;
    if (clash) throw new HttpError(409, 'This transaction reference has already been used for another booking.', 'UTR_USED', 'utr');

    const existing = paymentsFor(ctx, b.id).find((p) => p.method === 'qr' && p.state === 'submitted');
    const now = iso(ctx);
    if (existing) {
      if (utr) setPayment(ctx, existing.id, { utr });
      audit(ctx, 'guest', 'payment.qr_reference_updated', b.id, { paymentId: existing.id, utr });
    } else {
      const r = ctx.db
        .prepare(`INSERT INTO payments (booking_id, method, state, amount_paise, utr, created_at, updated_at) VALUES (?, 'qr', 'submitted', ?, ?, ?, ?)`)
        .run(b.id, b.pay_now_paise, utr, now, now);
      const paymentId = Number(r.lastInsertRowid);
      audit(ctx, 'guest', 'payment.qr_submitted', b.id, { utr, amountPaise: b.pay_now_paise });
      // Email the owner a Review & confirm link once this is saved.
      onCommit(ctx.db, () => inBackground('verify email', () => notifyOwnerToVerify(ctx, b.id, paymentId)));
    }

    // Submitted references are NOT proof of payment — the booking waits for the owner to verify.
    if (b.status === 'expired' && !tryReacquireNights(ctx, b)) {
      setBooking(ctx, b.id, {
        payment_status: 'pending_verification',
        needs_attention: 'QR payment reported after the hold expired and the room is no longer free — verify and refund.',
      });
      return getBookingById(ctx, b.id)!;
    }
    setBooking(ctx, b.id, { status: 'pending_verification', payment_status: 'pending_verification', hold_expires_at: null });
    return getBookingById(ctx, b.id)!;
  });
}

// ---------- admin actions (each one is audit-logged with the admin's note) ----------

function requireNote(note: unknown): string {
  const n = String(note ?? '').trim();
  if (n.length < 3) throw new HttpError(400, 'Please add a short note for the audit log.', 'NOTE_REQUIRED', 'note');
  return n.slice(0, 500);
}

function bookingPayment(ctx: Ctx, bookingId: number, paymentId: unknown) {
  const p = getPayment(ctx, Number(paymentId));
  if (!p || p.booking_id !== bookingId) throw new HttpError(404, 'Payment not found for this booking.', 'NOT_FOUND');
  return p;
}

export function adminVerifyQr(ctx: Ctx, booking: BookingRow, paymentId: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  return tx(ctx.db, () => {
    const p = bookingPayment(ctx, booking.id, paymentId);
    if (p.method !== 'qr' || p.state !== 'submitted') throw new HttpError(409, 'Only submitted QR payments can be verified.', 'BAD_STATE');
    setPayment(ctx, p.id, { state: 'verified' });
    audit(ctx, actor, 'payment.qr_verified', booking.id, { paymentId: p.id, utr: p.utr, amountPaise: p.amount_paise, note: n });
    confirmBooking(ctx, booking.id, actor, { via: 'qr', paymentId: p.id, utr: p.utr });
  });
}

export function adminRejectQr(ctx: Ctx, booking: BookingRow, paymentId: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  return tx(ctx.db, () => {
    const p = bookingPayment(ctx, booking.id, paymentId);
    if (p.method !== 'qr' || p.state !== 'submitted') throw new HttpError(409, 'Only submitted QR payments can be rejected.', 'BAD_STATE');
    setPayment(ctx, p.id, { state: 'rejected' });
    const b = getBookingById(ctx, booking.id)!;
    if (b.status !== 'confirmed') {
      releaseNights(ctx, b.id);
      setBooking(ctx, b.id, { status: 'cancelled', payment_status: 'failed', hold_expires_at: null, needs_attention: null });
    }
    audit(ctx, actor, 'payment.qr_rejected', booking.id, { paymentId: p.id, utr: p.utr, note: n });
  });
}

export function adminCancel(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  return tx(ctx.db, () => {
    const b = getBookingById(ctx, booking.id)!;
    if (b.status === 'cancelled') throw new HttpError(409, 'Booking is already cancelled.', 'BAD_STATE');
    releaseNights(ctx, b.id);
    const paid = amountPaid(ctx, b.id);
    setBooking(ctx, b.id, {
      status: 'cancelled',
      hold_expires_at: null,
      needs_attention: paid > 0 ? 'Cancelled after payment — refund due.' : null,
    });
    audit(ctx, actor, 'booking.cancelled', b.id, { previousStatus: b.status, amountPaidPaise: paid, note: n });
  });
}

export function adminClearAttention(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  setBooking(ctx, booking.id, { needs_attention: null });
  audit(ctx, actor, 'booking.attention_cleared', booking.id, { previous: booking.needs_attention, note: n });
}

function updateRefundedStatus(ctx: Ctx, bookingId: number) {
  const b = getBookingById(ctx, bookingId)!;
  if (amountPaid(ctx, bookingId) <= 0 && b.payment_status === 'successful') {
    setBooking(ctx, bookingId, { payment_status: 'refunded', needs_attention: null });
  }
}

export async function adminRefund(ctx: Ctx, booking: BookingRow, paymentId: unknown, amountRupees: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  const p = bookingPayment(ctx, booking.id, paymentId);
  if (!(p.state === 'completed' || p.state === 'verified')) throw new HttpError(409, 'Only successful payments can be refunded.', 'BAD_STATE');
  const already = ctx.db
    .prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s FROM refunds WHERE payment_id = ? AND state <> 'failed'`)
    .get(p.id) as { s: number };
  const amountPaise = Math.round(Number(amountRupees) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100 || amountPaise > p.amount_paise - already.s) {
    throw new HttpError(400, 'Refund amount must be at least ₹1 and no more than the amount not yet refunded.', 'INVALID_AMOUNT', 'amount');
  }
  const merchantRefundId = `RF-${booking.ref}-${crypto.randomBytes(4).toString('hex')}`;
  const now = iso(ctx);

  if (p.method === 'qr') {
    // QR payments can't be refunded through an API — the owner refunds in the PhonePe Business app and records it here.
    tx(ctx.db, () => {
      ctx.db
        .prepare(`INSERT INTO refunds (payment_id, method, merchant_refund_id, amount_paise, state, note, created_at, updated_at) VALUES (?, 'manual', ?, ?, 'completed', ?, ?, ?)`)
        .run(p.id, merchantRefundId, amountPaise, n, now, now);
      audit(ctx, actor, 'refund.recorded_manual', booking.id, { paymentId: p.id, amountPaise, note: n });
      updateRefundedStatus(ctx, booking.id);
    });
    return;
  }

  if (!ctx.phonepe) throw new HttpError(503, 'PhonePe gateway is not configured on this server.', 'GATEWAY_DISABLED');
  const res = await ctx.phonepe.refund({ merchantRefundId, originalMerchantOrderId: p.merchant_order_id!, amountPaise });
  tx(ctx.db, () => {
    ctx.db
      .prepare(`INSERT INTO refunds (payment_id, method, merchant_refund_id, gateway_refund_id, amount_paise, state, note, created_at, updated_at) VALUES (?, 'gateway', ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(p.id, merchantRefundId, res.refundId, amountPaise, n, now, now);
    audit(ctx, actor, 'refund.initiated', booking.id, { paymentId: p.id, merchantRefundId, amountPaise, note: n });
  });
}

/** Applies PhonePe's refund status (from the refund-status API) to our record. */
export async function refreshRefund(ctx: Ctx, merchantRefundId: string, source: string) {
  if (!ctx.phonepe) return;
  const r = ctx.db.prepare('SELECT * FROM refunds WHERE merchant_refund_id = ?').get(merchantRefundId) as
    | { id: number; payment_id: number; state: string }
    | undefined;
  if (!r || r.state !== 'pending') return;
  const status = await ctx.phonepe.refundStatus(merchantRefundId);
  const state = status.state === 'COMPLETED' ? 'completed' : status.state === 'FAILED' ? 'failed' : 'pending';
  if (state === 'pending') return;
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE refunds SET state = ?, updated_at = ? WHERE id = ?').run(state, iso(ctx), r.id);
    const p = getPayment(ctx, r.payment_id)!;
    audit(ctx, source, `refund.${state}`, p.booking_id, { merchantRefundId });
    if (state === 'completed') updateRefundedStatus(ctx, p.booking_id);
  });
}
