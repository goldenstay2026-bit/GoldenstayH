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
import type { Config } from './config.ts';
import { onCommit, tx, type DB } from './db.ts';
import type { FirebaseServices } from './firebase.ts';
import { bookingSheetRow, syncBookingToSheet } from './notify/bookingSheet.ts';
import { sheetsConfigured } from './notify/sheets.ts';
import { emitChange } from './events.ts';
import { HttpError } from './http.ts';
import type { PhonePeClient } from './phonepe.ts';

export type Ctx = {
  db: DB;
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
  /** Firebase Auth uid of the guest who booked (null for bookings made before sign-in existed). */
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

export const iso = (ctx: Ctx) => ctx.now().toISOString();
export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// ---------- audit ----------

export function audit(ctx: Ctx, actor: string, action: string, bookingId: number | null, details: Record<string, unknown> = {}) {
  ctx.db
    .prepare('INSERT INTO audit_log (at, actor, action, booking_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(iso(ctx), actor, action, bookingId, JSON.stringify(details));
}

// ---------- rooms & pricing ----------

export function getRoom(ctx: Ctx, id: string): RoomRow | undefined {
  return ctx.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
}

export function listRooms(ctx: Ctx): PublicRoom[] {
  const rows = (ctx.db.prepare('SELECT * FROM rooms ORDER BY price_paise').all() as RoomRow[]).filter((r) => isRoomId(r.id));
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

/** Which units are already held on any of the given nights. */
function unitsTaken(ctx: Ctx, units: Unit[], nights: string[]): boolean {
  if (nights.length === 0) return false;
  const q = ctx.db.prepare(
    `SELECT 1 FROM booking_nights WHERE unit IN (${units.map(() => '?').join(',')})
     AND night IN (${nights.map(() => '?').join(',')}) LIMIT 1`,
  );
  return q.get(...units, ...nights) !== undefined;
}

type StayInput = { roomId: unknown; checkIn: unknown; checkOut: unknown; guests: unknown };

function parseStay(ctx: Ctx, input: StayInput) {
  if (!isRoomId(input.roomId)) throw new HttpError(400, 'Please choose a room.', 'INVALID_ROOM', 'roomId');
  const room = getRoom(ctx, input.roomId);
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

export function quote(ctx: Ctx, input: StayInput): Quote {
  sweepExpiredHolds(ctx);
  const s = parseStay(ctx, input);
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
    available: !unitsTaken(ctx, roomUnits(s.room), stayNights(s.checkIn, s.checkOut)),
  };
}

// ---------- booking creation ----------

const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRef(): string {
  const bytes = crypto.randomBytes(6);
  return 'GS' + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

/** Inserts night holds for a booking; throws HttpError 409 if any unit-night is taken. */
export function holdNights(ctx: Ctx, bookingId: number, units: Unit[], checkIn: string, checkOut: string) {
  const ins = ctx.db.prepare('INSERT INTO booking_nights (booking_id, unit, night) VALUES (?, ?, ?)');
  try {
    for (const night of stayNights(checkIn, checkOut)) for (const u of units) ins.run(bookingId, u, night);
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) {
      throw new HttpError(409, 'Sorry — this room is no longer available for those dates. Please choose other dates.', 'NOT_AVAILABLE');
    }
    throw e;
  }
}

export function releaseNights(ctx: Ctx, bookingId: number) {
  ctx.db.prepare('DELETE FROM booking_nights WHERE booking_id = ?').run(bookingId);
}

/** Re-acquires nights for a booking whose hold had been released (e.g. paid after expiry). Returns false if taken. */
export function tryReacquireNights(ctx: Ctx, booking: BookingRow): boolean {
  const held = ctx.db.prepare('SELECT COUNT(*) AS n FROM booking_nights WHERE booking_id = ?').get(booking.id) as { n: number };
  if (held.n > 0) return true;
  const room = getRoom(ctx, booking.room_id);
  if (!room) return false;
  try {
    holdNights(ctx, booking.id, roomUnits(room), booking.check_in, booking.check_out);
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return false;
    throw e;
  }
}

export type CreateBookingInput = StayInput & { name: unknown; phone: unknown; email: unknown; message?: unknown };

export function createBooking(ctx: Ctx, input: CreateBookingInput, userUid: string | null = null): { booking: BookingRow; token: string } {
  sweepExpiredHolds(ctx);
  const s = parseStay(ctx, input);

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

  const booking = tx(ctx.db, () => {
    let ref = newRef();
    while (ctx.db.prepare('SELECT 1 FROM bookings WHERE ref = ?').get(ref)) ref = newRef();
    const r = ctx.db
      .prepare(
        `INSERT INTO bookings (ref, token_hash, status, payment_status, room_id, room_name, check_in, check_out, nights, guests,
           nightly_paise, lines_json, total_paise, pay_now_paise, guest_name, guest_phone, guest_email, guest_message,
           hold_expires_at, created_at, updated_at, user_uid)
         VALUES (?, ?, 'pending_payment', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ref, sha256(token), s.room.id, s.room.name, s.checkIn, s.checkOut, s.nights, s.guests,
        s.room.price_paise, JSON.stringify(p.lines), p.total, p.payNow, name, phone, email, message,
        holdExpires, now, now, userUid,
      );
    const id = Number(r.lastInsertRowid);
    holdNights(ctx, id, roomUnits(s.room), s.checkIn, s.checkOut);
    audit(ctx, 'guest', 'booking.created', id, { ref, room: s.room.id, checkIn: s.checkIn, checkOut: s.checkOut, totalPaise: p.total, userUid });
    queueBookingSync(ctx, id);
    return getBookingById(ctx, id)!;
  });
  return { booking, token };
}

// ---------- lookup ----------

export function getBookingById(ctx: Ctx, id: number): BookingRow | undefined {
  return ctx.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRow | undefined;
}

export function getBookingByRef(ctx: Ctx, ref: string): BookingRow | undefined {
  return ctx.db.prepare('SELECT * FROM bookings WHERE ref = ?').get(String(ref).toUpperCase()) as BookingRow | undefined;
}

/** Guest access: booking ref + the private token from their booking link. Constant-time compare. */
/**
 * Guest access: either the private token from their booking link, or being
 * signed in as the Firebase user who made the booking.
 */
export function getBookingForGuest(ctx: Ctx, ref: string, token: string | undefined, uid?: string | null): BookingRow {
  const b = getBookingByRef(ctx, ref);
  const tokenOk =
    b !== undefined &&
    typeof token === 'string' &&
    token.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(b.token_hash));
  const ok = tokenOk || (b !== undefined && typeof uid === 'string' && uid !== '' && b.user_uid === uid);
  if (!ok) throw new HttpError(404, 'Booking not found. Please use the link from your booking.', 'NOT_FOUND');
  return b!;
}

export function paymentsFor(ctx: Ctx, bookingId: number): PaymentRow[] {
  return ctx.db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY id').all(bookingId) as PaymentRow[];
}

export function amountPaid(ctx: Ctx, bookingId: number): number {
  const paid = ctx.db
    .prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS s FROM payments WHERE booking_id = ? AND state IN ('completed', 'verified')`)
    .get(bookingId) as { s: number };
  const refunded = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(r.amount_paise), 0) AS s FROM refunds r JOIN payments p ON p.id = r.payment_id
       WHERE p.booking_id = ? AND r.state = 'completed'`,
    )
    .get(bookingId) as { s: number };
  return paid.s - refunded.s;
}

export function toView(ctx: Ctx, b: BookingRow): BookingView {
  const pays = paymentsFor(ctx, b.id);
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
    amountPaidPaise: amountPaid(ctx, b.id),
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

export function setBooking(ctx: Ctx, id: number, fields: Partial<Pick<BookingRow, 'status' | 'payment_status' | 'needs_attention' | 'hold_expires_at' | 'confirmed_at'>>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  ctx.db
    .prepare(`UPDATE bookings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), iso(ctx), id);
  queueBookingSync(ctx, id);
}

// ---------- copies of the booking elsewhere: guest's Firestore + owner's Google Sheet ----------

const syncQueued = new WeakMap<DB, Set<number>>();

/**
 * After the current transaction commits, pushes this booking's latest state
 * to (a) the guest's Firestore copy users/{uid}/bookings/{ref} and (b) the
 * owner's Google Sheet "Bookings" tab. Several changes in one request sync
 * once. Best effort: SQLite is the source of truth, so failures are only logged.
 */
export function queueBookingSync(ctx: Ctx, bookingId: number) {
  // Open admin screens refresh after the change commits.
  onCommit(ctx.db, () => emitChange('bookings'));
  const toFirestore = Boolean(ctx.firebase?.mirrorBooking);
  const toSheet = sheetsConfigured(ctx.config.notify);
  if (!toFirestore && !toSheet) return;
  const set = syncQueued.get(ctx.db) ?? new Set<number>();
  if (set.has(bookingId)) return;
  set.add(bookingId);
  syncQueued.set(ctx.db, set);
  onCommit(ctx.db, () => {
    set.delete(bookingId);
    const b = getBookingById(ctx, bookingId);
    if (!b) return;
    if (toSheet) syncBookingToSheet(ctx.config.notify, bookingSheetRow(b, paymentsFor(ctx, b.id), amountPaid(ctx, b.id)));
    if (!b.user_uid || !ctx.firebase?.mirrorBooking) return;
    const v = toView(ctx, b);
    ctx.firebase
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
  });
}

/**
 * Expires unpaid holds whose time is up, releasing their nights. A late
 * gateway payment on an expired booking is still honoured by
 * reconcileGatewayPayment (re-acquiring the nights, or flagging for refund).
 */
export function sweepExpiredHolds(ctx: Ctx) {
  const now = iso(ctx);
  const stale = ctx.db
    .prepare(`SELECT * FROM bookings WHERE status = 'pending_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?`)
    .all(now) as BookingRow[];
  for (const b of stale) {
    tx(ctx.db, () => {
      releaseNights(ctx, b.id);
      setBooking(ctx, b.id, { status: 'expired', hold_expires_at: null });
      audit(ctx, 'system', 'booking.expired', b.id, { holdExpiredAt: b.hold_expires_at });
    });
  }
  return stale.length;
}
