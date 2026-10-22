// Admin dashboard figures, notifications and the guest list — all computed
// from the real bookings, payments, refunds and requests in Firestore.

import { UNITS, type Unit } from '../shared/catalog.ts';
import { addDaysISO, todayInIndia } from '../shared/validate.ts';
import { paymentLabel, sweepExpiredHolds, type BookingRow, type Ctx, type PaymentRow, type RefundRow } from './bookings.ts';
import { displayPhone, expireRequests, unitsFor, whatsappNumber, type RequestRow } from './calendar.ts';

const istDay = (isoTime: string) => todayInIndia(new Date(isoTime));
const monthKey = (d: string) => d.slice(0, 7);
function addMonthsKey(key: string, n: number) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const daysIn = (key: string) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();

const ACTIVE = (b: BookingRow) => b.status !== 'cancelled' && b.status !== 'expired' && b.status !== 'rejected';

async function loadAll(ctx: Ctx) {
  await sweepExpiredHolds(ctx);
  const [bookings, payments, refunds, requests] = await Promise.all([
    ctx.db.query<BookingRow>('bookings'),
    ctx.db.query<PaymentRow>('payments'),
    ctx.db.query<RefundRow>('refunds'),
    ctx.db.query<RequestRow>('booking_requests'),
  ]);
  await expireRequests(ctx);
  const paidBy = new Map<number, number>();
  const refundedBy = new Map<number, number>();
  for (const p of payments) if (p.state === 'completed' || p.state === 'verified') paidBy.set(p.booking_id, (paidBy.get(p.booking_id) ?? 0) + p.amount_paise);
  for (const r of refunds) if (r.state === 'completed') refundedBy.set(r.booking_id, (refundedBy.get(r.booking_id) ?? 0) + r.amount_paise);
  const net = (id: number) => (paidBy.get(id) ?? 0) - (refundedBy.get(id) ?? 0);
  return { bookings, payments, refunds, requests, net, refundedBy };
}

export function bookingSummary(b: BookingRow, paid: number, refunded = 0) {
  return {
    ref: b.ref,
    status: b.status,
    payment: paymentLabel(b, paid, refunded),
    guestName: b.guest_name,
    guestPhone: b.guest_phone ? displayPhone(b.guest_phone) : '',
    guestEmail: b.guest_email,
    roomName: b.room_name,
    optionId: b.room_id,
    checkIn: b.check_in,
    checkOut: b.check_out,
    nights: b.nights,
    guests: b.guests,
    totalPaise: b.total_paise,
    paidPaise: paid,
    source: b.source,
    createdAt: b.created_at,
  };
}

export async function dashboardData(ctx: Ctx) {
  const { bookings, payments, refunds, requests, net, refundedBy } = await loadAll(ctx);
  const today = todayInIndia(ctx.now());
  const tomorrow = addDaysISO(today, 1);
  const real = bookings.filter((b) => b.kind === 'booking');
  const live = real.filter((b) => b.status !== 'expired');

  const thisMonth = monthKey(today);
  const months = Array.from({ length: 12 }, (_, i) => addMonthsKey(thisMonth, i - 11));
  const revenue = new Map(months.map((m) => [m, 0]));
  for (const p of payments) {
    if (p.state !== 'completed' && p.state !== 'verified') continue;
    const m = monthKey(istDay(p.created_at));
    if (revenue.has(m)) revenue.set(m, revenue.get(m)! + p.amount_paise);
  }
  for (const r of refunds) {
    if (r.state !== 'completed') continue;
    const m = monthKey(istDay(r.created_at));
    if (revenue.has(m)) revenue.set(m, revenue.get(m)! - r.amount_paise);
  }
  const totalRevenue = real.reduce((s, b) => s + net(b.id), 0);

  // Occupancy: share of room-nights held by bookings (blocks counted separately), this month and next.
  const occupancy = [thisMonth, addMonthsKey(thisMonth, 1)].map((m) => {
    const from = `${m}-01`;
    const to = `${addMonthsKey(m, 1)}-01`;
    const days = daysIn(m);
    const perUnit = Object.fromEntries(UNITS.map((u) => [u, { booked: 0, blocked: 0 }])) as Record<Unit, { booked: number; blocked: number }>;
    for (const b of bookings) {
      if (!ACTIVE(b) || b.check_out <= from || b.check_in >= to) continue;
      const start = b.check_in > from ? b.check_in : from;
      const end = b.check_out < to ? b.check_out : to;
      const n = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
      for (const u of unitsFor(b.room_id)) perUnit[u][b.kind === 'block' ? 'blocked' : 'booked'] += n;
    }
    return { month: m, days, units: UNITS.map((u) => ({ unit: u, ...perUnit[u], percent: Math.round((perUnit[u].booked / days) * 100) })) };
  });

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const notifications: { kind: string; at: string; title: string; detail: string; ref?: string; requestId?: number }[] = [];
  for (const r of pendingRequests) {
    notifications.push({ kind: 'request', at: r.created_at, title: `New enquiry from ${r.guest_name}`, detail: `${r.check_in} → ${r.check_out} · ${r.guests} guests`, requestId: r.id });
  }
  for (const b of real) {
    if (b.status === 'pending_verification') notifications.push({ kind: 'payment', at: b.updated_at, title: `Payment to verify — ${b.guest_name}`, detail: `${b.room_name} · ${b.check_in}`, ref: b.ref });
    if ((b.status === 'cancelled' || b.status === 'rejected') && b.updated_at >= new Date(ctx.now().getTime() - 14 * 86_400_000).toISOString()) {
      notifications.push({ kind: 'cancellation', at: b.updated_at, title: `${b.status === 'rejected' ? 'Rejected' : 'Cancelled'} — ${b.guest_name}`, detail: `${b.room_name} · ${b.check_in} → ${b.check_out}`, ref: b.ref });
    }
    if (b.status === 'confirmed' && (b.check_in === today || b.check_in === tomorrow)) {
      notifications.push({ kind: 'checkin', at: `${b.check_in}T00:00:00.000Z`, title: `Check-in ${b.check_in === today ? 'today' : 'tomorrow'} — ${b.guest_name}`, detail: `${b.room_name} · ${b.guests} guests`, ref: b.ref });
    }
  }
  notifications.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    today,
    counts: {
      totalBookings: live.length,
      pendingRequests: pendingRequests.length,
      awaitingPayment: real.filter((b) => b.status === 'pending_payment' || b.status === 'pending_verification').length,
      confirmed: real.filter((b) => b.status === 'confirmed').length,
      completed: real.filter((b) => b.status === 'completed').length,
      cancelled: real.filter((b) => b.status === 'cancelled' || b.status === 'rejected').length,
      upcomingCheckins: real.filter((b) => b.status === 'confirmed' && b.check_in >= today && b.check_in <= addDaysISO(today, 7)).length,
    },
    revenue: { totalPaise: totalRevenue, thisMonthPaise: revenue.get(thisMonth) ?? 0, byMonth: months.map((m) => ({ month: m, paise: revenue.get(m) ?? 0 })) },
    upcoming: real
      .filter((b) => (b.status === 'confirmed' || b.status === 'pending_verification') && b.check_in >= today && b.check_in <= addDaysISO(today, 14))
      .sort((a, b) => (a.check_in < b.check_in ? -1 : 1))
      .slice(0, 8)
      .map((b) => bookingSummary(b, net(b.id), refundedBy.get(b.id))),
    recent: [...real].sort((a, b) => b.id - a.id).slice(0, 8).map((b) => bookingSummary(b, net(b.id), refundedBy.get(b.id))),
    occupancy,
    notifications: notifications.slice(0, 25),
  };
}

// ---------- guests ----------

/** One guest = one phone number (or email when there's no phone). */
function guestKey(phone: string, email: string, name: string) {
  if (phone) return `p${whatsappNumber(phone)}`;
  if (email) return `e${email.toLowerCase()}`;
  return `n${name.trim().toLowerCase()}`;
}

type GuestAgg = {
  key: string;
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  bookings: number;
  requests: number;
  nights: number;
  spentPaise: number;
  lastStay: string | null;
  upcoming: string | null;
  lastActivity: string;
};

async function guestIndex(ctx: Ctx) {
  const { bookings, requests, net, refundedBy } = await loadAll(ctx);
  const today = todayInIndia(ctx.now());
  const guests = new Map<string, GuestAgg & { _bookings: BookingRow[]; _requests: RequestRow[] }>();
  const touch = (phone: string, email: string, name: string, at: string) => {
    const key = guestKey(phone, email, name);
    let g = guests.get(key);
    if (!g) {
      g = { key, name, phone: phone ? displayPhone(phone) : '', whatsapp: phone ? whatsappNumber(phone) : '', email, bookings: 0, requests: 0, nights: 0, spentPaise: 0, lastStay: null, upcoming: null, lastActivity: at, _bookings: [], _requests: [] };
      guests.set(key, g);
    }
    if (at >= g.lastActivity) {
      g.lastActivity = at;
      g.name = name || g.name;
    }
    if (email && !g.email) g.email = email;
    return g;
  };
  for (const b of bookings) {
    if (b.kind !== 'booking' || b.status === 'expired') continue;
    const g = touch(b.guest_phone, b.guest_email, b.guest_name, b.created_at);
    g._bookings.push(b);
    g.bookings++;
    g.spentPaise += net(b.id);
    if (b.status === 'confirmed' || b.status === 'completed') {
      g.nights += b.nights;
      if (b.check_in < today && (!g.lastStay || b.check_in > g.lastStay)) g.lastStay = b.check_in;
      if (b.check_in >= today && (!g.upcoming || b.check_in < g.upcoming)) g.upcoming = b.check_in;
    }
  }
  for (const r of requests) {
    const g = touch(r.guest_phone, '', r.guest_name, r.created_at);
    g._requests.push(r);
    g.requests++;
  }
  return { guests, net, refundedBy };
}

export async function listGuests(ctx: Ctx, q: string) {
  const { guests } = await guestIndex(ctx);
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const rows = [...guests.values()].filter(
    (g) =>
      !needle ||
      g.name.toLowerCase().includes(needle) ||
      g.email.toLowerCase().includes(needle) ||
      (digits.length >= 3 && g.whatsapp.includes(digits)) ||
      g._bookings.some((b) => b.ref.toLowerCase() === needle),
  );
  rows.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
  return rows.slice(0, 500).map(({ _bookings, _requests, ...g }) => g);
}

export async function guestDetail(ctx: Ctx, key: string) {
  const { guests, net, refundedBy } = await guestIndex(ctx);
  const g = guests.get(key);
  if (!g) return null;
  const { _bookings, _requests, ...info } = g;
  return {
    ...info,
    bookingList: _bookings.sort((a, b) => (a.check_in < b.check_in ? 1 : -1)).map((b) => bookingSummary(b, net(b.id), refundedBy.get(b.id))),
    requestList: _requests
      .sort((a, b) => b.id - a.id)
      .map((r) => ({ id: r.id, status: r.status, checkIn: r.check_in, checkOut: r.check_out, guests: r.guests, optionId: r.option_id, message: r.message, createdAt: r.created_at })),
  };
}
