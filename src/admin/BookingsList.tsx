// Bookings list: Upcoming / Today / Past, search by name or phone, filter by
// room and status, and export what's on screen as CSV (also the backup).

import { useEffect, useState } from 'react';
import { CircleAlert, Download, Search } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import { Alert, BookingChip, Chip, PaymentChip, Spinner } from '../components/ui';
import type { Row } from './BookingDrawer';
import { SOURCE_LABEL, downloadCsv, formatISODate, nightsLabel, useAdmin } from './lib';

const VIEWS = [
  ['upcoming', 'Upcoming'],
  ['today', 'Today'],
  ['past', 'Past'],
  ['', 'All'],
] as const;

const STATUSES = [
  ['all', 'Any status'],
  ['action', 'Needs action'],
  ['confirmed', 'Confirmed'],
  ['pending_verification', 'Payment to verify'],
  ['pending_payment', 'Awaiting payment'],
  ['cancelled', 'Cancelled'],
  ['expired', 'Expired'],
] as const;

export function BookingsList({ onOpen }: { onOpen: (ref: string) => void }) {
  const { call, version } = useAdmin();
  const [view, setView] = useState<string>('upcoming');
  const [status, setStatus] = useState<string>('all');
  const [unit, setUnit] = useState<string>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      call<Row[]>(`/bookings?view=${view}&filter=${status}&unit=${unit}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
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
  }, [view, status, unit, q, call, version.bookings]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(
      `golden-stay-bookings-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Booking ID', 'Type', 'Status', 'Payment', 'Room', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Guest name', 'Phone', 'Source', 'Occasion', 'Notes', 'Total (₹)', 'Paid (₹)', 'Created'],
      rows.map((r) => [
        r.ref,
        r.kind === 'block' ? 'Block' : 'Booking',
        r.status,
        r.source === 'website_online' ? r.paymentStatus : 'offline',
        r.roomName,
        r.checkIn,
        r.checkOut,
        r.nights,
        r.kind === 'block' ? '' : r.guests,
        r.guestName,
        r.guestPhone,
        SOURCE_LABEL[r.source] ?? r.source,
        r.occasion,
        r.notes,
        r.source === 'website_online' ? r.totalPaise / 100 : '',
        r.source === 'website_online' ? r.amountPaidPaise / 100 : '',
        r.createdAt,
      ]),
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold">Bookings</h1>
        <button onClick={exportCsv} disabled={!rows?.length} className="flex h-11 items-center gap-2 rounded-full border border-hairline px-4 text-[15px] font-semibold hover:border-ink disabled:opacity-40">
          <Download size={17} aria-hidden="true" /> CSV
        </button>
      </div>

      <div role="group" aria-label="Which bookings" className="mt-4 grid grid-cols-4 rounded-full bg-card p-1">
        {VIEWS.map(([id, label]) => (
          <button key={id || 'all'} aria-pressed={view === id} onClick={() => setView(id)} className={`h-10 rounded-full text-[15px] font-semibold ${view === id ? 'bg-white shadow-sm' : 'text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_200px]">
        <label className="relative block">
          <span className="sr-only">Search by name or phone</span>
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input type="search" className="field h-12 pl-11 text-[16px]" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          <span className="sr-only">Room</span>
          <select className="field h-12 text-[16px]" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Both rooms</option>
            <option value="ac">AC 1BHK</option>
            <option value="nonac">Non-AC 1BHK</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className="field h-12 text-[16px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

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
        <p className="mt-6 rounded-[16px] bg-card px-5 py-8 text-center text-[16px] text-muted">No bookings here.</p>
      ) : (
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[16px] border border-hairline bg-white">
          {rows.map((r) => (
            <li key={r.ref}>
              <button onClick={() => onOpen(r.ref)} className="w-full px-4 py-3.5 text-left hover:bg-cream">
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                      {r.needsAttention && <CircleAlert size={16} className="shrink-0 text-[#a3261b]" aria-label="Needs attention" />}
                      <span className="truncate">{r.kind === 'block' ? `Blocked${r.notes ? ` · ${r.notes}` : ''}` : r.guestName}</span>
                    </span>
                    <span className="block text-[14.5px] text-muted">
                      {r.roomName} · {formatISODate(r.checkIn)} → {formatISODate(r.checkOut)} · {nightsLabel(r.nights)}
                    </span>
                    {r.guestPhone && <span className="block text-[14.5px] text-muted">{r.guestPhone}</span>}
                  </span>
                  {r.source === 'website_online' && <span className="shrink-0 text-[15px] font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span>}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {r.kind === 'block' ? <Chip>Blocked</Chip> : <BookingChip status={r.status} />}
                  {r.source === 'website_online' ? <PaymentChip status={r.paymentStatus} /> : r.kind !== 'block' && <Chip>{SOURCE_LABEL[r.source] ?? r.source}</Chip>}
                  <Chip>{r.ref}</Chip>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
