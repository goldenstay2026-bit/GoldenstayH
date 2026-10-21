// Availability, owner-managed bookings & blocks, and website requests.
//
// Every booking — online, owner-entered or a block — holds its nights as
// booking_nights/{unit}_{night} documents, which can exist only once, so
// overlaps are impossible at the database level. A stay holds check-in …
// check-out − 1, so the check-out day is free for the next guest. The 2BHK
// and the Entire Homestay hold both rooms.

import crypto from 'node:crypto';
import { BOOKING_OPTIONS, UNIT_ROOM_NAME, isOptionId, optionById, type OptionId, type Unit } from '../shared/catalog.ts';
import {
  GROUP_MAX_GUESTS,
  addDaysISO,
  formatIndianMobile,
  nightsBetween,
  normaliseIndianMobile,
  parseISODate,
  todayInIndia,
} from '../shared/validate.ts';
import {
  audit,
  getBookingById,
  getBookingByRef,
  holdNights,
  iso,
  queueBookingSync,
  releaseNights,
  sha256,
  uniqueRef,
  type BookingRow,
  type Ctx,
} from './bookings.ts';
import { markChanged } from './changes.ts';
import { HttpError } from './http.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string) => `${+iso.slice(8)} ${MONTHS[+iso.slice(5, 7) - 1]}`;

/** Booking options a request may name: a room, the whole homestay, or "any available room". */
export type RequestOption = OptionId | 'any';
export const unitsFor = (option: OptionId): Unit[] => optionById(option).units;
const SINGLE_ROOMS = BOOKING_OPTIONS.filter((o) => o.units.length === 1);

// ---------- availability (public: nights only, never guest details) ----------

type Taken = { unit: Unit; night: string; booking_id: number };

/** Every held unit-night in [from, to), across all rooms (one range read). */
async function nightsInRange(ctx: Ctx, from: string, to: string): Promise<Taken[]> {
  return ctx.db.query<Taken>('booking_nights', {
    where: [
      ['night', '>=', from],
      ['night', '<', to],
    ],
    orderBy: [['night']],
  });
}

async function takenNights(ctx: Ctx, units: Unit[], from: string, to: string, excludeBookingId?: number): Promise<Taken[]> {
  if (units.length === 0) return [];
  return (await nightsInRange(ctx, from, to)).filter((t) => units.includes(t.unit) && t.booking_id !== excludeBookingId);
}

/** Nights in [from, to) on which `option` can't be booked. For "any": nights with no room free. */
export async function bookedNights(ctx: Ctx, option: RequestOption, from: string, to: string): Promise<string[]> {
  const all = await nightsInRange(ctx, from, to);
  if (option === 'any') {
    const perRoom = SINGLE_ROOMS.map((r) => new Set(all.filter((t) => r.units.includes(t.unit)).map((t) => t.night)));
    const nights = new Set(perRoom.flatMap((s) => [...s]));
    return [...nights].filter((n) => perRoom.every((s) => s.has(n))).sort();
  }
  const units = unitsFor(option);
  return [...new Set(all.filter((t) => units.includes(t.unit)).map((t) => t.night))].sort();
}

/** Which options are free for the whole stay (Rooms tab "Check availability"). */
export async function optionsAvailability(ctx: Ctx, checkIn: string, checkOut: string): Promise<Record<OptionId, boolean>> {
  const all = await nightsInRange(ctx, checkIn, checkOut);
  return Object.fromEntries(BOOKING_OPTIONS.map((o) => [o.id, !all.some((t) => o.units.includes(t.unit))])) as Record<OptionId, boolean>;
}

/** Can this request be satisfied? "any" = at least one room free for every night. */
export async function requestFits(ctx: Ctx, option: RequestOption, checkIn: string, checkOut: string): Promise<boolean> {
  const all = await nightsInRange(ctx, checkIn, checkOut);
  if (option === 'any') return SINGLE_ROOMS.some((o) => !all.some((t) => o.units.includes(t.unit)));
  const units = unitsFor(option);
  return !all.some((t) => units.includes(t.unit));
}

/** "AC 1BHK is already booked on 22–23 Nov." — one sentence per affected room. */
export async function conflictMessage(ctx: Ctx, units: Unit[], checkIn: string, checkOut: string, excludeBookingId?: number): Promise<string | null> {
  const taken = await takenNights(ctx, units, checkIn, checkOut, excludeBookingId);
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
    return { kind, optionId, checkIn, checkOut, nights, guestName: '', guestPhone: '', guests: 0, occasion: '', source: 'block', notes: str(input.reason, 300) } as const;
  }
  const guestName = str(input.guestName, 80);
  if (guestName.length < 2) throw bad('guestName', 'Enter the guest’s name.');
  const phoneRaw = str(input.guestPhone, 20);
  const guestPhone = phoneRaw ? normaliseAnyPhone(phoneRaw) : '';
  if (guestPhone === null) throw bad('guestPhone', 'Enter a 10-digit mobile number, or an international number starting with +.');
  const guests = Number(input.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > GROUP_MAX_GUESTS) throw bad('guests', `Guests must be between 1 and ${GROUP_MAX_GUESTS}.`);
  const source = (SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : 'other';
  return { kind, optionId, checkIn, checkOut, nights, guestName, guestPhone, guests, occasion: str(input.occasion, 80), source, notes: str(input.notes, 1000) } as const;
}

async function holdOrConflict(ctx: Ctx, bookingId: number, option: OptionId, checkIn: string, checkOut: string) {
  const msg = await conflictMessage(ctx, unitsFor(option), checkIn, checkOut, bookingId);
  if (msg) throw new HttpError(409, msg, 'DATES_TAKEN');
  try {
    await holdNights(ctx, bookingId, unitsFor(option), checkIn, checkOut);
  } catch (e) {
    // A room-night document already existed: a race the check above missed.
    if (e instanceof HttpError && e.status === 409) {
      throw new HttpError(409, (await conflictMessage(ctx, unitsFor(option), checkIn, checkOut, bookingId)) ?? 'Those dates were just booked. Please choose different dates.', 'DATES_TAKEN');
    }
    throw e;
  }
}

export async function createAdminBooking(ctx: Ctx, input: AdminBookingInput, actor: string, extra: { requestId?: number; source?: string } = {}): Promise<BookingRow> {
  const v = parseAdminInput(input);
  const source = extra.source ?? v.source;
  return ctx.db.tx(async () => {
    const ref = await uniqueRef(ctx);
    const now = iso(ctx);
    const row: Omit<BookingRow, 'id'> = {
      ref,
      token_hash: sha256(crypto.randomBytes(24).toString('base64url')),
      status: 'confirmed',
      payment_status: 'pending',
      needs_attention: null,
      room_id: v.optionId,
      room_name: optionById(v.optionId).name,
      check_in: v.checkIn,
      check_out: v.checkOut,
      nights: v.nights,
      guests: v.guests,
      nightly_paise: 0,
      lines_json: '[]',
      total_paise: 0,
      pay_now_paise: 0,
      guest_name: v.guestName,
      guest_phone: v.guestPhone,
      guest_email: '',
      guest_message: '',
      hold_expires_at: null,
      created_at: now,
      updated_at: now,
      confirmed_at: now,
      user_uid: null,
      kind: v.kind,
      source,
      occasion: v.occasion,
      notes: v.notes,
      request_id: extra.requestId ?? null,
    };
    const id = Number(await ctx.db.insert('bookings', row));
    await holdOrConflict(ctx, id, v.optionId, v.checkIn, v.checkOut);
    await audit(ctx, actor, v.kind === 'block' ? 'block.created' : 'booking.created_by_owner', id, { ref, option: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut, source });
    queueBookingSync(ctx, id);
    return (await getBookingById(ctx, id))!;
  });
}

/** Edits an owner-entered booking or block (online bookings are changed through their payment flow). */
export async function updateAdminBooking(ctx: Ctx, ref: string, input: AdminBookingInput, actor: string): Promise<BookingRow> {
  const existing = await getBookingByRef(ctx, ref);
  if (!existing) throw new HttpError(404, 'Booking not found.', 'NOT_FOUND');
  if (existing.source === 'website_online') throw new HttpError(409, 'Online bookings can’t be edited here. Cancel and re-enter it if the dates changed.', 'NOT_EDITABLE');
  if (existing.status === 'cancelled') throw new HttpError(409, 'This booking is cancelled.', 'NOT_EDITABLE');
  const v = parseAdminInput({ ...input, kind: existing.kind });
  return ctx.db.tx(async () => {
    await releaseNights(ctx, existing.id);
    await ctx.db.update('bookings', existing.id, {
      room_id: v.optionId,
      room_name: optionById(v.optionId).name,
      check_in: v.checkIn,
      check_out: v.checkOut,
      nights: v.nights,
      guests: v.guests,
      guest_name: v.guestName,
      guest_phone: v.guestPhone,
      occasion: v.occasion,
      source: existing.kind === 'block' ? 'block' : v.source,
      notes: v.notes,
      updated_at: iso(ctx),
    });
    await holdOrConflict(ctx, existing.id, v.optionId, v.checkIn, v.checkOut);
    await audit(ctx, actor, existing.kind === 'block' ? 'block.updated' : 'booking.updated_by_owner', existing.id, {
      from: { option: existing.room_id, checkIn: existing.check_in, checkOut: existing.check_out },
      to: { option: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut },
    });
    queueBookingSync(ctx, existing.id);
    return (await getBookingById(ctx, existing.id))!;
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
export async function submitRequest(
  ctx: Ctx,
  e: { bookingType: 'room' | 'entire' | 'party'; option: RequestOption; checkIn: string; checkOut: string; nights: number; guests: number; name: string; phone: string; occasion: string; message: string },
): Promise<RequestRow> {
  return ctx.db.tx(async () => {
    if (!(await requestFits(ctx, e.option, e.checkIn, e.checkOut))) throw new HttpError(409, DATES_TAKEN_MESSAGE, 'DATES_TAKEN', 'checkIn');
    const now = iso(ctx);
    const row: Omit<RequestRow, 'id'> = {
      status: 'pending',
      booking_type: e.bookingType,
      option_id: e.option,
      check_in: e.checkIn,
      check_out: e.checkOut,
      nights: e.nights,
      guests: e.guests,
      guest_name: e.name,
      guest_phone: e.phone,
      occasion: e.occasion,
      message: e.message,
      booking_id: null,
      decided_at: null,
      created_at: now,
      updated_at: now,
    };
    const id = Number(await ctx.db.insert('booking_requests', row));
    ctx.db.onCommit(() => markChanged(ctx, 'requests'));
    return (await getRequest(ctx, id))!;
  });
}

export const getRequest = (ctx: Ctx, id: number) => ctx.db.get<RequestRow>('booking_requests', id);

const pendingRequests = (ctx: Ctx) => ctx.db.query<RequestRow>('booking_requests', { where: [['status', '==', 'pending']] });

/** Pending requests whose check-in has passed become expired. Returns the ones still pending. */
export async function expireRequests(ctx: Ctx): Promise<RequestRow[]> {
  const today = todayInIndia(ctx.now());
  const pending = await pendingRequests(ctx);
  const stale = pending.filter((r) => r.check_in < today);
  for (const r of stale) await ctx.db.update('booking_requests', r.id, { status: 'expired', updated_at: iso(ctx) });
  if (stale.length > 0) markChanged(ctx, 'requests');
  return pending.filter((r) => r.check_in >= today);
}

export async function requestView(ctx: Ctx, r: RequestRow) {
  const option = r.option_id;
  const conflict = r.status === 'pending' && !(await requestFits(ctx, option, r.check_in, r.check_out));
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
    conflictMessage:
      conflict && option !== 'any' ? await conflictMessage(ctx, unitsFor(option), r.check_in, r.check_out) : conflict ? DATES_TAKEN_MESSAGE : null,
    bookingRef: r.booking_id ? ((await getBookingById(ctx, r.booking_id))?.ref ?? null) : null,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

export async function listRequests(ctx: Ctx) {
  await expireRequests(ctx);
  const rows = (await ctx.db.query<RequestRow>('booking_requests', { orderBy: [['id', 'desc']], limit: 300, serverOrder: true })).sort(
    (a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.id - a.id,
  );
  const views = [];
  for (const r of rows) views.push(await requestView(ctx, r));
  return views;
}

export const pendingRequestCount = async (ctx: Ctx) => (await expireRequests(ctx)).length;

/** Approve → a confirmed booking (source website_request). "Any room" requests need the owner to pick one. */
export async function approveRequest(ctx: Ctx, id: number, optionOverride: unknown, actor: string): Promise<BookingRow> {
  return ctx.db.tx(async () => {
    const r = Number.isInteger(id) && id > 0 ? await getRequest(ctx, id) : undefined;
    if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`, 'ALREADY_HANDLED');
    const option = isOptionId(optionOverride) ? optionOverride : r.option_id;
    if (option === 'any') throw new HttpError(400, 'Choose which room to give this guest.', 'CHOOSE_OPTION', 'optionId');
    const booking = await createAdminBooking(
      ctx,
      { kind: 'booking', optionId: option, checkIn: r.check_in, checkOut: r.check_out, guestName: r.guest_name, guestPhone: r.guest_phone, guests: r.guests, occasion: r.occasion, notes: r.message },
      actor,
      { requestId: r.id, source: 'website_request' },
    );
    await ctx.db.update('booking_requests', r.id, { status: 'approved', booking_id: booking.id, decided_at: iso(ctx), updated_at: iso(ctx) });
    await audit(ctx, actor, 'request.approved', booking.id, { requestId: r.id });
    ctx.db.onCommit(() => markChanged(ctx, 'requests'));
    return booking;
  });
}

export async function declineRequest(ctx: Ctx, id: number, actor: string) {
  await ctx.db.tx(async () => {
    const r = Number.isInteger(id) && id > 0 ? await getRequest(ctx, id) : undefined;
    if (!r) throw new HttpError(404, 'Request not found.', 'NOT_FOUND');
    if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`, 'ALREADY_HANDLED');
    await ctx.db.update('booking_requests', r.id, { status: 'declined', decided_at: iso(ctx), updated_at: iso(ctx) });
    await audit(ctx, actor, 'request.declined', null, { requestId: r.id, guest: r.guest_name });
    ctx.db.onCommit(() => markChanged(ctx, 'requests'));
  });
}

// ---------- admin calendar ----------

/** Bookings, blocks and pending requests that touch [from, to) — for the month calendar. */
export async function calendarData(ctx: Ctx, from: string, to: string) {
  const pending = await expireRequests(ctx);
  const bookings = (await ctx.db.query<BookingRow>('bookings', { where: [['check_out', '>', from]], orderBy: [['check_in']] })).filter(
    (b) => b.check_in < to && b.status !== 'cancelled' && b.status !== 'expired',
  );
  const requests = pending.filter((r) => r.check_in < to && r.check_out > from).sort((a, b) => (a.check_in < b.check_in ? -1 : 1));
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
      guestName: b.kind === 'block' ? b.notes || 'Blocked' : b.guest_name,
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
