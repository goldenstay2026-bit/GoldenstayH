// POST /api/enquiry — website enquiry form → a saved request (admin "Requests"
// tab) + Telegram message + Google Sheet row.
//
// Guests don't create a booking here. The request is refused (409) if its
// dates are already booked; otherwise it is saved, then the owner is notified
// on every configured channel in parallel (Promise.allSettled). Notification
// failures never fail the guest's request — it is already in the admin.

import type { Request, Response } from 'express';
import { formatPaise, isRoomId } from '../shared/catalog.ts';
import {
  BOOKING_TYPE_MESSAGE,
  BOOKING_TYPE_OPTION,
  ENQUIRY_BOOKING_TYPES,
  GROUP_MAX_GUESTS,
  isGroupBooking,
  type EnquiryBookingType,
  ENQUIRY_MAX_ADVANCE_DAYS as MAX_ADVANCE_DAYS,
  ENQUIRY_MAX_NIGHTS as MAX_ENQUIRY_NIGHTS,
  HONEYPOT_FIELD,
  formatIndianMobile,
  formatISODate,
  MAX_GUESTS,
  MIN_GUESTS,
  nightsBetween,
  normaliseIndianMobile,
  parseISODate,
  todayInIndia,
} from '../shared/validate.ts';
import { getRoom, type BookingRow, type Ctx } from './bookings.ts';
import { submitRequest, type RequestOption } from './calendar.ts';
import { inBackground } from './background.ts';
import { HttpError } from './http.ts';
import { appendToSheet, sheetsConfigured } from './notify/sheets.ts';
import { escapeHtml, sendTelegram, telegramConfigured } from './notify/telegram.ts';
import { formatIST } from './notify/time.ts';

const LIMITS = { name: 80, message: 1000 };

export type Enquiry = {
  bookingType: EnquiryBookingType;
  /** Group bookings only; '' when not given. */
  occasion: string;
  name: string;
  /** 10-digit Indian mobile number */
  phone: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /** Human-readable room choice, e.g. "AC 1BHK — ₹1,599/night" or "Any available room" */
  room: string;
  /** What the request would occupy: a room, "any" room, or the entire homestay (group bookings). */
  option: RequestOption;
  message: string;
  receivedAt: Date;
};

/** Trims, collapses whitespace, strips control characters and caps length. */
function clean(v: unknown, max: number, multiline = false): string {
  if (typeof v !== 'string') return '';
  let s = v.normalize('NFC').replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

/** Validates the request body. Throws HttpError(400) with a user-safe message on the first problem. */
export function parseEnquiry(ctx: Ctx, body: Record<string, unknown>): Enquiry {
  const bad = (field: string, msg: string) => new HttpError(400, msg, 'INVALID_INPUT', field);

  const name = clean(body.name, LIMITS.name);
  if (name.length < 2) throw bad('name', 'Please enter your full name.');

  const phone = normaliseIndianMobile(clean(body.phone, 20));
  if (!phone) throw bad('phone', 'Enter a 10-digit Indian mobile number, e.g. +91 98765 43210.');

  const checkIn = clean(body.checkIn, 10);
  const checkOut = clean(body.checkOut, 10);
  const today = todayInIndia(ctx.now());
  if (parseISODate(checkIn) === null) throw bad('checkIn', 'Please choose a check-in date.');
  if (checkIn < today) throw bad('checkIn', 'Check-in can’t be in the past.');
  if (nightsBetween(today, checkIn) > MAX_ADVANCE_DAYS) throw bad('checkIn', 'Please choose a check-in date within the next two years.');
  if (parseISODate(checkOut) === null) throw bad('checkOut', 'Please choose a check-out date.');
  if (checkOut <= checkIn) throw bad('checkOut', 'Check-out must be after check-in.');
  const nights = nightsBetween(checkIn, checkOut);
  if (nights > MAX_ENQUIRY_NIGHTS) throw bad('checkOut', `For stays longer than ${MAX_ENQUIRY_NIGHTS} nights, please call us.`);

  const typeRaw = clean(body.bookingType, 20) || 'room';
  if (!ENQUIRY_BOOKING_TYPES.includes(typeRaw as EnquiryBookingType)) throw bad('bookingType', 'Please choose a booking type.');
  const bookingType = typeRaw as EnquiryBookingType;
  const group = isGroupBooking(bookingType);

  const maxGuests = group ? GROUP_MAX_GUESTS : MAX_GUESTS;
  const guests = Number(body.guests);
  if (!Number.isInteger(guests) || guests < MIN_GUESTS || guests > maxGuests) {
    throw bad('guests', `Choose between ${MIN_GUESTS} and ${maxGuests} guests.`);
  }

  // Room: one of the rooms, or "any" (room stays only). Label uses the live price from the database.
  let room: string;
  let option: RequestOption;
  if (group) {
    room = BOOKING_TYPE_OPTION[bookingType];
    option = 'entire';
  } else {
    const roomId = clean(body.room, 20);
    option = roomId === 'any' || isRoomId(roomId) ? roomId : 'any';
    if (roomId === 'any') room = 'Any available room';
    else if (isRoomId(roomId)) {
      const r = getRoom(ctx, roomId)!;
      room = `${r.name} — ${formatPaise(r.price_paise)}/night`;
    } else throw bad('room', 'Please choose a room.');
  }

  const occasion = group ? clean(body.occasion, 80) : '';
  const message = clean(body.message, LIMITS.message, true);
  return { bookingType, occasion, name, phone, checkIn, checkOut, nights, guests, room, option, message, receivedAt: ctx.now() };
}

export { formatIST };

/** Telegram HTML message. Every user-supplied value is escaped. */
export function telegramMessage(e: Enquiry, opts: { phoneAsLink: boolean; adminUrl?: string }) {
  const phone = escapeHtml(formatIndianMobile(e.phone));
  const phoneHtml = opts.phoneAsLink ? `<a href="tel:+91${e.phone}">${phone}</a>` : phone;
  const group = isGroupBooking(e.bookingType);
  const lines = [
    group ? '🏡 <b>New Entire-Homestay Enquiry – Golden Stay</b>' : '🏠 <b>New Enquiry – Golden Stay</b>',
    '',
    ...(group ? [`📋 <b>Booking type:</b> ${escapeHtml(BOOKING_TYPE_MESSAGE[e.bookingType])}`] : []),
    `👤 <b>Name:</b> ${escapeHtml(e.name)}`,
    `📞 <b>Phone:</b> ${phoneHtml}`,
    `📅 <b>Dates:</b> ${formatISODate(e.checkIn)} → ${formatISODate(e.checkOut)} (${e.nights} ${e.nights === 1 ? 'night' : 'nights'})`,
    group ? `👥 <b>Approx. guests:</b> ${e.guests}` : `👥 <b>Guests:</b> ${e.guests}`,
    group ? `🎉 <b>Occasion:</b> ${e.occasion ? escapeHtml(e.occasion) : '—'}` : `🛏 <b>Room:</b> ${escapeHtml(e.room)}`,
    `💬 <b>Message:</b> ${e.message ? escapeHtml(e.message) : '—'}`,
    `🕒 <b>Received:</b> ${formatIST(e.receivedAt)}`,
    ...(opts.adminUrl ? ['', `Open admin: ${escapeHtml(opts.adminUrl)}`] : []),
  ];
  return lines.join('\n');
}

export type Delivery = { telegram: boolean; sheets: boolean };

/** Sends to every configured channel in parallel. Logs failures; never throws. */
export async function deliverEnquiry(ctx: Ctx, e: Enquiry): Promise<Delivery> {
  const cfg = ctx.config.notify;
  const adminUrl = `${ctx.config.siteUrl.replace(/\/$/, '')}/admin`;
  const [tg, sh] = await Promise.allSettled([
    sendTelegram(cfg, ctx.config.nodeEnv, {
      html: telegramMessage(e, { phoneAsLink: true, adminUrl }),
      fallbackHtml: telegramMessage(e, { phoneAsLink: false, adminUrl }),
      buttons: [{ text: '💬 WhatsApp guest', url: `https://wa.me/91${e.phone}` }],
    }),
    appendToSheet(cfg, {
      name: e.name,
      phone: formatIndianMobile(e.phone),
      checkIn: e.checkIn,
      checkOut: e.checkOut,
      nights: e.nights,
      guests: e.guests,
      // Group enquiries: the Room column says "Entire homestay" / "Party / event …".
      room: e.room,
      message: e.occasion ? `Occasion: ${e.occasion}${e.message ? ` · ${e.message}` : ''}` : e.message,
    }),
  ]);
  if (tg.status === 'rejected') console.error('[enquiry] Telegram failed:', (tg.reason as Error).message);
  if (sh.status === 'rejected') console.error('[enquiry] Google Sheets failed:', (sh.reason as Error).message);
  return { telegram: tg.status === 'fulfilled', sheets: sh.status === 'fulfilled' };
}

export async function handleEnquiry(ctx: Ctx, req: Request, res: Response) {
  if (!req.is('application/json')) throw new HttpError(400, 'Send the enquiry as JSON.', 'BAD_CONTENT_TYPE');
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Honeypot filled → almost certainly a bot. Pretend success so it learns nothing.
  if (typeof body[HONEYPOT_FIELD] === 'string' && body[HONEYPOT_FIELD].trim() !== '') {
    console.warn(`[enquiry] honeypot triggered from ${req.ip}; ignored`);
    res.json({ ok: true });
    return;
  }

  const enquiry = parseEnquiry(ctx, body);
  // Saved first: throws 409 DATES_TAKEN if any of these nights is already booked.
  const request = submitRequest(ctx, {
    bookingType: enquiry.bookingType,
    option: enquiry.option,
    checkIn: enquiry.checkIn,
    checkOut: enquiry.checkOut,
    nights: enquiry.nights,
    guests: enquiry.guests,
    name: enquiry.name,
    phone: enquiry.phone,
    occasion: enquiry.occasion,
    message: enquiry.message,
  });
  const cfg = ctx.config.notify;
  if (!telegramConfigured(cfg) && !sheetsConfigured(cfg)) {
    console.warn('[enquiry] No notification channel configured — the request is only in the admin. Set TELEGRAM_* and/or SHEETS_* in .env');
  }
  const delivered = await deliverEnquiry(ctx, enquiry);
  res.json({ ok: true, requestId: request.id, notified: delivered.telegram || delivered.sheets });
}

/**
 * Telegram alert when a guest submits a QR payment reference, so the owner
 * can verify it promptly in the admin. Fire-and-forget: never blocks or
 * fails the guest's request.
 */
export function alertQrSubmitted(ctx: Ctx, b: BookingRow, utr: string | null) {
  if (!telegramConfigured(ctx.config.notify)) return;
  const html = [
    '💳 <b>QR payment to verify – Golden Stay</b>',
    '',
    `🧾 <b>Booking:</b> ${escapeHtml(b.ref)}`,
    `👤 <b>Guest:</b> ${escapeHtml(b.guest_name)} · ${escapeHtml(formatIndianMobile(b.guest_phone))}`,
    `🛏 <b>Room:</b> ${escapeHtml(b.room_name)}`,
    `📅 <b>Dates:</b> ${formatISODate(b.check_in)} → ${formatISODate(b.check_out)} (${b.nights} ${b.nights === 1 ? 'night' : 'nights'})`,
    `💰 <b>Amount:</b> ${formatPaise(b.pay_now_paise)}`,
    `🔢 <b>UTR:</b> ${utr ? `<code>${escapeHtml(utr)}</code>` : 'not given (look for the booking ID in the payment note)'}`,
    '',
    'Check the amount in the PhonePe Business app, then confirm from the email or the admin.',
  ].join('\n');
  inBackground('QR Telegram alert', () => sendTelegram(ctx.config.notify, ctx.config.nodeEnv, {
    html,
    // Telegram only accepts public URLs in buttons, so skip it for localhost.
    buttons: ctx.config.siteUrl.startsWith('https://') ? [{ text: 'Open admin', url: `${ctx.config.siteUrl}/admin/` }] : undefined,
  }));
}
