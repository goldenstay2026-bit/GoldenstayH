// "Payment to verify" email to the owner, with a Review & confirm button.
// Sent when a guest says they've paid by UPI. The owner checks the PhonePe
// Business app, then confirms (or rejects) from the email — no admin login.

import { formatPaise } from '../../shared/catalog.ts';
import { formatISODate, formatIndianMobile } from '../../shared/validate.ts';
import { getBookingById, type Ctx } from '../bookings.ts';
import { safeAudit } from './confirmation.ts';
import { createOwnerLinkToken } from '../ownerLinks.ts';
import { sendOwnerEmail, sheetsConfigured } from './sheets.ts';
import { escapeHtml } from './telegram.ts';
import { formatIST } from './time.ts';

export function ownerReviewUrl(ctx: Ctx, paymentId: number) {
  return `${ctx.config.siteUrl}/confirm/?t=${createOwnerLinkToken(ctx.config.ownerLinkSecret, paymentId, ctx.now().getTime())}`;
}

export async function notifyOwnerToVerify(ctx: Ctx, bookingId: number, paymentId: number): Promise<void> {
  if (!sheetsConfigured(ctx.config.notify)) return;
  const b = getBookingById(ctx, bookingId);
  const p = ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as { utr: string | null; amount_paise: number; created_at: string } | undefined;
  if (!b || !p) return;

  const url = ownerReviewUrl(ctx, paymentId);
  const amount = formatPaise(p.amount_paise);
  const rows: [string, string][] = [
    ['Amount to check', amount],
    ['UPI reference (UTR)', p.utr ?? 'Not given — look for the booking ID in the payment note'],
    ['Booking ID', b.ref],
    ['Guest', b.guest_name],
    ['Phone', formatIndianMobile(b.guest_phone)],
    ['Email', b.guest_email],
    ['Room', b.room_name],
    ['Dates', `${formatISODate(b.check_in)} → ${formatISODate(b.check_out)} (${b.nights} ${b.nights === 1 ? 'night' : 'nights'})`],
    ['Guests', String(b.guests)],
    ['Guest says paid at', formatIST(new Date(p.created_at))],
  ];
  const subject = `💳 Payment to verify – ${b.ref} · ${amount} · ${b.guest_name}`;
  const text = [
    `${b.guest_name} says they have paid ${amount} for booking ${b.ref}.`,
    'Check your PhonePe Business app for this payment, then confirm the booking here:',
    url,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'The link works for 7 days and only for this payment.',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:560px">
<h2 style="margin:0 0 6px;font-weight:600">Payment to verify 💳</h2>
<p style="margin:0 0 16px;color:#6e6863">${escapeHtml(b.guest_name)} says they have paid <b style="color:#171717">${escapeHtml(amount)}</b>. Check your PhonePe Business app, then confirm the booking.</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#171717;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Review &amp; confirm booking</a></p>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e2ddd7;color:#6e6863;width:40%">${escapeHtml(k)}</td><td style="border-bottom:1px solid #e2ddd7;font-weight:600">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:20px 0 0;font-size:12px;color:#77716c">The button opens a page where you press Confirm or Reject. The link works for 7 days and only for this payment. Sent automatically by the Golden Stay website.</p>
</div>`;

  try {
    await sendOwnerEmail(ctx.config.notify, { subject, text, html });
    safeAudit(ctx, 'email.verify_request_sent', bookingId, { paymentId });
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[verify-email] ${b.ref} failed:`, error);
    safeAudit(ctx, 'email.verify_request_failed', bookingId, { paymentId, error });
  }
}
