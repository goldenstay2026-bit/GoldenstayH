// "Booking confirmed" email to the owner (goldenstay2026@gmail.com), sent
// through the Google Apps Script web app once a payment is verified and the
// booking becomes confirmed — by the PhonePe gateway or by the owner
// verifying a QR payment in the admin.

import { formatPaise } from '../../shared/catalog.ts';
import { formatISODate, formatIndianMobile } from '../../shared/validate.ts';
import { amountPaid, audit, getBookingById, paymentsFor, type Ctx } from '../bookings.ts';
import { formatIST } from './time.ts';
import { sendConfirmationEmail, sheetsConfigured, type ConfirmationEmail } from './sheets.ts';
import { inBackground } from '../background.ts';
import { escapeHtml } from './telegram.ts';

const RETRY_MS = 30_000;

/** Audit from background work; never throws (the DB may be closing). */
export function safeAudit(ctx: Ctx, action: string, bookingId: number, details: Record<string, unknown>) {
  try {
    audit(ctx, 'system', action, bookingId, details);
  } catch (e) {
    console.warn(`[audit] could not record ${action}:`, (e as Error).message);
  }
}

export function buildConfirmationEmail(ctx: Ctx, bookingId: number): ConfirmationEmail | null {
  const b = getBookingById(ctx, bookingId);
  if (!b || b.status !== 'confirmed') return null;
  const paid = paymentsFor(ctx, b.id).filter((p) => p.state === 'completed' || p.state === 'verified').at(-1);
  const method = paid?.method === 'gateway' ? `PhonePe online${paid.gateway_payment_mode ? ` (${paid.gateway_payment_mode})` : ''}` : 'UPI QR (verified by owner)';
  const reference = (paid?.method === 'gateway' ? paid.gateway_transaction_id ?? paid.merchant_order_id : paid?.utr) ?? '—';
  const confirmedAt = formatIST(new Date(b.confirmed_at ?? ctx.now().toISOString()));
  const nights = `${b.nights} ${b.nights === 1 ? 'night' : 'nights'}`;

  const booking = {
    ref: b.ref,
    guestName: b.guest_name,
    guestPhone: formatIndianMobile(b.guest_phone),
    guestEmail: b.guest_email,
    room: b.room_name,
    checkIn: formatISODate(b.check_in),
    checkOut: formatISODate(b.check_out),
    nights: b.nights,
    guests: b.guests,
    amountPaid: formatPaise(amountPaid(ctx, b.id)),
    method,
    reference,
    confirmedAt,
  };

  const rows: [string, string][] = [
    ['Booking ID', booking.ref],
    ['Guest', booking.guestName],
    ['Phone', booking.guestPhone],
    ['Email', booking.guestEmail],
    ['Room', booking.room],
    ['Check-in', booking.checkIn],
    ['Check-out', `${booking.checkOut} (${nights})`],
    ['Guests', String(booking.guests)],
    ['Amount paid', `${booking.amountPaid} of ${formatPaise(b.total_paise)}`],
    ['Payment', booking.method],
    ['Reference', booking.reference],
    ['Confirmed at', booking.confirmedAt],
  ];
  if (b.guest_message) rows.push(['Guest message', b.guest_message]);

  const adminUrl = `${ctx.config.siteUrl}/admin/`;
  const subject = `✅ Booking confirmed – ${b.ref} · ${b.room_name} · ${booking.checkIn} → ${booking.checkOut}`;
  const text = [
    'A Golden Stay booking is confirmed (payment verified).',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Admin: ${adminUrl}`,
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:560px">
<h2 style="margin:0 0 4px;font-weight:600">Booking confirmed ✅</h2>
<p style="margin:0 0 16px;color:#6e6863">Payment verified · ${escapeHtml(booking.confirmedAt)}</p>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="border-bottom:1px solid #e2ddd7;color:#6e6863;width:38%">${escapeHtml(k)}</td><td style="border-bottom:1px solid #e2ddd7;font-weight:600">${escapeHtml(v)}</td></tr>`,
  )
  .join('\n')}
</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(adminUrl)}" style="background:#171717;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open admin</a>
&nbsp; <a href="tel:+91${escapeHtml(b.guest_phone)}">Call guest</a> · <a href="https://wa.me/91${escapeHtml(b.guest_phone)}">WhatsApp guest</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#77716c">Sent automatically by the Golden Stay website.</p>
</div>`;
  return { booking, subject, text, html };
}

/**
 * Sends the owner's confirmation email (best effort, one retry). Never throws:
 * the booking is already confirmed; the result is recorded in the audit log.
 */
export async function notifyBookingConfirmed(ctx: Ctx, bookingId: number, attempt = 1): Promise<void> {
  if (!sheetsConfigured(ctx.config.notify)) {
    console.warn('[confirm-email] Not sent — SHEETS_WEBHOOK_URL / SHEETS_SECRET not configured.');
    return;
  }
  const email = buildConfirmationEmail(ctx, bookingId);
  if (!email) return;
  try {
    await sendConfirmationEmail(ctx.config.notify, email);
    safeAudit(ctx, 'email.confirmation_sent', bookingId, { attempt });
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[confirm-email] ${email.booking.ref} attempt ${attempt} failed:`, error);
    safeAudit(ctx, 'email.confirmation_failed', bookingId, { attempt, error });
    if (attempt < 2) setTimeout(() => inBackground('confirmation email retry', () => notifyBookingConfirmed(ctx, bookingId, attempt + 1)), RETRY_MS).unref();
  }
}
