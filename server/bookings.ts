import crypto from 'node:crypto';
import type { OptionId, RoomId, Unit } from '../shared/catalog.ts';
// RoomId: online-bookable rooms; OptionId adds 'entire' (owner bookings only).
import { formatPaise, isRoomId } from '../shared/catalog.ts';
import type { BookingStatus, BookingView, PaymentStatus, PriceLine, PublicRoom, Quote } from '../shared/types.ts';
import {
  MAX_GUESTS,
  MIN_GUESTS,
  checkStayDates,
  isValidEmail,
  nightsBetween,
  normaliseIndianMobile,
  stayNights,
  todayInIndia,
} from '../shared/validate.ts';
import { inBackground } from './background.ts';
import { markChanged } from './changes.ts';
import type { Config } from './config.ts';
import { ConflictError, type Store } from './db.ts';
import type { FirebaseServices } from './firebase.ts';
import { bookingSheetRow, syncBookingToSheet } from './notify/bookingSheet.ts';
import { sheetsConfigured } from './notify/sheets.ts';
import { HttpError } from './http.ts';
import type { PhonePeClient } from './phonepe.ts';

export type Ctx = {
  db: Store;
  config: Config;
  phonepe: PhonePeClient | null;
  now: () => Date;
  /** Firebase (guest sign-in + Firestore copies). null = sign-in not configured. */
  firebase?: FirebaseServices | null;
};

export type RoomRow = { id: OptionId; name: string; price_paise: number; units: string; bookable: number };

export type BookingRow = {
  id: number;
  ref: string;
  token_hash: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  needs_attention: string | null;
  /** Room, or 'entire' for owner bookings of the whole homestay. */
  room_id: OptionId;
  room_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  nightly_paise: number;
  lines_json: string;
  total_paise: number;
  pay_now_paise: number;
  guest_name: string;
  guest_phone: string;
  guest_email: string;
  guest_message: string;
  hold_expires_at: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  /** Firebase Auth uid of the guest who booked (null for owner-entered bookings). */
  user_uid: string | null;
  /** booking | block (owner-blocked dates) */
  kind: 'booking' | 'block';
  /** website_online | website_request | phone | whatsapp | walk_in | other | block */
  source: string;
  occasion: string;
  notes: string;
  request_id: number | null;
};

export type PaymentRow = {
  id: number;
  booking_id: number;
  method: 'gateway' | 'qr';
  state: string;
  amount_paise: number;
  merchant_order_id: string | null;
  gateway_order_id: string | null;
  gateway_transaction_id: string | null;
  gateway_payment_mode: string | null;
  gateway_error_code: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  utr: string | null;
  last_response_json: string | null;
  created_at: string;
  updated_at: string;
};

export type RefundRow = {
  id: number;
  payment_id: number;
  booking_id: number;
  method: 'gateway' | 'manual';
  merchant_refund_id: string;
  gateway_refund_id: string | null;
  amount_paise: number;
  state: 'pending' | 'completed' | 'failed';
  note: string;
  created_at: string;
  updated_at: string;
};

export const iso = (ctx: Ctx) => ctx.now().toISOString();
export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// ---------- audit ----------

export async function audit(ctx: Ctx, actor: string, action: string, bookingId: number | null, details: Record<string, unknown> = {}) {
  // The booking's public ID is stored too, so the audit list needs no extra lookups.
  const ref = bookingId ? ((await getBookingById(ctx, bookingId))?.ref ?? null) : null;
  await ctx.db.insert('audit_log', { at: iso(ctx), actor, action, booking_id: bookingId, booking_ref: ref, details: JSON.stringify(details) });
}

// ---------- rooms & pricing ----------

export function getRoom(ctx: Ctx, id: string): Promise<RoomRow | undefined> {
  return ctx.db.get<RoomRow>('rooms', id);
}

export async function listRooms(ctx: Ctx): Promise<PublicRoom[]> {
  const rows = (await ctx.db.query<RoomRow>('rooms', { orderBy: [['price_paise']] })).filter((r) => isRoomId(r.id));
  return rows.map((r) => ({ id: r.id as RoomId, name: r.name, pricePaise: r.price_paise, bookable: r.bookable === 1 }));
}

export const roomUnits = (room: RoomRow) => JSON.parse(room.units) as Unit[];

/**
 * Price breakdown. Policy (owner-approved): published nightly prices are
 * final — no taxes or fees are added, and the full amount is paid online.
 * Add tax/fee lines here if that ever changes; the total is always
 * recomputed on the server.
 */
function priceLines(room: RoomRow, nights: number): { lines: PriceLine[]; total: number; payNow: number } {
  const roomCharges = room.price_paise * nights;
  const lines: PriceLine[] = [
    { label: `${room.name} · ${formatPaise(room.price_paise)} × ${nights} ${nights === 1 ? 'night' : 'nights'}`, amountPaise: roomCharges },
  ];
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  return { lines, total, payNow: total };
}

// ---------- room-nights ----------

/**
 * One document per physical unit per night held: booking_nights/{unit}_{night}.
 * Creating it fails if it already exists — that is what makes double booking
 * impossible, even when two guests press Book at the same moment.
 */
export const nightId = (unit: Unit, night: string) => `${unit}_${night}`;

/** Is any of these units already held on any of these nights? */
async function unitsTaken(ctx: Ctx, units: Unit[], nights: string[]): Promise<boolean> {
  if (nights.length === 0) return false;
  const found = await ctx.db.getMany('booking_nights', nights.flatMap((n) => units.map((u) => nightId(u, n))));
  return found.size > 0;
}

type StayInput = { roomId: unknown; checkIn: unknown; checkOut: unknown; guests: unknown };

async function parseStay(ctx: Ctx, input: StayInput) {
  if (!isRoomId(input.roomId)) throw new HttpError(400, 'Please choose a room.', 'INVALID_ROOM', 'roomId');
  const room = await getRoom(ctx, input.roomId);
  if (!room || room.bookable !== 1) throw new HttpError(400, 'This room can’t be booked online right now.', 'ROOM_UNAVAILABLE', 'roomId');
  const checkIn = String(input.checkIn ?? '');
  const checkOut = String(input.checkOut ?? '');
  const dateErr = checkStayDates(checkIn, checkOut, todayInIndia(ctx.now()));
  if (dateErr) throw new HttpError(400, dateErr, 'INVALID_DATES', 'checkIn');
  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < MIN_GUESTS || guests > MAX_GUESTS) {
    throw new HttpError(400, `Guests must be between ${MIN_GUESTS} and ${MAX_GUESTS}.`, 'INVALID_GUESTS', 'guests');
  }
  return { room, checkIn, checkOut, guests, nights: nightsBetween(checkIn, checkOut) };
}

export async function quote(ctx: Ctx, input: StayInput): Promise<Quote> {
  await sweepExpiredHolds(ctx);
  const s = await parseStay(ctx, input);
  const p = priceLines(s.room, s.nights);
  return {
    roomId: s.room.id as RoomId,
    roomName: s.room.name,
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    nights: s.nights,
    guests: s.guests,
    nightlyPaise: s.room.price_paise,
    lines: p.lines,
    totalPaise: p.total,
    payNowPaise: p.payNow,
    available: !(await unitsTaken(ctx, roomUnits(s.room), stayNights(s.checkIn, s.checkOut))),
  };
}

// ---------- booking creation ----------

const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRef(): string {
  const bytes = crypto.randomBytes(6);
  return 'GS' + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

/** A booking ID nobody has yet. */
export async function uniqueRef(ctx: Ctx): Promise<string> {
  let ref = newRef();
  while (await getBookingByRef(ctx, ref)) ref = newRef();
  return ref;
}

/** Holds a booking's nights; throws HttpError 409 if any unit-night is taken (then none are held). */
export async function holdNights(ctx: Ctx, bookingId: number, units: Unit[], checkIn: string, checkOut: string) {
  try {
    await ctx.db.tx(async () => {
      for (const night of stayNights(checkIn, checkOut)) {
        for (const unit of units) await ctx.db.create('booking_nights', nightId(unit, night), { booking_id: bookingId, unit, night });
      }
    });
  } catch (e) {
    if (e instanceof ConflictError) {
      throw new HttpError(409, 'Sorry — this room is no longer available for those dates. Please choose other dates.', 'NOT_AVAILABLE');
    }
    throw e;
  }
}

export function heldNights(ctx: Ctx, bookingId: number) {
  return ctx.db.query<{ booking_id: number; unit: Unit; night: string }>('booking_nights', { where: [['booking_id', '==', bookingId]] });
}

export async function releaseNights(ctx: Ctx, bookingId: number) {
  for (const n of await heldNights(ctx, bookingId)) await ctx.db.delete('booking_nights', nightId(n.unit, n.night));
}

/** Re-acquires nights for a booking whose hold had been released (e.g. paid after expiry). Returns false if taken. */
export async function tryReacquireNights(ctx: Ctx, booking: BookingRow): Promise<boolean> {
  if ((await heldNights(ctx, booking.id)).length > 0) return true;
  const room = await getRoom(ctx, booking.room_id);
  if (!room) return false;
  try {
    await holdNights(ctx, booking.id, roomUnits(room), booking.check_in, booking.check_out);
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return false;
    throw e;
  }
}

export type CreateBookingInput = StayInput & { name: unknown; phone: unknown; email: unknown; message?: unknown };

export async function createBooking(ctx: Ctx, input: CreateBookingInput, userUid: string | null = null): Promise<{ booking: BookingRow; token: string }> {
  await sweepExpiredHolds(ctx);
  const s = await parseStay(ctx, input);

  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Please enter your full name.', 'INVALID_NAME', 'name');
  const phone = normaliseIndianMobile(String(input.phone ?? ''));
  if (!phone) throw new HttpError(400, 'Enter a 10-digit Indian mobile number.', 'INVALID_PHONE', 'phone');
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email address.', 'INVALID_EMAIL', 'email');
  const message = String(input.message ?? '').trim().slice(0, 500);

  // Amount comes ONLY from the database price — anything the client sends is ignored.
  const p = priceLines(s.room, s.nights);
  const token = crypto.randomBytes(24).toString('base64url');
  const now = iso(ctx);
  const holdExpires = new Date(ctx.now().getTime() + ctx.config.holdMinutes * 60_000).toISOString();

  const booking = await ctx.db.tx(async () => {
    const ref = await uniqueRef(ctx);
    const row: Omit<BookingRow, 'id'> = {
      ref,
      token_hash: sha256(token),
      status: 'pending_payment',
      payment_status: 'pending',
      needs_attention: null,
      room_id: s.room.id,
      room_name: s.room.name,
      check_in: s.checkIn,
      check_out: s.checkOut,
      nights: s.nights,
      guests: s.guests,
      nightly_paise: s.room.price_paise,
      lines_json: JSON.stringify(p.lines),
      total_paise: p.total,
      pay_now_paise: p.payNow,
      guest_name: name,
      guest_phone: phone,
      guest_email: email,
      guest_message: message,
      hold_expires_at: holdExpires,
      created_at: now,
      updated_at: now,
      confirmed_at: null,
      user_uid: userUid,
      kind: 'booking',
      source: 'website_online',
      occasion: '',
      notes: '',
      request_id: null,
    };
    const id = Number(await ctx.db.insert('bookings', row));
    await holdNights(ctx, id, roomUnits(s.room), s.checkIn, s.checkOut);
    await audit(ctx, 'guest', 'booking.created', id, { ref, room: s.room.id, checkIn: s.checkIn, checkOut: s.checkOut, totalPaise: p.total, userUid });
    queueBookingSync(ctx, id);
    return (await getBookingById(ctx, id))!;
  });
  return { booking, token };
}

// ---------- lookup ----------

export function getBookingById(ctx: Ctx, id: number): Promise<BookingRow | undefined> {
  return ctx.db.get<BookingRow>('bookings', id);
}

export async function getBookingByRef(ctx: Ctx, ref: string): Promise<BookingRow | undefined> {
  return (await ctx.db.query<BookingRow>('bookings', { where: [['ref', '==', String(ref).toUpperCase()]] }))[0];
}

/**
 * Guest access: either the private token from their booking link, or being
 * signed in as the Firebase user who made the booking. Constant-time compare.
 */
export async function getBookingForGuest(ctx: Ctx, ref: string, token: string | undefined, uid?: string | null): Promise<BookingRow> {
  const b = await getBookingByRef(ctx, ref);
  const tokenOk =
    b !== undefined &&
    typeof token === 'string' &&
    token.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(b.token_hash));
  const ok = tokenOk || (b !== undefined && typeof uid === 'string' && uid !== '' && b.user_uid === uid);
  if (!ok) throw new HttpError(404, 'Booking not found. Please use the link from your booking.', 'NOT_FOUND');
  return b!;
}

export function paymentsFor(ctx: Ctx, bookingId: number): Promise<PaymentRow[]> {
  return ctx.db.query<PaymentRow>('payments', { where: [['booking_id', '==', bookingId]], orderBy: [['id']] });
}

export function refundsFor(ctx: Ctx, bookingId: number): Promise<RefundRow[]> {
  return ctx.db.query<RefundRow>('refunds', { where: [['booking_id', '==', bookingId]], orderBy: [['id']] });
}

export async function amountPaid(ctx: Ctx, bookingId: number): Promise<number> {
  const paid = (await paymentsFor(ctx, bookingId))
    .filter((p) => p.state === 'completed' || p.state === 'verified')
    .reduce((s, p) => s + p.amount_paise, 0);
  const refunded = (await refundsFor(ctx, bookingId)).filter((r) => r.state === 'completed').reduce((s, r) => s + r.amount_paise, 0);
  return paid - refunded;
}

export async function toView(ctx: Ctx, b: BookingRow): Promise<BookingView> {
  const pays = await paymentsFor(ctx, b.id);
  const last = pays.at(-1);
  return {
    ref: b.ref,
    status: b.status,
    paymentStatus: b.payment_status,
    roomId: b.room_id,
    roomName: b.room_name,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: b.nights,
    guests: b.guests,
    guestName: b.guest_name,
    lines: JSON.parse(b.lines_json) as PriceLine[],
    totalPaise: b.total_paise,
    payNowPaise: b.pay_now_paise,
    amountPaidPaise: await amountPaid(ctx, b.id),
    holdExpiresAt: b.hold_expires_at,
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    lastPayment: last
      ? {
          method: last.method,
          state: last.state,
          reference: last.method === 'qr' ? last.utr : last.gateway_transaction_id,
          updatedAt: last.updated_at,
        }
      : null,
  };
}

// ---------- status changes ----------

export async function setBooking(
  ctx: Ctx,
  id: number,
  fields: Partial<Pick<BookingRow, 'status' | 'payment_status' | 'needs_attention' | 'hold_expires_at' | 'confirmed_at'>>,
) {
  if (Object.keys(fields).length === 0) return;
  await ctx.db.update('bookings', id, { ...fields, updated_at: iso(ctx) });
  queueBookingSync(ctx, id);
}

// ---------- copies of the booking elsewhere: guest's Firestore copy + owner's Google Sheet ----------

const syncQueued = new WeakMap<Store, Set<number>>();

/**
 * After the current transaction commits, pushes this booking's latest state
 * to (a) the guest's Firestore copy users/{uid}/bookings/{ref} and (b) the
 * owner's Google Sheet "Bookings" tab. Several changes in one request sync
 * once. Best effort: the bookings collection is the source of truth, so
 * failures are only logged.
 */
export function queueBookingSync(ctx: Ctx, bookingId: number) {
  // Open admin screens refresh after the change commits.
  ctx.db.onCommit(() => markChanged(ctx, 'bookings'));
  const toFirestore = Boolean(ctx.firebase?.mirrorBooking);
  const toSheet = sheetsConfigured(ctx.config.notify);
  if (!toFirestore && !toSheet) return;
  const set = syncQueued.get(ctx.db) ?? new Set<number>();
  if (set.has(bookingId)) return;
  set.add(bookingId);
  syncQueued.set(ctx.db, set);
  ctx.db.onCommit(() =>
    inBackground(`sync booking ${bookingId}`, async () => {
      set.delete(bookingId);
      const b = await getBookingById(ctx, bookingId);
      if (!b) return;
      if (toSheet) syncBookingToSheet(ctx.config.notify, bookingSheetRow(b, await paymentsFor(ctx, b.id), await amountPaid(ctx, b.id)));
      if (!b.user_uid || !ctx.firebase?.mirrorBooking) return;
      const v = await toView(ctx, b);
      await ctx.firebase
        .mirrorBooking(b.user_uid, b.ref, {
          ref: v.ref,
          status: v.status,
          paymentStatus: v.paymentStatus,
          roomId: v.roomId,
          roomName: v.roomName,
          checkIn: v.checkIn,
          checkOut: v.checkOut,
          nights: v.nights,
          guests: v.guests,
          totalPaise: v.totalPaise,
          amountPaidPaise: v.amountPaidPaise,
          createdAt: v.createdAt,
          confirmedAt: v.confirmedAt,
          updatedAt: b.updated_at,
        })
        .catch((e) => console.error(`[firebase] booking copy failed for ${b.ref}:`, (e as Error).message));
    }),
  );
}

const lastSweep = new WeakMap<Store, number>();

/**
 * Expires unpaid holds whose time is up, releasing their nights. A late
 * gateway payment on an expired booking is still honoured by
 * reconcileGatewayPayment (re-acquiring the nights, or flagging for refund).
 *
 * Serverless hosting has no always-on timer, so this runs whenever
 * availability matters (quotes, bookings, calendars). It is skipped when it
 * ran in the last 15 seconds (by the server clock), to save database reads.
 */
export async function sweepExpiredHolds(ctx: Ctx, force = false) {
  const nowMs = ctx.now().getTime();
  const last = lastSweep.get(ctx.db);
  if (!force && last !== undefined && Math.abs(nowMs - last) < 15_000) return 0;
  lastSweep.set(ctx.db, nowMs);
  const now = iso(ctx);
  const stale = (await ctx.db.query<BookingRow>('bookings', { where: [['status', '==', 'pending_payment']] })).filter(
    (b) => b.hold_expires_at !== null && b.hold_expires_at < now,
  );
  for (const b of stale) {
    await ctx.db.tx(async () => {
      const cur = await getBookingById(ctx, b.id);
      if (cur?.status !== 'pending_payment') return; // paid or cancelled meanwhile
      await releaseNights(ctx, b.id);
      await setBooking(ctx, b.id, { status: 'expired', hold_expires_at: null });
      await audit(ctx, 'system', 'booking.expired', b.id, { holdExpiredAt: b.hold_expires_at });
    });
  }
  return stale.length;
}
