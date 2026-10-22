// Guests: everyone who booked or enquired, one row per phone number (or email),
// with their history. Search by name, phone, email or booking ID.

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Phone, Search, X } from 'lucide-react';
import { formatPaise, isOptionId, optionById } from '../../shared/catalog.ts';
import { Alert, BookingChip, Chip, Spinner } from '../components/ui';
import { useModal } from '../lib/useModal';
import { PAYMENT_LABEL, dateRange, formatISODate, nightsLabel, useAdmin, when, type BookingSummary } from './lib';

type Guest = {
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
type GuestDetail = Guest & {
  bookingList: BookingSummary[];
  requestList: { id: number; status: string; checkIn: string; checkOut: string; guests: number; optionId: string; message: string; createdAt: string }[];
};

export function GuestsView({ onOpenBooking }: { onOpenBooking: (ref: string) => void }) {
  const { call, version } = useAdmin();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Guest[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      call<Guest[]>(`/guests?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => {
          setRows(r);
          setError('');
        })
        .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message));
    }, q ? 250 : 0);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q, call, version.bookings, version.requests]);

  return (
    <div>
      <h1 className="text-[24px] font-bold">Guests</h1>
      <p className="mt-1 text-[15px] text-muted">Everyone who has booked or enquired, with their history.</p>
      <label className="relative mt-4 block max-w-[520px]">
        <span className="sr-only">Search guests</span>
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input type="search" className="field h-12 pl-11 text-[16px]" placeholder="Name, phone, email or booking ID" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {error && (
        <div className="mt-4">
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        </div>
      )}
      {rows === null ? (
        <p className="flex justify-center gap-2 py-16 text-muted">
          <Spinner /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-[16px] bg-card px-5 py-8 text-center text-[16px] text-muted">{q ? 'No guest matches that search.' : 'No guests yet.'}</p>
      ) : (
        <>
          {/* Phones and tablets: cards */}
          <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[16px] border border-hairline bg-white lg:hidden">
            {rows.map((g) => (
              <li key={g.key}>
                <button onClick={() => setOpen(g.key)} className="w-full px-4 py-3.5 text-left hover:bg-cream">
                  <span className="block text-[16px] font-semibold">{g.name}</span>
                  <span className="block text-[14px] text-muted">{[g.phone, g.email].filter(Boolean).join(' · ')}</span>
                  <span className="mt-1 block text-[13.5px] text-muted">
                    {g.bookings} {g.bookings === 1 ? 'booking' : 'bookings'} · {g.requests} {g.requests === 1 ? 'enquiry' : 'enquiries'}
                    {g.upcoming ? ` · next stay ${formatISODate(g.upcoming)}` : g.lastStay ? ` · last stay ${formatISODate(g.lastStay)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="mt-4 hidden overflow-hidden rounded-[16px] border border-hairline bg-white lg:block">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-cream text-[12.5px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  {['Guest', 'Phone', 'Email', 'Bookings', 'Enquiries', 'Nights', 'Paid', 'Next / last stay'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((g) => (
                  <tr key={g.key} className="cursor-pointer hover:bg-cream" onClick={() => setOpen(g.key)}>
                    <td className="px-4 py-3 font-semibold">
                      <button className="text-left font-semibold underline-offset-4 hover:underline" onClick={() => setOpen(g.key)}>
                        {g.name}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{g.phone || '—'}</td>
                    <td className="max-w-[220px] truncate px-4 py-3">{g.email || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{g.bookings}</td>
                    <td className="px-4 py-3 tabular-nums">{g.requests}</td>
                    <td className="px-4 py-3 tabular-nums">{g.nights}</td>
                    <td className="px-4 py-3 tabular-nums">{g.spentPaise ? formatPaise(g.spentPaise) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">{g.upcoming ? `Next: ${formatISODate(g.upcoming)}` : g.lastStay ? formatISODate(g.lastStay) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {open && <GuestDrawer guestKey={open} onClose={() => setOpen(null)} onOpenBooking={(ref) => { setOpen(null); onOpenBooking(ref); }} />}
    </div>
  );
}

function GuestDrawer({ guestKey, onClose, onOpenBooking }: { guestKey: string; onClose: () => void; onOpenBooking: (ref: string) => void }) {
  const { call } = useAdmin();
  const [g, setG] = useState<GuestDetail | null>(null);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, true, onClose);
  useEffect(() => {
    call<GuestDetail>(`/guests/${encodeURIComponent(guestKey)}`).then(setG).catch((e) => setError((e as Error).message));
  }, [guestKey, call]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={g ? `Guest ${g.name}` : 'Guest'} className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Guest</p>
            <p className="truncate text-[20px] font-bold">{g?.name ?? '…'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full bg-card" data-autofocus>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-[15px]">
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
          {!g && !error && (
            <p className="flex justify-center gap-2 py-16 text-muted">
              <Spinner /> Loading…
            </p>
          )}
          {g && (
            <>
              <section>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                  <dt className="text-muted">Phone</dt>
                  <dd>{g.phone || '—'}</dd>
                  <dt className="text-muted">Email</dt>
                  <dd className="break-all">{g.email ? <a className="link-underline" href={`mailto:${g.email}`}>{g.email}</a> : '—'}</dd>
                  <dt className="text-muted">Stays</dt>
                  <dd>
                    {g.bookings} {g.bookings === 1 ? 'booking' : 'bookings'} · {nightsLabel(g.nights)}
                  </dd>
                  <dt className="text-muted">Paid</dt>
                  <dd>{formatPaise(g.spentPaise)}</dd>
                </dl>
                {g.whatsapp && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a className="btn btn-outline h-12 gap-2 px-5 text-[16px]" href={`https://wa.me/${g.whatsapp}`} target="_blank" rel="noopener noreferrer">
                      <MessageCircle size={17} aria-hidden="true" /> WhatsApp
                    </a>
                    <a className="btn btn-outline h-12 gap-2 px-5 text-[16px]" href={`tel:+${g.whatsapp}`}>
                      <Phone size={17} aria-hidden="true" /> Call
                    </a>
                  </div>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Bookings</h3>
                {g.bookingList.length === 0 ? (
                  <p className="text-muted">No bookings.</p>
                ) : (
                  <ul className="space-y-2">
                    {g.bookingList.map((b) => (
                      <li key={b.ref}>
                        <button onClick={() => onOpenBooking(b.ref)} className="w-full rounded-[14px] border border-hairline px-4 py-3 text-left hover:border-ink">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{b.roomName}</span>
                            <span className="flex gap-1.5">
                              <BookingChip status={b.status} />
                              {b.payment !== 'none' && <Chip tone={PAYMENT_LABEL[b.payment][1]}>{PAYMENT_LABEL[b.payment][0]}</Chip>}
                            </span>
                          </span>
                          <span className="mt-1 block text-[14px] text-muted">
                            {dateRange(b.checkIn, b.checkOut)} · {nightsLabel(b.nights)} · {b.ref}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Enquiries</h3>
                {g.requestList.length === 0 ? (
                  <p className="text-muted">No enquiries.</p>
                ) : (
                  <ul className="space-y-2">
                    {g.requestList.map((r) => (
                      <li key={r.id} className="rounded-[14px] bg-card px-4 py-3">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">{r.optionId === 'any' ? 'Any available room' : isOptionId(r.optionId) ? optionById(r.optionId).name : r.optionId}</span>
                          <Chip tone={r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'success' : 'neutral'}>{r.status === 'declined' ? 'Rejected' : r.status[0].toUpperCase() + r.status.slice(1)}</Chip>
                        </span>
                        <span className="mt-1 block text-[14px] text-muted">
                          {dateRange(r.checkIn, r.checkOut)} · {r.guests} guests · received {when(r.createdAt)}
                        </span>
                        {r.message && <span className="mt-1 block text-[14px]">{r.message}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
