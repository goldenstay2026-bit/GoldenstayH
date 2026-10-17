// Availability, owner-managed bookings & blocks, and website requests.
//
// Every booking — online, owner-entered or a block — holds its nights in
// booking_nights, whose UNIQUE(unit, night) constraint makes overlaps
// impossible at the database level. A stay holds check-in … check-out − 1,
// so the check-out day is free for the next guest. The 2BHK and the Entire
// Homestay hold both rooms.

import crypto from 'node:crypto';
import { BOOKING_OPTIONS, UNIT_ROOM_NAME, isOptionId, optionById, type OptionId, type Unit } from '../shared/catalog.ts';
import {
  GROUP_MAX_GUESTS,
  addDaysISO,
  formatIndianMobile,
  nightsBetween,
  normaliseIndianMobile,
  parseISODate,
  stayNights,
  todayInIndia,
} from '../shared/validate.ts';
import {
  audit,
  getBookingById,
  getBookingByRef,
  holdNights,
  iso,
  newRef,
  queueBookingSync,
  releaseNights,
  sha256,
  type BookingRow,
  type Ctx,
} from './bookings.ts';
import { tx } from './db.ts';
import { emitChange } from './events.ts';
import { HttpError } from './http.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]}`;

/** Booking options a request may name: a room, the whole homestay, or "any available room". */
export type RequestOption = OptionId | 'any';
export const unitsFor = (option: OptionId): Unit[] => optionById(option).units;

// ---------- availability (public: nights only, never guest details) ----------

type Taken = { unit: Unit; night: string; booking_id: number };

function takenNights(ctx: Ctx, units: Unit[], from: string, to: string, excludeBookingId?: number): Taken[] {
  if (units.length === 0) return [];
  return ctx.db
    .prepare(
      `SELECT unit, night, booking_id FROM booking_nights
       WHERE unit IN (${units.map(() => '?').join(',')}) AND night >= ? AND night < ? ${excludeBookingId ? 'AND booking_id <> ?' : ''}
       ORDER BY night`,
    )
    .all(...units, from, to, ...(excludeBookingId ? [excludeBookingId] : [])) as Taken[];
}

/** Nights in [from, to) on which `option` can't be booked. For "any": nights with no room free. */
export function bookedNights(ctx: Ctx, option: RequestOption, from: string, to: string): string[] {
  if (option === 'any') {
    const rooms = BOOKING_OPTIONS.filter((o) => o.units.length === 1);
    const perRoom = rooms.map((r) => new Set(takenNights(ctx, r.units, from, to).map((t) => t.night)));
    const all = new Set(perRoom.flatMap((s) => [...s]));
    return [...all].filter((n) => perRoom.every((s) => s.has(n))).sort();
  }
  return [...new Set(takenNights(ctx, unitsFor(option), from, to).map((t) => t.night))].sort();
}

/** Which options are free for the whole stay (Rooms tab "Check availability"). */
export function optionsAvailability(ctx: Ctx, checkIn: string, checkOut: string): Record<OptionId, boolean> {
  return Object.fromEntries(BOOKING_OPTIONS.map((o) => [o.id, takenNights(ctx, o.units, checkIn, checkOut).length === 0])) as Record<OptionId, boolean>;
}

/** Can this request be satisfied? "any" = at least one room free for every night. */
export function requestFits(ctx: Ctx, option: RequestOption, checkIn: string, checkOut: string): boolean {
  if (option === 'any') return BOOKING_OPTIONS.filter((o) => o.units.length === 1).some((o) => takenNights(ctx, o.units, checkIn, checkOut).length === 0);
  return takenNights(ctx, unitsFor(option), checkIn, checkOut).length === 0;
}

/** "AC 1BHK is already booked on 22–23 Nov." — one sentence per affected room. */
export function conflictMessage(ctx: Ctx, units: Unit[], checkIn: string, checkOut: string, excludeBookingId?: number): string | null {
  const taken = takenNights(ctx, units, checkIn, checkOut, excludeBookingId);
  if (taken.length === 0) return null;
  const parts: string[] = [];
  for (const unit of units) {
    const nights = taken.filter((t) => t.unit === unit).map((t) => t.night);
    if (!nights.length) continue;
    // Group consecutive nights into ranges: 22–23 Nov, 25 Nov
    const ranges: string[] = [];
    let start = nights[0];
    let prev = nights[0];
    for (const n of [...nights.slice(1), '']) {
      if (n && n === addDaysISO(prev, 1)) {
        prev = n;
        continue;
      }
      ranges.push(start === prev ? short(start) : start.slice(5, 7) === prev.slice(5, 7) ? `${+start.slice(8)}–${short(prev)}` : `${short(start)} – ${short(prev)}`);
      start = prev = n;
    }
    parts.push(`${UNIT_ROOM_NAME[unit]} is already booked on ${ranges.join(', ')}.`);
  }
  return parts.join(' ');
}

// ---------- owner bookings & blocks ----------

export const SOURCES = ['phone', 'whatsapp', 'walk_in', 'website_request', 'other'] as const;
export type Source = (typeof SOURCES)[number];

export type AdminBookingInput = {
  kind?: unknown; // 'booking' | 'block'
  optionId?: unknown;
  checkIn?: unknown;
  checkOut?: unknown;
  guestName?: unknown;
  guestPhone?: unknown;
  guests?: unknown;
  occasion?: unknown;
  source?: unknown;
  notes?: unknown;
  reason?: unknown;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Indian 10-digit mobile → stored as 10 digits; otherwise an international number with country code (digits only). */
export function normaliseAnyPhone(raw: string): string | null {
  const ten = normaliseIndianMobile(raw);
  if (ten) return ten;
  const digits = raw.replace(/[^\d+]/g, '');
  return /^\+\d{8,15}$/.test(digits) ? digits : null;
}
export const whatsappNumber = (stored: string) => (/^\d{10}$/.test(stored) ? `91${stored}` : stored.replace(/^\+/, ''));
export const displayPhone = (stored: string) => (/^\d{10}$/.test(stored) ? formatIndianMobile(stored) : stored);

function parseAdminInput(input: AdminBookingInput) {
  const bad = (field: string, msg: string) => new HttpError(400, msg, 'INVALID_INPUT', field);
  const kind = input.kind === 'block' ? 'block' : 'booking';
  if (!isOptionId(input.optionId)) throw bad('optionId', 'Choose a room or the entire homestay.');
  const optionId = input.optionId;
  const checkIn = str(input.checkIn, 10);
  const checkOut = str(input.checkOut, 10);
  if (parseISODate(checkIn) === null) throw bad('checkIn', 'Choose a check-in date.');
  if (parseISODate(checkOut) === null) throw bad('checkOut', 'Choose a check-out date.');
  if (checkOut <= checkIn) throw bad('checkOut', 'Check-out must be after check-in.');
  const nights = nightsBetween(checkIn, checkOut);
  if (nights > 365) throw bad('checkOut', 'That is more than a year — please split it into shorter periods.');

  if (kind === 'block') {
    return { kind, optionId, checkIn, checkOut, nights, guestName: '', guestPhone: '', guests: 0, occasion: '', source: 'block', notes: str(input.reason, 300) };
  }
  const guestName = str(input.guestName, 80);
  if (guestName.length < 2) throw bad('guestName', 'Enter the guest’s name.');
  const phoneRaw = str(input.guestPhone, 20);
  const guestPhone = phoneRaw ? normaliseAnyPhone(phoneRaw) : '';
  if (guestPhone === null) throw bad('guestPhone', 'Enter a 10-digit mobile number, or an international number starting with +.');
  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > GROUP_MAX_GUESTS) throw bad('guests', `Guests must be between 1 and ${GROUP_MAX_GUESTS}.`);
  const source = (SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : 'other';
  return { kind, optionId, checkIn, checkOut, nights, guestName, guestPhone, guests, occasion: str(input.occasion, 80), source, notes: str(input.notes, 1000) };
}

function holdOrConflict(ctx: Ctx, bookingId: number, option: OptionId, checkIn: string, checkOut: string) {
  const msg = conflictMessage(ctx, unitsFor(option), checkIn, checkOut, bookingId);
  if (msg) throw new HttpError(409, msg, 'DATES_TAKEN');
  try {
    holdNights(ctx, bookingId, unitsFor(option), checkIn, checkOut);
  } catch (e) {
    // The UNIQUE(unit, night) constraint caught a race the check above missed.
    if (e instanceof HttpError && e.status === 409) {
      throw new HttpError(409, conflictMessage(ctx, unitsFor(option), checkIn, checkOut, bookingId) ?? 'Those dates were just booked. Please choose different dates.', 'DATES_TAKEN');
    }
    throw e;
  }
}

export function createAdminBooking(ctx: Ctx, input: AdminBookingInput, actor: string, extra: { requestId?: number; source?: string } = {}): BookingRow {
  const v = parseAdminInput(input);
  const source = extra.source ?? v.source;
  return tx(ctx.db, () => {
    let ref = newRef();
    while (getBookingByRef(ctx, ref)) ref = newRef();
    const now = iso(ctx);
    const r = ctx.db
      .prepare(
        `INSERT INTO bookings (ref, token_hash, status, payment_status, room_id, room_name, check_in, check_out, nights, guests,
           nightly_paise, lines_json, total_paise, pay_now_paise, guest_name, guest_phone, guest_email, guest_message,
           hold_expires_at, created_at, updated_at, confirmed_at, kind, source, occasion, notes, request_id)
         VALUES (?, ?, 'confirmed', 'pending', ?, ?, ?, ?, ?, ?, 0, '[]', 0, 0, ?, ?, '', '', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ref, sha256(crypto.randomBytes(24).toString('base64url')), v.optionId, optionById(v.optionId).name, v.checkIn, v.checkOut, v.nights, v.guests,
        v.guestName, v.guestPhone, now, now, now, v.kind, source, v.occasion, v.notes, extra.requestId ?? null,
      );
    const id = Number(r.lastInsertRowid);
    holdOrConflict(ctx, id, v.optionId, v.checkIn, v.checkOut);
    audit(ctx, actor, v.kind === 'block' ? 'block.created' : 'booking.created_by_owner', id, { ref, option: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut, source });
    queueBookingSync(ctx, id);
    return getBookingById(ctx, id)!;
  });
}

/** Edits an owner-entered booking or block (online bookings are changed through their payment flow). */
export function updateAdminBooking(ctx: Ctx, ref: string, input: AdminBookingInput, actor: string): BookingRow {
  const existing = getBookingByRef(ctx, ref);
  if (!existing) throw new HttpError(404, 'Booking not found.', 'NOT_FOUND');
  if (existing.source === 'website_online') throw new HttpError(409, 'Online bookings can’t be edited here. Cancel and re-enter it if the dates changed.', 'NOT_EDITABLE');
  if (existing.status === 'cancelled') throw new HttpError(409, 'This booking is cancelled.', 'NOT_EDITABLE');
  const v = parseAdminInput({ ...input, kind: existing.kind });
  return tx(ctx.db, () => {
    releaseNights(ctx, existing.id);
    ctx.db
      .prepare(
        `UPDATE bookings SET room_id = ?, room_name = ?, check_in = ?, check_out = ?, nights = ?, guests = ?, guest_name = ?, guest_phone = ?,
           occasion = ?, source = ?, notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        v.optionId, optionById(v.optionId).name, v.checkIn, v.checkOut, v.nights, v.guests, v.guestName, v.guestPhone,
        v.occasion, existing.kind === 'block' ? 'block' : v.source, v.notes, iso(ctx), existing.id,
      );
    holdOrConflict(ctx, existing.id, v.optionId, v.checkIn, v.checkOut);
    audit(ctx, actor, existing.kind === 'block' ? 'block.updated' : 'booking.updated_by_owner', existing.id, {
      from: { option: existing.room_id, checkIn: existing.check_in, checkOut: existing.check_out },
      to: { option: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut },
    });
    queueBookingSync(ctx, existing.id);
    return getBookingById(ctx, existing.id)!;
  });
}

// ---------- website requests ----------

export type RequestRow = {
  id: number;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  booking_type: 'room' | 'entire' | 'party';
  option_id: RequestOption;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  guest_name: string;
  guest_phone: string;
  occasion: string;
  message: string;
  booking_id: number | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export const DATES_TAKEN_MESSAGE = 'Some of these nights are already booked. Please choose different dates.';

/** submit_request: saves a website enquiry, refusing dates that are already booked. */
export function submitRequest(
  ctx: Ctx,
  e: { bookingType: 'room' | 'entire' | 'party'; option: RequestOption; checkIn: string; checkOut: string; nights: number; guests: number; name: string; phone: string; occasion: string; message: string },
): RequestRow {
  return tx(ctx.db, () => {
    if (!requestFits(ctx, e.option, e.checkIn, e.checkOut)) throw new HttpError(409, DATES_TAKEN_MESSAGE, 'DATES_TAKEN', 'checkIn');
    const now = iso(ctx);
    const r = ctx.db
      .prepare(
        `INSERT INTO booking_requests (status, booking_type, option_id, check_in, check_out, nights, guests, guest_name, guest_phone, occasion, message, created_at, updated_at)
         VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.bookingType, e.option, e.checkIn, e.checkOut, e.nights, e.guests, e.name, e.phone, e.occasion, e.message, now, now);
    emitChange('requests');
    return getRequest(ctx, Number(r.lastInsertRowid))!;
  });
}

export const getRequest = (ctx: Ctx, id: number) => ctx.db.prepare('SELECT * FROM booking_requests WHERE id = ?').get(id) as RequestRow | undefined;

/** Pending requests whose check-in has passed become expired. */
export function expireRequests(ctx: Ctx) {
  const r = ctx.db
    .prepare(`UPDATE booking_requests SET status = 'expired', updated_at = ? WHERE status = 'pending' AND check_in < ?`)
    .run(iso(ctx), todayInIndia(ctx.now()));
  if (Number(r.changes) > 0) emitChange('requests');
}

export function requestView(ctx: Ctx, r: RequestRow) {
  const option = r.option_id;
  const conflict = r.status === 'pending' && !requestFits(ctx, option, r.check_in, r.check_out);
  return {
    id: r.id,
    status: r.status,
    bookingType: r.booking_type,
    optionId: option,
    optionName: option === 'any' ? 'Any available room' : optionById(option).name,
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: r.nights,
    guests: r.guests,
    guestName: r.guest_name,
    guestPhone: displayPhone(r.guest_phone),
    whatsapp: whatsappNumber(r.guest_phone),
    occasion: r.occasion,
    message: r.message,
    conflict,
    conflictMessage: conflict && option !== 'any' ? conflictMessage(ctx, unitsFor(option), r.check_in, r.check_out) : conflict ? DATES_TAKEN_MESSAGE : null,
    bookingRef: r.booking_id ? (getBookingById(ctx, r.booking_id)?.ref ?? null) : null,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

export function listRequests(ctx: Ctx) {
  expireRequests(ctx);
  const rows = ctx.db
    .prepare(`SELECT * FROM booking_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 300`)
    .all() as RequestRow[];
  return rows.map((r) => requestView(ctx, r));
}

export const pendingRequestCount = (ctx: Ctx) => {
  expireRequests(ctx);
  return (ctx.db.prepare(`SELECT COUNT(*) AS n FROM booking_requests WHERE status = 'pending'`).get() as { n: number }).n;
};

/** Approve → a confirmed booking (source website_request). "Any room" requests need the owner to pick one. */
export function approveRequest(ctx: Ctx, id: number, optionOverride: unknown, actor: string): BookingRow {
  return tx(ctx.db, () => {
    const r = getRequest(ctx, id);
    if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`, 'ALREADY_HANDLED');
    const option = isOptionId(optionOverride) ? optionOverride : r.option_id;
    if (option === 'any') throw new HttpError(400, 'Choose which room to give this guest.', 'CHOOSE_OPTION', 'optionId');
    const booking = createAdminBooking(
      ctx,
      { kind: 'booking', optionId: option, checkIn: r.check_in, checkOut: r.check_out, guestName: r.guest_name, guestPhone: r.guest_phone, guests: r.guests, occasion: r.occasion, notes: r.message },
      actor,
      { requestId: r.id, source: 'website_request' },
    );
    ctx.db.prepare(`UPDATE booking_requests SET status = 'approved', booking_id = ?, decided_at = ?, updated_at = ? WHERE id = ?`).run(booking.id, iso(ctx), iso(ctx), r.id);
    audit(ctx, actor, 'request.approved', booking.id, { requestId: r.id });
    emitChange('requests');
    return booking;
  });
}

export function declineRequest(ctx: Ctx, id: number, actor: string) {
  const r = getRequest(ctx, id);
  if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
  if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`, 'ALREADY_HANDLED');
  ctx.db.prepare(`UPDATE booking_requests SET status = 'declined', decided_at = ?, updated_at = ? WHERE id = ?`).run(iso(ctx), iso(ctx), r.id);
  audit(ctx, actor, 'request.declined', null, { requestId: r.id, guest: r.guest_name });
  emitChange('requests');
}

// ---------- admin calendar & list views ----------

/** Bookings, blocks and pending requests that touch [from, to) — for the month calendar. */
export function calendarData(ctx: Ctx, from: string, to: string) {
  expireRequests(ctx);
  const bookings = ctx.db
    .prepare(
      `SELECT * FROM bookings WHERE status NOT IN ('cancelled', 'expired') AND check_in < ? AND check_out > ? ORDER BY check_in`,
    )
    .all(to, from) as BookingRow[];
  const requests = ctx.db
    .prepare(`SELECT * FROM booking_requests WHERE status = 'pending' AND check_in < ? AND check_out > ? ORDER BY check_in`)
    .all(to, from) as RequestRow[];
  return {
    bookings: bookings.map((b) => ({
      ref: b.ref,
      kind: b.kind,
      // booked = confirmed; pending = online booking still awaiting payment / verification
      state: b.kind === 'block' ? 'block' : b.status === 'confirmed' ? 'booked' : 'pending',
      optionId: b.room_id,
      optionName: b.room_name,
      units: unitsFor(b.room_id),
      checkIn: b.check_in,
      checkOut: b.check_out,
      guestName: b.kind === 'block' ? (b.notes || 'Blocked') : b.guest_name,
      guests: b.guests,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      optionId: r.option_id,
      units: r.option_id === 'any' ? (['ac', 'nonac'] as Unit[]) : unitsFor(r.option_id),
      checkIn: r.check_in,
      checkOut: r.check_out,
      guestName: r.guest_name,
    })),
  };
}

export function stayNightsSafe(checkIn: string, checkOut: string) {
  return stayNights(checkIn, checkOut);
}
