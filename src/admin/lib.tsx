// Shared pieces of the admin app: authenticated API calls, live updates,
// WhatsApp message templates and small date helpers.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OptionId, Unit } from '../../shared/catalog.ts';
import { addDaysISO, formatISODate } from '../../shared/validate.ts';
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

  // Live updates: Server-Sent Events read with fetch (EventSource can't send the token).
  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let retry: number | undefined;
    const connect = async () => {
      ctrl = new AbortController();
      try {
        const token = await getToken();
        const res = await fetch('/api/admin/events', { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin', signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        setLive(true);
        // Something may have changed while we were disconnected.
        setVersion((v) => ({ bookings: v.bookings + 1, requests: v.requests + 1 }));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (!data) continue;
            const topic = (JSON.parse(data) as { topic: 'bookings' | 'requests' }).topic;
            setVersion((v) => ({ ...v, [topic]: v[topic] + 1 }));
          }
        }
      } catch {
        /* reconnect below */
      }
      setLive(false);
      if (!stopped) retry = window.setTimeout(connect, 5000);
    };
    void connect();
    return () => {
      stopped = true;
      ctrl?.abort();
      window.clearTimeout(retry);
    };
  }, [getToken]);

  return <Ctx.Provider value={{ me, call, version, live, signOut, getToken }}>{children}</Ctx.Provider>;
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

/** Booking confirmation. Check-in/out times are added only when set in site policies. */
export function confirmationMessage(b: { name: string; optionName: string; checkIn: string; checkOut: string; guests: number }) {
  return [
    `Hello ${b.name}, your booking at Golden Stay is confirmed.`,
    `Room: ${b.optionName}`,
    `Check-in: ${formatISODate(b.checkIn)}${policies.checkInTime ? ` from ${policies.checkInTime}` : ''}`,
    `Check-out: ${formatISODate(b.checkOut)}${policies.checkOutTime ? ` by ${policies.checkOutTime}` : ''}`,
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
