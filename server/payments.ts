import crypto from 'node:crypto';
import { normaliseUtr } from '../shared/validate.ts';
import {
  queueBookingSync,
  amountPaid,
  audit,
  getBookingById,
  iso,
  paymentsFor,
  refundsFor,
  releaseNights,
  setBooking,
  sweepExpiredHolds,
  tryReacquireNights,
  type BookingRow,
  type Ctx,
  type PaymentRow,
  type RefundRow,
} from './bookings.ts';
import { inBackground } from './background.ts';
import { notifyBookingConfirmed } from './notify/confirmation.ts';
import { notifyOwnerToVerify } from './notify/ownerVerify.ts';
import { notifyGuest } from './notify/guestEmail.ts';
import { todayInIndia } from '../shared/validate.ts';
import { HttpError } from './http.ts';
import { PhonePeError, type OrderStatus } from './phonepe.ts';

export const getPayment = (ctx: Ctx, id: number) => ctx.db.get<PaymentRow>('payments', id);
export const getPaymentByOrderId = async (ctx: Ctx, merchantOrderId: string) =>
  (await ctx.db.query<PaymentRow>('payments', { where: [['merchant_order_id', '==', merchantOrderId]] }))[0];

async function setPayment(ctx: Ctx, id: number, fields: Partial<Omit<PaymentRow, 'id' | 'booking_id' | 'method' | 'created_at'>>) {
  await ctx.db.update('payments', id, { ...fields, updated_at: iso(ctx) });
  const p = await getPayment(ctx, id);
  if (p) queueBookingSync(ctx, p.booking_id);
}

function newPaymentRow(b: BookingRow, method: 'gateway' | 'qr' | 'manual', state: string, now: string, extra: Partial<PaymentRow> = {}): Omit<PaymentRow, 'id'> {
  return {
    booking_id: b.id,
    method,
    state,
    amount_paise: b.pay_now_paise,
    merchant_order_id: null,
    gateway_order_id: null,
    gateway_transaction_id: null,
    gateway_payment_mode: null,
    gateway_error_code: null,
    redirect_url: null,
    expires_at: null,
    utr: null,
    last_response_json: null,
    created_at: now,
    updated_at: now,
    ...extra,
  };
}

/**
 * Marks a booking confirmed after a VERIFIED payment. Idempotent. If the
 * nights were released (payment arrived after the hold expired) it tries to
 * re-acquire them; if someone else has booked them meanwhile, the booking is
 * flagged for the owner to refund instead of double-booking.
 */
async function confirmBooking(ctx: Ctx, bookingId: number, actor: string, details: Record<string, unknown>): Promise<boolean> {
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, bookingId))!;
    if (b.status === 'confirmed') return true;
    if (!(await tryReacquireNights(ctx, b))) {
      await setBooking(ctx, b.id, {
        payment_status: 'successful',
        needs_attention: 'Payment received after the hold expired and the room is no longer free for these dates — refund or offer other dates.',
      });
      await audit(ctx, actor, 'booking.paid_but_unavailable', b.id, details);
      return false;
    }
    await setBooking(ctx, b.id, {
      status: 'confirmed',
      payment_status: 'successful',
      hold_expires_at: null,
      confirmed_at: iso(ctx),
    });
    await audit(ctx, actor, 'booking.confirmed', b.id, details);
    // Email the owner (and the guest) once the confirmation is committed (never for a rolled-back change).
    ctx.db.onCommit(() => inBackground('confirmation email', () => notifyBookingConfirmed(ctx, b.id)));
    ctx.db.onCommit(() => inBackground('guest confirmation email', () => notifyGuest(ctx, b.id, 'confirmed')));
    return true;
  });
}

// ---------- Method A: PhonePe Payment Gateway ----------

/**
 * Applies an authoritative PhonePe order status to our payment + booking.
 * Every path (webhook, return page, admin refresh) funnels through here, so
 * duplicate notifications are harmless.
 */
export async function reconcileGatewayPayment(ctx: Ctx, paymentId: number, status: OrderStatus, source: string) {
  return ctx.db.tx(async () => {
    const p = await getPayment(ctx, paymentId);
    if (!p || p.method !== 'gateway') return;
    const success = status.paymentDetails.find((d) => d.state === 'COMPLETED');
    const lastAttempt = status.paymentDetails.at(-1);
    const raw = JSON.stringify(status.raw).slice(0, 8000);

    if (p.state === 'completed') {
      // Already final. A later FAILED for a completed order would be anomalous — record, don't regress.
      if (status.state !== 'COMPLETED') await audit(ctx, source, 'payment.state_conflict', p.booking_id, { paymentId, reported: status.state });
      return;
    }

    if (status.state === 'COMPLETED') {
      if (status.amount !== p.amount_paise) {
        // Never confirm on a mismatched amount.
        await setPayment(ctx, p.id, { state: 'completed', last_response_json: raw, gateway_transaction_id: success?.transactionId ?? null });
        await setBooking(ctx, p.booking_id, {
          needs_attention: `PhonePe reported ${status.amount} paise but ${p.amount_paise} paise was requested — check before confirming.`,
        });
        await audit(ctx, source, 'payment.amount_mismatch', p.booking_id, { paymentId, expected: p.amount_paise, reported: status.amount });
        return;
      }
      await setPayment(ctx, p.id, {
        state: 'completed',
        gateway_order_id: status.orderId ?? p.gateway_order_id,
        gateway_transaction_id: success?.transactionId ?? null,
        gateway_payment_mode: success?.paymentMode ?? null,
        last_response_json: raw,
      });
      await audit(ctx, source, 'payment.gateway_completed', p.booking_id, { paymentId, transactionId: success?.transactionId });

      const b = (await getBookingById(ctx, p.booking_id))!;
      const otherPaid = (await paymentsFor(ctx, b.id)).some((x) => x.id !== p.id && (x.state === 'completed' || x.state === 'verified'));
      if (b.status === 'confirmed' && otherPaid) {
        await setBooking(ctx, b.id, { needs_attention: 'A second payment was received for an already-confirmed booking — refund the duplicate.' });
        await audit(ctx, source, 'payment.duplicate', b.id, { paymentId });
        return;
      }
      await confirmBooking(ctx, b.id, source, { via: 'gateway', paymentId, merchantOrderId: p.merchant_order_id });
      return;
    }

    if (status.state === 'FAILED') {
      if (p.state === 'failed') return;
      await setPayment(ctx, p.id, { state: 'failed', gateway_error_code: lastAttempt?.errorCode ?? null, last_response_json: raw });
      const b = (await getBookingById(ctx, p.booking_id))!;
      if (b.status === 'pending_payment') await setBooking(ctx, b.id, { payment_status: 'failed' });
      await audit(ctx, source, 'payment.gateway_failed', b.id, { paymentId, errorCode: lastAttempt?.errorCode });
      return;
    }

    // PENDING
    if (p.state !== 'pending') await setPayment(ctx, p.id, { state: 'pending', last_response_json: raw });
    else await setPayment(ctx, p.id, { last_response_json: raw });
  });
}

/** Asks PhonePe for the latest state of every open gateway attempt on a booking. */
export async function refreshGatewayPayments(ctx: Ctx, bookingId: number, source = 'system') {
  if (!ctx.phonepe) return;
  const open = (await paymentsFor(ctx, bookingId)).filter((p) => p.method === 'gateway' && (p.state === 'pending' || p.state === 'created'));
  for (const p of open) {
    try {
      const status = await ctx.phonepe.orderStatus(p.merchant_order_id!);
      await reconcileGatewayPayment(ctx, p.id, status, source);
    } catch (e) {
      // A 'created' order PhonePe never registered → mark failed so it's not retried forever.
      if (p.state === 'created' && e instanceof PhonePeError && (e.status === 400 || e.status === 404)) {
        await setPayment(ctx, p.id, { state: 'failed', gateway_error_code: e.code });
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
  await sweepExpiredHolds(ctx, true);
  const b = (await getBookingById(ctx, booking.id))!;
  if (b.status === 'confirmed') return { alreadyPaid: true };
  if (b.status !== 'pending_payment') {
    throw new HttpError(409, b.status === 'expired' ? 'This booking hold has expired. Please start a new booking.' : 'This booking can’t be paid online.', 'NOT_PAYABLE');
  }

  // Idempotency: a double-click or retry reuses the still-open order instead of creating a new one.
  const nowMs = ctx.now().getTime();
  const payments = await paymentsFor(ctx, b.id);
  const reusable = payments.find(
    (p) => p.method === 'gateway' && p.state === 'pending' && p.redirect_url && p.expires_at && Date.parse(p.expires_at) - nowMs > 120_000,
  );
  if (reusable) return { redirectUrl: reusable.redirect_url! };

  const attempts = payments.filter((p) => p.method === 'gateway').length;
  const merchantOrderId = `${b.ref}-${attempts + 1}-${crypto.randomBytes(3).toString('hex')}`;
  const now = iso(ctx);
  const paymentId = await ctx.db.tx(async () => {
    const id = Number(await ctx.db.insert('payments', newPaymentRow(b, 'gateway', 'created', now, { merchant_order_id: merchantOrderId })));
    // Keep the room held while the guest is on PhonePe's page.
    const holdUntil = new Date(nowMs + (ctx.config.phonepe.orderExpirySeconds + 300) * 1000).toISOString();
    if (!b.hold_expires_at || b.hold_expires_at < holdUntil) await setBooking(ctx, b.id, { hold_expires_at: holdUntil });
    await audit(ctx, 'guest', 'payment.gateway_initiated', b.id, { merchantOrderId, amountPaise: b.pay_now_paise });
    return id;
  });

  // Signed-in guests get back in via their account; link-token guests via the token.
  const tokenPart = guestToken ? `&t=${encodeURIComponent(guestToken)}` : '';
  const redirectUrl = `${ctx.config.siteUrl}/booking/?ref=${encodeURIComponent(b.ref)}${tokenPart}&return=1`;
  try {
    const order = await ctx.phonepe.createPayment({ merchantOrderId, amountPaise: b.pay_now_paise, redirectUrl, bookingRef: b.ref });
    await setPayment(ctx, paymentId, {
      state: 'pending',
      gateway_order_id: order.orderId,
      redirect_url: order.redirectUrl,
      expires_at: order.expireAt ? new Date(order.expireAt).toISOString() : new Date(nowMs + ctx.config.phonepe.orderExpirySeconds * 1000).toISOString(),
    });
    return { redirectUrl: order.redirectUrl };
  } catch (e) {
    await setPayment(ctx, paymentId, { state: 'failed', gateway_error_code: e instanceof PhonePeError ? e.code : 'NETWORK' });
    await audit(ctx, 'system', 'payment.gateway_init_failed', b.id, { merchantOrderId, error: (e as Error).message });
    throw new HttpError(502, 'We couldn’t start the PhonePe payment. Please try again, or pay using the QR code.', 'GATEWAY_ERROR');
  }
}

// ---------- Method B: merchant QR + guest-submitted UTR ----------

/**
 * Guest says they've paid by UPI. The 12-digit UTR is optional (it helps the
 * owner find the payment); if given, it must be valid and unused. The booking
 * becomes "pending verification" and the owner is emailed a confirm link.
 */
export async function submitQrPayment(ctx: Ctx, booking: BookingRow, utrRaw: unknown) {
  const given = String(utrRaw ?? '').trim();
  const utr = given ? normaliseUtr(given) : null;
  if (given && !utr) throw new HttpError(400, 'That doesn’t look like a UPI reference. It should be 12 digits — or leave it empty.', 'INVALID_UTR', 'utr');

  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (b.status === 'confirmed') throw new HttpError(409, 'This booking is already confirmed.', 'ALREADY_CONFIRMED');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled. Please contact us.', 'NOT_PAYABLE');

    if (utr) {
      const clash = (await ctx.db.query<PaymentRow>('payments', { where: [['utr', '==', utr]] })).some((p) => p.state !== 'rejected' && p.booking_id !== b.id);
      if (clash) throw new HttpError(409, 'This transaction reference has already been used for another booking.', 'UTR_USED', 'utr');
    }

    const existing = (await paymentsFor(ctx, b.id)).find((p) => p.method === 'qr' && p.state === 'submitted');
    const now = iso(ctx);
    if (existing) {
      if (utr) await setPayment(ctx, existing.id, { utr });
      await audit(ctx, 'guest', 'payment.qr_reference_updated', b.id, { paymentId: existing.id, utr });
    } else {
      const paymentId = Number(await ctx.db.insert('payments', newPaymentRow(b, 'qr', 'submitted', now, { utr })));
      await audit(ctx, 'guest', 'payment.qr_submitted', b.id, { utr, amountPaise: b.pay_now_paise });
      // Email the owner a Review & confirm link once this is saved.
      ctx.db.onCommit(() => inBackground('verify email', () => notifyOwnerToVerify(ctx, b.id, paymentId)));
    }

    // Submitted references are NOT proof of payment — the booking waits for the owner to verify.
    if (b.status === 'expired' && !(await tryReacquireNights(ctx, b))) {
      await setBooking(ctx, b.id, {
        payment_status: 'pending_verification',
        needs_attention: 'QR payment reported after the hold expired and the room is no longer free — verify and refund.',
      });
      return (await getBookingById(ctx, b.id))!;
    }
    await setBooking(ctx, b.id, { status: 'pending_verification', payment_status: 'pending_verification', hold_expires_at: null });
    return (await getBookingById(ctx, b.id))!;
  });
}

// ---------- admin actions (each one is audit-logged with the admin's note) ----------

function requireNote(note: unknown): string {
  const n = String(note ?? '').trim();
  if (n.length < 3) throw new HttpError(400, 'Please add a short note for the audit log.', 'NOTE_REQUIRED', 'note');
  return n.slice(0, 500);
}

async function bookingPayment(ctx: Ctx, bookingId: number, paymentId: unknown) {
  const id = Number(paymentId);
  const p = Number.isInteger(id) && id > 0 ? await getPayment(ctx, id) : undefined;
  if (!p || p.booking_id !== bookingId) throw new HttpError(404, 'Payment not found for this booking.', 'NOT_FOUND');
  return p;
}

export async function adminVerifyQr(ctx: Ctx, booking: BookingRow, paymentId: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const p = await bookingPayment(ctx, booking.id, paymentId);
    if (p.method !== 'qr' || p.state !== 'submitted') throw new HttpError(409, 'Only submitted QR payments can be verified.', 'BAD_STATE');
    await setPayment(ctx, p.id, { state: 'verified' });
    await audit(ctx, actor, 'payment.qr_verified', booking.id, { paymentId: p.id, utr: p.utr, amountPaise: p.amount_paise, note: n });
    await confirmBooking(ctx, booking.id, actor, { via: 'qr', paymentId: p.id, utr: p.utr });
  });
}

export async function adminRejectQr(ctx: Ctx, booking: BookingRow, paymentId: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const p = await bookingPayment(ctx, booking.id, paymentId);
    if (p.method !== 'qr' || p.state !== 'submitted') throw new HttpError(409, 'Only submitted QR payments can be rejected.', 'BAD_STATE');
    await setPayment(ctx, p.id, { state: 'rejected' });
    const b = (await getBookingById(ctx, booking.id))!;
    if (b.status !== 'confirmed') {
      await releaseNights(ctx, b.id);
      await setBooking(ctx, b.id, { status: 'cancelled', payment_status: 'failed', hold_expires_at: null, needs_attention: null });
    }
    await audit(ctx, actor, 'payment.qr_rejected', booking.id, { paymentId: p.id, utr: p.utr, note: n });
  });
}

export async function adminCancel(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (b.status === 'cancelled') throw new HttpError(409, 'Booking is already cancelled.', 'BAD_STATE');
    await releaseNights(ctx, b.id);
    const paid = await amountPaid(ctx, b.id);
    await setBooking(ctx, b.id, {
      status: 'cancelled',
      hold_expires_at: null,
      needs_attention: paid > 0 ? 'Cancelled after payment — refund due.' : null,
    });
    await audit(ctx, actor, 'booking.cancelled', b.id, { previousStatus: b.status, amountPaidPaise: paid, note: n });
  });
}

export async function adminClearAttention(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  await setBooking(ctx, booking.id, { needs_attention: null });
  await audit(ctx, actor, 'booking.attention_cleared', booking.id, { previous: booking.needs_attention, note: n });
}

async function updateRefundedStatus(ctx: Ctx, bookingId: number) {
  const b = (await getBookingById(ctx, bookingId))!;
  if ((await amountPaid(ctx, bookingId)) <= 0 && b.payment_status === 'successful') {
    await setBooking(ctx, bookingId, { payment_status: 'refunded', needs_attention: null });
  }
}

function newRefundRow(p: PaymentRow, fields: Pick<RefundRow, 'method' | 'merchant_refund_id' | 'amount_paise' | 'state' | 'note'> & Partial<RefundRow>, now: string): Omit<RefundRow, 'id'> {
  return { payment_id: p.id, booking_id: p.booking_id, gateway_refund_id: null, created_at: now, updated_at: now, ...fields };
}

export async function adminRefund(ctx: Ctx, booking: BookingRow, paymentId: unknown, amountRupees: unknown, note: unknown, actor: string) {
  const n = requireNote(note);
  const p = await bookingPayment(ctx, booking.id, paymentId);
  if (!(p.state === 'completed' || p.state === 'verified')) throw new HttpError(409, 'Only successful payments can be refunded.', 'BAD_STATE');
  const already = (await refundsFor(ctx, booking.id)).filter((r) => r.payment_id === p.id && r.state !== 'failed').reduce((s, r) => s + r.amount_paise, 0);
  const amountPaise = Math.round(Number(amountRupees) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100 || amountPaise > p.amount_paise - already) {
    throw new HttpError(400, 'Refund amount must be at least ₹1 and no more than the amount not yet refunded.', 'INVALID_AMOUNT', 'amount');
  }
  const merchantRefundId = `RF-${booking.ref}-${crypto.randomBytes(4).toString('hex')}`;
  const now = iso(ctx);

  if (p.method === 'qr' || p.method === 'manual') {
    // QR and owner-recorded payments can't be refunded through an API — the owner refunds
    // (PhonePe Business app, cash, bank) and records it here.
    await ctx.db.tx(async () => {
      await ctx.db.insert('refunds', newRefundRow(p, { method: 'manual', merchant_refund_id: merchantRefundId, amount_paise: amountPaise, state: 'completed', note: n }, now));
      await audit(ctx, actor, 'refund.recorded_manual', booking.id, { paymentId: p.id, amountPaise, note: n });
      await updateRefundedStatus(ctx, booking.id);
    });
    return;
  }

  if (!ctx.phonepe) throw new HttpError(503, 'PhonePe gateway is not configured on this server.', 'GATEWAY_DISABLED');
  const res = await ctx.phonepe.refund({ merchantRefundId, originalMerchantOrderId: p.merchant_order_id!, amountPaise });
  await ctx.db.tx(async () => {
    await ctx.db.insert(
      'refunds',
      newRefundRow(p, { method: 'gateway', merchant_refund_id: merchantRefundId, gateway_refund_id: res.refundId, amount_paise: amountPaise, state: 'pending', note: n }, now),
    );
    await audit(ctx, actor, 'refund.initiated', booking.id, { paymentId: p.id, merchantRefundId, amountPaise, note: n });
  });
}

/** Applies PhonePe's refund status (from the refund-status API) to our record. */
export async function refreshRefund(ctx: Ctx, merchantRefundId: string, source: string) {
  if (!ctx.phonepe) return;
  const r = (await ctx.db.query<RefundRow>('refunds', { where: [['merchant_refund_id', '==', merchantRefundId]] }))[0];
  if (!r || r.state !== 'pending') return;
  const status = await ctx.phonepe.refundStatus(merchantRefundId);
  const state = status.state === 'COMPLETED' ? 'completed' : status.state === 'FAILED' ? 'failed' : 'pending';
  if (state === 'pending') return;
  await ctx.db.tx(async () => {
    await ctx.db.update('refunds', r.id, { state, updated_at: iso(ctx) });
    await audit(ctx, source, `refund.${state}`, r.booking_id, { merchantRefundId });
    if (state === 'completed') await updateRefundedStatus(ctx, r.booking_id);
  });
}

// ---------- booking status actions from the admin (each needs a note, all audit-logged) ----------

const PENDING = new Set(['pending_payment', 'pending_verification']);

/**
 * Owner confirms a pending online booking (e.g. paid in person, or a payment
 * they've already checked). The dates are re-checked on the server: if the
 * hold had lapsed and someone else took the nights meanwhile, it is refused.
 */
export async function adminConfirm(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (!PENDING.has(b.status) && b.status !== 'expired') throw new HttpError(409, `This booking is ${b.status.replace('_', ' ')} — only pending bookings can be confirmed.`, 'BAD_STATE');
    if (!(await tryReacquireNights(ctx, b))) {
      throw new HttpError(409, 'Those nights are no longer free — someone else booked them. Offer the guest other dates.', 'DATES_TAKEN');
    }
    await setBooking(ctx, b.id, { status: 'confirmed', hold_expires_at: null, confirmed_at: iso(ctx), needs_attention: null });
    await audit(ctx, actor, 'booking.confirmed_by_owner', b.id, { previousStatus: b.status, note: n });
    ctx.db.onCommit(() => inBackground('confirmation email', () => notifyBookingConfirmed(ctx, b.id)));
    ctx.db.onCommit(() => inBackground('guest confirmation email', () => notifyGuest(ctx, b.id, 'confirmed')));
  });
}

/** Owner declines a pending booking: its nights are released; a submitted UPI claim is marked rejected. */
export async function adminReject(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (!PENDING.has(b.status) && b.status !== 'expired') throw new HttpError(409, 'Only pending bookings can be rejected. Cancel a confirmed booking instead.', 'BAD_STATE');
    for (const p of await paymentsFor(ctx, b.id)) if (p.method === 'qr' && p.state === 'submitted') await setPayment(ctx, p.id, { state: 'rejected' });
    await releaseNights(ctx, b.id);
    const paid = await amountPaid(ctx, b.id);
    await setBooking(ctx, b.id, {
      status: 'rejected',
      payment_status: paid > 0 ? 'successful' : b.payment_status === 'pending_verification' ? 'failed' : b.payment_status,
      hold_expires_at: null,
      needs_attention: paid > 0 ? 'Rejected after payment — refund due.' : null,
    });
    await audit(ctx, actor, 'booking.rejected', b.id, { previousStatus: b.status, amountPaidPaise: paid, note: n });
    ctx.db.onCommit(() => inBackground('guest rejection email', () => notifyGuest(ctx, b.id, 'rejected')));
  });
}

/** Marks a confirmed stay completed — from the check-out day on. */
export async function adminComplete(ctx: Ctx, booking: BookingRow, note: unknown, actor: string) {
  const n = requireNote(note);
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (b.kind === 'block') throw new HttpError(409, 'Blocked dates can’t be completed — remove the block instead.', 'BAD_STATE');
    if (b.status !== 'confirmed') throw new HttpError(409, 'Only confirmed bookings can be marked completed.', 'BAD_STATE');
    if (b.check_out > todayInIndia(ctx.now())) throw new HttpError(409, `The stay ends on ${b.check_out} — mark it completed on or after check-out.`, 'TOO_EARLY');
    await setBooking(ctx, b.id, { status: 'completed' });
    await audit(ctx, actor, 'booking.completed', b.id, { note: n });
  });
}

const MANUAL_METHODS = ['cash', 'upi', 'bank', 'other'] as const;

/** Records a payment received outside the website (cash, UPI, bank transfer) — counts towards Paid / Partially paid. */
export async function adminRecordPayment(ctx: Ctx, booking: BookingRow, input: Record<string, unknown>, actor: string) {
  const n = requireNote(input.note);
  const method = (MANUAL_METHODS as readonly string[]).includes(String(input.method)) ? String(input.method) : 'other';
  const amountPaise = Math.round(Number(input.amount) * 100);
  if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 10_000_000) {
    throw new HttpError(400, 'Enter an amount between ₹1 and ₹1,00,000.', 'INVALID_AMOUNT', 'amount');
  }
  const reference = String(input.reference ?? '').trim().slice(0, 40) || null;
  return ctx.db.tx(async () => {
    const b = (await getBookingById(ctx, booking.id))!;
    if (b.kind === 'block') throw new HttpError(409, 'Blocked dates have no payments.', 'BAD_STATE');
    if (b.status === 'cancelled' || b.status === 'rejected' || b.status === 'expired') throw new HttpError(409, 'This booking is not active — record a refund instead if needed.', 'BAD_STATE');
    const now = iso(ctx);
    const id = Number(
      await ctx.db.insert('payments', {
        ...newPaymentRow(b, 'manual', 'verified', now, { utr: reference }),
        amount_paise: amountPaise,
        gateway_payment_mode: method,
      }),
    );
    const paid = await amountPaid(ctx, b.id);
    if (b.total_paise > 0 && paid >= b.total_paise) await setBooking(ctx, b.id, { payment_status: 'successful' });
    else queueBookingSync(ctx, b.id);
    await audit(ctx, actor, 'payment.recorded', b.id, { paymentId: id, method, amountPaise, reference, note: n });
    return id;
  });
}
