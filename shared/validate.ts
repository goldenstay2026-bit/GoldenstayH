// Validation rules shared by the website (instant feedback) and the server
// (the authority — the server re-checks everything).

export const MAX_NIGHTS = 30;
export const MAX_ADVANCE_DAYS = 365;
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 8;
/** Enquiry form limits (looser than online booking — the owner confirms personally). */
export const ENQUIRY_MAX_NIGHTS = 90;
export const ENQUIRY_MAX_ADVANCE_DAYS = 730;
/** Entire homestay / party enquiries allow more guests (approximate). */
export const GROUP_MAX_GUESTS = 50;

export type EnquiryBookingType = 'room' | 'entire' | 'party';
export const ENQUIRY_BOOKING_TYPES: EnquiryBookingType[] = ['room', 'entire', 'party'];
/** Labels in the form's Booking type select. */
export const BOOKING_TYPE_OPTION: Record<EnquiryBookingType, string> = {
  room: 'Room stay',
  entire: 'Entire homestay',
  party: 'Party / event (entire homestay)',
};
/** Labels in the WhatsApp / Telegram message. */
export const BOOKING_TYPE_MESSAGE: Record<EnquiryBookingType, string> = {
  room: 'Room stay',
  entire: 'Entire homestay',
  party: 'Party / event',
};
export const isGroupBooking = (t: EnquiryBookingType) => t === 'entire' || t === 'party';

/** Hidden honeypot field name on the enquiry form. Real visitors never see or fill it. */
export const HONEYPOT_FIELD = 'website';

// ---------- dates (yyyy-mm-dd, compared as strings / UTC days) ----------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function parseISODate(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  // Reject impossible dates such as 2026-02-31.
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t;
}

export function addDaysISO(iso: string, days: number): string {
  const t = parseISODate(iso);
  if (t === null) return '';
  const d = new Date(t + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Every night of the stay: check-in inclusive, check-out exclusive. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const n = nightsBetween(checkIn, checkOut);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDaysISO(checkIn, i));
}

/** Today's date in India (the property's timezone), yyyy-mm-dd. */
export function todayInIndia(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000); // UTC+5:30, no DST
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd → "14 Nov 2026" */
export function formatISODate(iso: string): string {
  const m = ISO.exec(iso);
  if (!m) return iso;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

/** Returns an error message, or null when the stay dates are acceptable. */
export function checkStayDates(checkIn: string, checkOut: string, today: string): string | null {
  if (parseISODate(checkIn) === null) return 'Please choose a valid check-in date.';
  if (parseISODate(checkOut) === null) return 'Please choose a valid check-out date.';
  if (checkIn < today) return 'Check-in can’t be in the past.';
  if (checkOut <= checkIn) return 'Check-out must be after check-in.';
  if (nightsBetween(checkIn, checkOut) > MAX_NIGHTS) return `Online bookings are limited to ${MAX_NIGHTS} nights. Please contact us for longer stays.`;
  if (nightsBetween(today, checkIn) > MAX_ADVANCE_DAYS) return 'Bookings open up to one year in advance.';
  return null;
}

// ---------- guest details ----------

/** 10-digit Indian mobile, or null. Accepts +91 / 91 / 0 prefixes, spaces and dashes. */
export function normaliseIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export const formatIndianMobile = (ten: string) => `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;

export function isValidEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * UPI transaction reference (UTR / "UPI Ref No."): 12 digits.
 * Spaces are ignored so guests can paste "4123 4567 8901".
 */
export function normaliseUtr(raw: string): string | null {
  const v = raw.replace(/\s+/g, '');
  return /^\d{12}$/.test(v) ? v : null;
}
