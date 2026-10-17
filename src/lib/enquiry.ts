import { ANY_ROOM, ANY_ROOM_LABEL, business, roomLabel, rooms, type RoomId } from '../data/site';
import {
  BOOKING_TYPE_MESSAGE,
  ENQUIRY_MAX_ADVANCE_DAYS,
  ENQUIRY_MAX_NIGHTS,
  GROUP_MAX_GUESTS,
  isGroupBooking,
  type EnquiryBookingType,
} from '../../shared/validate.ts';

export type RoomChoice = RoomId | typeof ANY_ROOM;

export type EnquiryValues = {
  /** Room stay (default), or the whole homestay / a party or event. */
  bookingType: EnquiryBookingType;
  name: string;
  phone: string;
  checkIn: string; // yyyy-mm-dd (native date input value)
  checkOut: string;
  guests: string;
  room: RoomChoice | '';
  /** Group bookings only, optional (e.g. "Birthday"). */
  occasion: string;
  message: string;
};

export type EnquiryErrors = Partial<Record<keyof EnquiryValues, string>>;

// ---------- dates (local time, string-based to avoid TZ drift) ----------

const pad = (n: number) => String(n).padStart(2, '0');

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(iso: string, days: number): string {
  const t = parseISO(iso);
  if (t === null) return '';
  const d = new Date(t + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseISO(checkIn);
  const b = parseISO(checkOut);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd → "14 Nov 2026" */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// ---------- phone ----------

/** Returns the 10-digit Indian mobile number, or null if invalid. Accepts +91, 91, 0 prefixes and spaces/dashes. */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const formatPhone = (ten: string) => `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;

// ---------- validation ----------

export function validate(v: EnquiryValues, today = todayISO()): EnquiryErrors {
  const e: EnquiryErrors = {};
  if (!v.name.trim()) e.name = 'Please enter your full name.';
  else if (v.name.trim().length < 2) e.name = 'Please enter your full name.';

  if (!v.phone.trim()) e.phone = 'Please enter your phone / WhatsApp number.';
  else if (!normalisePhone(v.phone)) e.phone = 'Enter a 10-digit Indian mobile number, e.g. +91 98765 43210.';

  if (!v.checkIn) e.checkIn = 'Please choose a check-in date.';
  else if (v.checkIn < today) e.checkIn = 'Check-in can’t be in the past.';
  else if (nightsBetween(today, v.checkIn) > ENQUIRY_MAX_ADVANCE_DAYS) e.checkIn = 'Please choose a check-in date within the next two years.';

  if (!v.checkOut) e.checkOut = 'Please choose a check-out date.';
  else if (v.checkIn && v.checkOut <= v.checkIn) e.checkOut = 'Check-out must be after check-in.';
  else if (v.checkIn && nightsBetween(v.checkIn, v.checkOut) > ENQUIRY_MAX_NIGHTS) e.checkOut = `For stays longer than ${ENQUIRY_MAX_NIGHTS} nights, please call us.`;

  const group = isGroupBooking(v.bookingType);
  const maxGuests = group ? GROUP_MAX_GUESTS : 8;
  const g = Number(v.guests);
  if (!v.guests) e.guests = 'Please choose the number of guests.';
  else if (!Number.isInteger(g) || g < 1 || g > maxGuests) e.guests = `Choose between 1 and ${maxGuests} guests.`;

  if (!group && !v.room) e.room = 'Please choose a room.';
  if (group && v.occasion.trim().length > 80) e.occasion = 'Please keep the occasion short (80 characters max).';
  return e;
}

// ---------- WhatsApp ----------

export const waLink = (text: string) => `https://wa.me/${business.phone.wa}?text=${encodeURIComponent(text)}`;

export const GENERIC_WA_TEXT = 'Hello Golden Stay,\n\nI would like to enquire about a stay. Please let me know the availability. Thank you.';

export function choiceLabel(choice: RoomChoice | ''): string {
  if (choice === 'any') return ANY_ROOM_LABEL;
  const room = rooms.find((r) => r.id === choice);
  return room ? roomLabel(room) : '';
}

export function buildMessage(v: EnquiryValues): string {
  const nights = nightsBetween(v.checkIn, v.checkOut);
  const phone = normalisePhone(v.phone);
  if (isGroupBooking(v.bookingType)) {
    return [
      'Hello Golden Stay,',
      '',
      'I would like to enquire about booking the entire homestay.',
      '',
      `Booking type: ${BOOKING_TYPE_MESSAGE[v.bookingType]}`,
      `Name: ${v.name.trim()}`,
      `Phone: ${phone ? formatPhone(phone) : v.phone.trim()}`,
      `Check-in: ${formatDate(v.checkIn)}`,
      `Check-out: ${formatDate(v.checkOut)} (${nights} ${nights === 1 ? 'night' : 'nights'})`,
      `Approx. guests: ${v.guests}`,
      `Occasion: ${v.occasion.trim() || '—'}`,
      '',
      `Message: ${v.message.trim() || '—'}`,
      '',
      'Please let me know the availability, price and any conditions. Thank you.',
    ].join('\n');
  }
  return [
    'Hello Golden Stay,',
    '',
    'I would like to enquire about a stay.',
    '',
    `Name: ${v.name.trim()}`,
    `Phone: ${phone ? formatPhone(phone) : v.phone.trim()}`,
    `Check-in: ${formatDate(v.checkIn)}`,
    `Check-out: ${formatDate(v.checkOut)} (${nights} ${nights === 1 ? 'night' : 'nights'})`,
    `Guests: ${v.guests}`,
    `Preferred Room: ${choiceLabel(v.room)}`,
    '',
    `Message: ${v.message.trim() || '—'}`,
    '',
    'Please let me know the availability and final price. Thank you.',
  ].join('\n');
}
