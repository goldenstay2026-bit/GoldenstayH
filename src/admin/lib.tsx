// Shared pieces of the admin app: authenticated API calls, live updates,
// WhatsApp message templates and small date helpers.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OptionId, Unit } from '../../shared/catalog.ts';
import { addDaysISO, formatISODate } from '../../shared/validate.ts';
import type { BookingStatus, PropertySettings } from '../../shared/types.ts';
import { policies } from '../data/site';
import { ApiError, api } from '../lib/api';

export type Me = { authenticated: boolean; isAdmin: boolean; email?: string | null; code?: string; gatewayEnabled?: boolean; phonepeEnv?: string };

type CallOpts = { method?: string; body?: unknown; signal?: AbortSignal };

type AdminCtx = {
  me: Me;
  /** JSON call to /api/admin… with the owner's Firebase token (or the legacy session cookie). */
  call: <T>(path: string, opts?: CallOpts) => Promise<T>;
  /** Bumped whenever the server announces a change, so screens refetch. */
  version: { bookings: number; requests: number };
  /** Live connection state for the small status dot. */
  live: boolean;
  signOut: () => void;
  getToken: () => Promise<string | null>;
  /** Stay details & house rules from Admin → Settings. */
  property: PropertySettings | null;
  refreshProperty: () => void;
};

const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside <AdminProvider>');
  return c;
};

export function AdminProvider({ me, getToken, onAuthLost, signOut, children }: { me: Me; getToken: () => Promise<string | null>; onAuthLost: () => void; signOut: () => void; children: ReactNode }) {
  const [version, setVersion] = useState({ bookings: 0, requests: 0 });
  const [live, setLive] = useState(false);
  const [property, setProperty] = useState<PropertySettings | null>(null);
  const [propertyTick, setPropertyTick] = useState(0);
  const refreshProperty = useCallback(() => setPropertyTick((t) => t + 1), []);
  useEffect(() => {
    api<PropertySettings>('/property')
      .then((p) => {
        setProperty(p);
        stayTimes = { checkIn: p.checkInTime ?? policies.checkInTime, checkOut: p.checkOutTime ?? policies.checkOutTime };
      })
      .catch(() => undefined);
  }, [propertyTick]);
  const lost = useRef(onAuthLost);
  lost.current = onAuthLost;

  const call = useCallback(
    async <T,>(path: string, opts: CallOpts = {}) => {
      try {
        return await api<T>(`/admin${path}`, { ...opts, idToken: await getToken() });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'NOT_ADMIN')) lost.current();
        throw e;
      }
    },
    [getToken],
  );

  // Live refresh: check the server's change stamps every few seconds (two tiny reads) and
  // refetch what changed. Paused while the tab is hidden, to save database reads.
  useEffect(() => {
    let last: { bookings: string; requests: string } | null = null;
    let timer: number | undefined;
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const token = await getToken();
          const now = await api<{ bookings: string; requests: string }>('/admin/changes', { idToken: token });
          setLive(true);
          if (last && (now.bookings !== last.bookings || now.requests !== last.requests)) {
            setVersion((v) => ({ bookings: v.bookings + (now.bookings !== last!.bookings ? 1 : 0), requests: v.requests + (now.requests !== last!.requests ? 1 : 0) }));
          }
          last = now;
        } catch {
          setLive(false);
        }
      }
      timer = window.setTimeout(check, 10_000);
    };
    // Coming back to the tab: check straight away.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [getToken]);

  return <Ctx.Provider value={{ me, call, version, live, signOut, getToken, property, refreshProperty }}>{children}</Ctx.Provider>;
}

// ---------- shapes from the server ----------

export type CalBooking = {
  ref: string;
  kind: 'booking' | 'block';
  state: 'booked' | 'block' | 'pending';
  optionId: OptionId;
  optionName: string;
  units: Unit[];
  checkIn: string;
  checkOut: string;
  guestName: string;
  guests: number;
};
export type CalRequest = { id: number; optionId: OptionId | 'any'; units: Unit[]; checkIn: string; checkOut: string; guestName: string };
export type CalendarResponse = { today: string; bookings: CalBooking[]; requests: CalRequest[]; pendingRequests: number };

export type RequestItem = {
  id: number;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  bookingType: 'room' | 'entire' | 'party';
  optionId: OptionId | 'any';
  optionName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  guestName: string;
  guestPhone: string;
  whatsapp: string;
  occasion: string;
  message: string;
  conflict: boolean;
  conflictMessage: string | null;
  bookingRef: string | null;
  createdAt: string;
  decidedAt: string | null;
};

// ---------- payments, statuses, dashboard ----------

export type PaymentLabel = 'paid' | 'partially_paid' | 'pending' | 'to_verify' | 'refunded' | 'failed' | 'not_recorded' | 'none';
export const PAYMENT_LABEL: Record<PaymentLabel, [string, 'neutral' | 'success' | 'warn' | 'danger' | 'info']> = {
  paid: ['Paid', 'success'],
  partially_paid: ['Partially paid', 'warn'],
  pending: ['Pending', 'neutral'],
  to_verify: ['To verify', 'warn'],
  refunded: ['Refunded', 'info'],
  failed: ['Failed', 'danger'],
  not_recorded: ['Not recorded', 'neutral'],
  none: ['—', 'neutral'],
};

export type BookingSummary = {
  ref: string;
  status: BookingStatus;
  payment: PaymentLabel;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  roomName: string;
  optionId: OptionId;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  totalPaise: number;
  paidPaise: number;
  source: string;
  createdAt: string;
};

export type AdminNotification = { kind: 'request' | 'payment' | 'cancellation' | 'checkin'; at: string; title: string; detail: string; ref?: string; requestId?: number };

export type DashboardData = {
  today: string;
  counts: { totalBookings: number; pendingRequests: number; awaitingPayment: number; confirmed: number; completed: number; cancelled: number; upcomingCheckins: number };
  revenue: { totalPaise: number; thisMonthPaise: number; byMonth: { month: string; paise: number }[] };
  upcoming: BookingSummary[];
  recent: BookingSummary[];
  occupancy: { month: string; days: number; units: { unit: Unit; booked: number; blocked: number; percent: number }[] }[];
  notifications: AdminNotification[];
};

export const SOURCE_LABEL: Record<string, string> = {
  website_online: 'Website (paid online)',
  website_request: 'Website enquiry',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  other: 'Other',
  block: 'Blocked dates',
};

// ---------- dates ----------

export const nightsLabel = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export function addMonths(first: string, n: number) {
  const y = +first.slice(0, 4);
  const m = +first.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
/** 0 = Monday … 6 = Sunday */
export const weekdayMon = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
export const monthTitle = (first: string) =>
  new Date(`${first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dateRange = (checkIn: string, checkOut: string) => `${formatISODate(checkIn)} – ${formatISODate(checkOut)}`;
export { addDaysISO, formatISODate };

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ---------- WhatsApp ----------

export const waUrl = (number: string, text: string) => `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** Check-in/out times for messages: from Admin → Settings (loaded by AdminProvider), else site.ts. */
let stayTimes: { checkIn: string | null; checkOut: string | null } = { checkIn: policies.checkInTime, checkOut: policies.checkOutTime };

/** Booking confirmation. Check-in/out times are added only when they are set. */
export function confirmationMessage(b: { name: string; optionName: string; checkIn: string; checkOut: string; guests: number }) {
  return [
    `Hello ${b.name}, your booking at Golden Stay is confirmed.`,
    `Room: ${b.optionName}`,
    `Check-in: ${formatISODate(b.checkIn)}${stayTimes.checkIn ? ` from ${stayTimes.checkIn}` : ''}`,
    `Check-out: ${formatISODate(b.checkOut)}${stayTimes.checkOut ? ` by ${stayTimes.checkOut}` : ''}`,
    `Guests: ${b.guests}`,
    'Please bring a valid photo ID for all adult guests. See you soon!',
  ].join('\n');
}

export const declineMessage = (b: { name: string; checkIn: string; checkOut: string }) =>
  `Hello ${b.name}, sorry, Golden Stay is not available for ${dateRange(b.checkIn, b.checkOut)}. Please let us know if other dates would work for you.`;

// ---------- CSV (backups / spreadsheets) ----------

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v ?? '');
    // Stop spreadsheet apps from treating a cell as a formula.
    // (Phone numbers like "+91 98640 12345" are left alone.)
    if (/^[=@\t\r]/.test(s) || /^[+-](?![\d ]+$)/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
