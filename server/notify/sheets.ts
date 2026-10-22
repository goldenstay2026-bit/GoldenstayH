// Appends an enquiry to the owner's Google Sheet through a Google Apps Script
// web app (scripts/google-apps-script.gs). The shared secret proves the call
// came from this server; the script rejects anything else.

import type { Config } from '../config.ts';

type SheetsCfg = Config['notify'];

export type SheetRow = {
  name: string;
  phone: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  room: string;
  message: string;
};

export const sheetsConfigured = (cfg: SheetsCfg) => Boolean(cfg.sheetsWebhookUrl && cfg.sheetsSecret);

/** POSTs a JSON action to the Apps Script web app and checks its { ok } reply. */
async function postToAppsScript(cfg: SheetsCfg, payload: Record<string, unknown>): Promise<void> {
  if (!sheetsConfigured(cfg)) throw new Error('Google Apps Script is not configured (SHEETS_WEBHOOK_URL / SHEETS_SECRET)');
  // Apps Script answers POSTs with a 302 to a googleusercontent.com URL that
  // serves the script's output; fetch follows it (as a GET), which is expected.
  const res = await fetch(cfg.sheetsWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: cfg.sheetsSecret, ...payload }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: { ok?: boolean; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON usually means the web app isn't deployed with "Anyone" access (Google returns a sign-in page).
    throw new Error(`Google Apps Script returned non-JSON (HTTP ${res.status}) — check the web app deployment access`);
  }
  if (!res.ok || json.ok !== true) throw new Error(`Google Apps Script failed: ${json.error ?? `HTTP ${res.status}`}`);
}

/** Appends a website enquiry to the "Enquiries" sheet. */
export const appendToSheet = (cfg: SheetsCfg, row: SheetRow) => postToAppsScript(cfg, { action: 'enquiry', ...row });

export type ConfirmationEmail = {
  /** Plain values (used for the email and in tests). */
  booking: {
    ref: string;
    guestName: string;
    guestPhone: string;
    guestEmail: string;
    room: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    guests: number;
    amountPaid: string;
    method: string;
    reference: string;
    confirmedAt: string;
  };
  subject: string;
  text: string;
  html: string;
};

/**
 * Emails the owner that a booking is confirmed. The Apps Script sends only to
 * the fixed owner address set in the script (goldenstay2026@gmail.com), so
 * this endpoint can't be used to email anyone else.
 */
export const sendConfirmationEmail = (cfg: SheetsCfg, email: ConfirmationEmail) =>
  postToAppsScript(cfg, { action: 'booking_confirmed', ...email });

/** One row of the "Bookings" tab (all values already formatted for people). */
export type BookingSheetRow = {
  ref: string;
  status: string;
  payment: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  room: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: string;
  paid: string;
  method: string;
  reference: string;
  bookedAt: string;
  updatedAt: string;
  needsAttention: string;
  message: string;
  /** ISO timestamp of the booking's last change; newer versions win. */
  version: string;
};

/** Adds the booking to the "Bookings" tab, or updates its existing row (matched by Booking ID). */
export const upsertBookingRow = (cfg: SheetsCfg, row: BookingSheetRow) => postToAppsScript(cfg, { action: 'booking_upsert', booking: row });

/**
 * Any email to the owner (e.g. "payment to verify"). Uses the script's
 * "booking_confirmed" action, which delivers the given subject/text/html to the
 * fixed OWNER_EMAIL — so no script change or redeploy is needed.
 */
export const sendOwnerEmail = (cfg: SheetsCfg, email: { subject: string; text: string; html: string }) =>
  postToAppsScript(cfg, { action: 'booking_confirmed', ...email });

/** Email to a guest about their online booking (Apps Script "guest_email"; replies go to the owner). */
export const sendGuestEmail = (cfg: SheetsCfg, email: { to: string; subject: string; text: string; html: string }) =>
  postToAppsScript(cfg, { action: 'guest_email', ...email });
