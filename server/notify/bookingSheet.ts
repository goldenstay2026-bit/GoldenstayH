// Keeps the owner's Google Sheet "Bookings" tab up to date: one row per
// booking, updated in place whenever its status changes (created, payment
// submitted, confirmed, cancelled, expired, refunded…). Best effort — SQLite
// stays the source of truth; failures are logged and retried once.

import type { BookingStatus, PaymentStatus } from '../../shared/types.ts';
import { formatPaise } from '../../shared/catalog.ts';
import { formatIndianMobile } from '../../shared/validate.ts';
import { paymentLabel, type BookingRow, type PaymentLabel, type PaymentRow } from '../bookings.ts';
import type { Config } from '../config.ts';
import { inBackground } from '../background.ts';
import { formatIST } from './time.ts';
import { sheetsConfigured, upsertBookingRow, type BookingSheetRow } from './sheets.ts';

const STATUS: Record<BookingStatus, string> = {
  pending_payment: 'Awaiting payment',
  pending_verification: 'Pending verification',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  expired: 'Expired (unpaid)',
  rejected: 'Rejected',
  completed: 'Completed',
};

const PAYMENT_LABEL: Record<PaymentLabel, string> = {
  paid: 'Paid',
  partially_paid: 'Partially paid',
  pending: 'Not paid',
  to_verify: 'To verify',
  refunded: 'Refunded',
  failed: 'Failed',
  not_recorded: 'Offline (not tracked)',
  none: '—',
};

const PAYMENT: Record<PaymentStatus, string> = {
  pending: 'Not paid',
  pending_verification: 'To verify',
  successful: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
};

const SOURCE: Record<string, string> = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  website_request: 'Website enquiry',
  other: 'Other',
};

export function bookingSheetRow(b: BookingRow, payments: PaymentRow[], paidPaise: number): BookingSheetRow {
  // Owner-entered bookings and blocks: payment is handled outside the website.
  if (b.source !== 'website_online') {
    const block = b.kind === 'block';
    return {
      ref: b.ref,
      status: block ? (b.status === 'cancelled' ? 'Block removed' : 'Blocked') : STATUS[b.status],
      payment: PAYMENT_LABEL[paymentLabel(b, paidPaise)],
      guestName: block ? '' : b.guest_name,
      guestPhone: block || !b.guest_phone ? '' : /^\d{10}$/.test(b.guest_phone) ? formatIndianMobile(b.guest_phone) : b.guest_phone,
      guestEmail: '',
      room: b.room_name,
      checkIn: b.check_in,
      checkOut: b.check_out,
      nights: b.nights,
      guests: b.guests,
      total: b.total_paise > 0 ? formatPaise(b.total_paise) : '—',
      paid: paidPaise > 0 ? formatPaise(paidPaise) : '—',
      method: block ? 'Blocked by owner' : `Added by owner · ${SOURCE[b.source] ?? b.source}`,
      reference: '',
      bookedAt: formatIST(new Date(b.created_at)),
      updatedAt: formatIST(new Date(b.updated_at)),
      needsAttention: '',
      message: [b.occasion && `Occasion: ${b.occasion}`, b.notes].filter(Boolean).join(' · '),
      version: b.updated_at,
    };
  }
  const last = payments.at(-1);
  const method = !last ? '—' : last.method === 'qr' ? 'UPI QR' : `PhonePe online${last.gateway_payment_mode ? ` (${last.gateway_payment_mode})` : ''}`;
  const reference = !last ? '' : last.method === 'qr' ? (last.utr ?? '') : (last.gateway_transaction_id ?? last.merchant_order_id ?? '');
  return {
    ref: b.ref,
    status: STATUS[b.status],
    payment: PAYMENT[b.payment_status],
    guestName: b.guest_name,
    guestPhone: formatIndianMobile(b.guest_phone),
    guestEmail: b.guest_email,
    room: b.room_name,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: b.nights,
    guests: b.guests,
    total: formatPaise(b.total_paise),
    paid: formatPaise(paidPaise),
    method,
    reference,
    bookedAt: formatIST(new Date(b.created_at)),
    updatedAt: formatIST(new Date(b.updated_at)),
    needsAttention: b.needs_attention ?? '',
    message: b.guest_message,
    // Lets the script ignore an older update that arrives after a newer one.
    version: b.updated_at,
  };
}

/** Sends the row; one retry after 30 s. Never throws. */
export function syncBookingToSheet(cfg: Config['notify'], row: BookingSheetRow, attempt = 1) {
  if (!sheetsConfigured(cfg)) return;
  inBackground(`sheet row ${row.ref}`, () =>
    upsertBookingRow(cfg, row).catch((e) => {
      console.error(`[sheets] booking ${row.ref} sync attempt ${attempt} failed:`, (e as Error).message);
      if (attempt < 2) setTimeout(() => syncBookingToSheet(cfg, row, attempt + 1), 30_000).unref();
    }),
  );
}
