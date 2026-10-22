// Emails to the GUEST about an online booking: "confirmed" and "not accepted".
// Sent through the owner's Google Apps Script ("guest_email" action), so they
// come from the owner's Gmail and replies reach the owner. Only bookings with
// a guest email (online bookings) get one; enquiry guests are contacted on
// WhatsApp. The audit log records whether each email really went out.

import { formatPaise } from '../../shared/catalog.ts';
import { formatISODate } from '../../shared/validate.ts';
import { amountPaid, getBookingById, type Ctx } from '../bookings.ts';
import { getPropertySettings } from '../settings.ts';
import { safeAudit } from './confirmation.ts';
import { sendGuestEmail, sheetsConfigured } from './sheets.ts';
import { escapeHtml } from './telegram.ts';

export type GuestEmailKind = 'confirmed' | 'rejected';

export async function buildGuestEmail(ctx: Ctx, bookingId: number, kind: GuestEmailKind) {
  const b = await getBookingById(ctx, bookingId);
  if (!b || !b.guest_email) return null;
  const s = await getPropertySettings(ctx);
  const first = b.guest_name.split(' ')[0];
  const nights = `${b.nights} ${b.nights === 1 ? 'night' : 'nights'}`;
  const link = `${ctx.config.siteUrl}/booking/?ref=${encodeURIComponent(b.ref)}`;
  const rows: [string, string][] =
    kind === 'confirmed'
      ? [
          ['Booking ID', b.ref],
          ['Room', b.room_name],
          ['Check-in', `${formatISODate(b.check_in)}${s.checkInTime ? ` from ${s.checkInTime}` : ''}`],
          ['Check-out', `${formatISODate(b.check_out)}${s.checkOutTime ? ` by ${s.checkOutTime}` : ''} (${nights})`],
          ['Guests', String(b.guests)],
          ['Paid', formatPaise(await amountPaid(ctx, b.id))],
        ]
      : [
          ['Booking ID', b.ref],
          ['Room', b.room_name],
          ['Dates', `${formatISODate(b.check_in)} → ${formatISODate(b.check_out)} (${nights})`],
        ];
  const subject =
    kind === 'confirmed'
      ? `Your Golden Stay booking is confirmed – ${b.ref}`
      : `About your Golden Stay booking request – ${b.ref}`;
  const intro =
    kind === 'confirmed'
      ? `Hello ${first}, your booking at Golden Stay is confirmed. Please bring a valid photo ID for all adult guests. See you soon!`
      : `Hello ${first}, sorry — we couldn’t accept this booking request. If you made a payment, Golden Stay will contact you about the refund. Reply to this email or message us on WhatsApp if other dates would work for you.`;
  const text = [intro, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Your booking: ${link}`, '', 'Golden Stay · Maligaon, Guwahati · +91 91010 87949'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#171717;max-width:560px">
<h2 style="margin:0 0 10px;font-weight:600">${kind === 'confirmed' ? 'Your booking is confirmed' : 'About your booking request'}</h2>
<p style="margin:0 0 16px;line-height:1.55">${escapeHtml(intro)}</p>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e2ddd7;color:#6e6863;width:38%">${escapeHtml(k)}</td><td style="border-bottom:1px solid #e2ddd7;font-weight:600">${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(link)}" style="background:#171717;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">View your booking</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#77716c">Golden Stay · House No. 2, Sati Joymati Nagar, BG Colony, Maligaon, Guwahati · +91 91010 87949</p>
</div>`;
  return { to: b.guest_email, subject, text, html };
}

/** Sends it (best effort). Records email.guest_<kind>_sent / _failed / _skipped in the audit log. */
export async function notifyGuest(ctx: Ctx, bookingId: number, kind: GuestEmailKind): Promise<void> {
  const email = await buildGuestEmail(ctx, bookingId, kind);
  if (!email) return; // no guest email on this booking (owner-entered / enquiry)
  if (!sheetsConfigured(ctx.config.notify)) {
    await safeAudit(ctx, `email.guest_${kind}_skipped`, bookingId, { reason: 'Google Apps Script not configured' });
    return;
  }
  try {
    await sendGuestEmail(ctx.config.notify, email);
    await safeAudit(ctx, `email.guest_${kind}_sent`, bookingId, { to: email.to });
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[guest-email] ${kind} for booking ${bookingId} failed:`, error);
    await safeAudit(ctx, `email.guest_${kind}_failed`, bookingId, { error });
  }
}
