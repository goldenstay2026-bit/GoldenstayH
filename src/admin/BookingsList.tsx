// Bookings: every booking, searchable and filterable — by when (Upcoming /
// Today / Past / All), status, payment and room. A table on desktop, cards on
// phones. Export what's on screen as CSV (also the backup).

import { useEffect, useState } from 'react';
import { CircleAlert, Download, Search } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import { Alert, BookingChip, Chip, Spinner } from '../components/ui';
import type { Row } from './BookingDrawer';
import { PAYMENT_LABEL, SOURCE_LABEL, downloadCsv, formatISODate, nightsLabel, useAdmin } from './lib';

const VIEWS = [
  ['upcoming', 'Upcoming'],
  ['today', 'Today'],
  ['past', 'Past'],
  ['', 'All'],
] as const;

const STATUSES = [
  ['all', 'Any status'],
  ['action', 'Needs action'],
  ['pending_payment', 'Pending (awaiting payment)'],
  ['pending_verification', 'Pending (payment to verify)'],
  ['confirmed', 'Confirmed'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
  ['expired', 'Expired'],
] as const;

const PAYMENTS = [
  ['', 'Any payment'],
  ['paid', 'Paid'],
  ['partially_paid', 'Partially paid'],
  ['pending', 'Pending'],
  ['to_verify', 'To verify'],
  ['refunded', 'Refunded'],
  ['not_recorded', 'Not recorded'],
] as const;

export function BookingsList({ onOpen }: { onOpen: (ref: string) => void }) {
  const { call, version } = useAdmin();
  const [view, setView] = useState<string>('upcoming');
  const [status, setStatus] = useState<string>('all');
  const [payment, setPayment] = useState<string>('');
  const [unit, setUnit] = useState<string>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      call<Row[]>(`/bookings?view=${view}&filter=${status}&payment=${payment}&unit=${unit}&q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
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
  }, [view, status, payment, unit, q, call, version.bookings]);

  const exportCsv = () => {
    if (!rows) return;
    downloadCsv(
      `golden-stay-bookings-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Booking ID', 'Type', 'Status', 'Payment', 'Room', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Guest name', 'Phone', 'Email', 'Source', 'Occasion', 'Notes', 'Total (₹)', 'Paid (₹)', 'Created'],
      rows.map((r) => [
        r.ref,
        r.kind === 'block' ? 'Block' : 'Booking',
        r.status,
        PAYMENT_LABEL[r.payment][0],
        r.roomName,
        r.checkIn,
        r.checkOut,
        r.nights,
        r.kind === 'block' ? '' : r.guests,
        r.guestName,
        r.guestPhone,
        r.guestEmail,
        SOURCE_LABEL[r.source] ?? r.source,
        r.occasion,
        r.notes,
        r.totalPaise ? r.totalPaise / 100 : '',
        r.amountPaidPaise ? r.amountPaidPaise / 100 : '',
        r.createdAt,
      ]),
    );
  };

  const statusChip = (r: Row) => (r.kind === 'block' ? <Chip>{r.status === 'cancelled' ? 'Block removed' : 'Blocked'}</Chip> : <BookingChip status={r.status} />);
  const payChip = (r: Row) => (r.kind === 'block' ? null : <Chip tone={PAYMENT_LABEL[r.payment][1]}>{PAYMENT_LABEL[r.payment][0]}</Chip>);
  const name = (r: Row) => (r.kind === 'block' ? `Blocked${r.notes ? ` · ${r.notes}` : ''}` : r.guestName);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold">Bookings</h1>
        <button onClick={exportCsv} disabled={!rows?.length} className="flex h-11 items-center gap-2 rounded-full border border-hairline px-4 text-[15px] font-semibold hover:border-ink disabled:opacity-40">
          <Download size={17} aria-hidden="true" /> CSV
        </button>
      </div>

      <div role="group" aria-label="Which bookings" className="mt-4 grid grid-cols-4 rounded-full bg-card p-1 lg:max-w-[520px]">
        {VIEWS.map(([id, label]) => (
          <button key={id || 'all'} aria-pressed={view === id} onClick={() => setView(id)} className={`h-10 rounded-full text-[15px] font-semibold ${view === id ? 'bg-white shadow-sm' : 'text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <label className="relative block">
          <span className="sr-only">Search by name, phone, email or booking ID</span>
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input type="search" className="field h-12 pl-11 text-[16px]" placeholder="Name, phone, email or ID" value={q} onChange={(e) => setQ(e.target.value)} />
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
        <label>
          <span className="sr-only">Payment</span>
          <select className="field h-12 text-[16px]" value={payment} onChange={(e) => setPayment(e.target.value)}>
            {PAYMENTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Room</span>
          <select className="field h-12 text-[16px]" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">Both rooms</option>
            <option value="ac">AC 1BHK</option>
            <option value="nonac">Non-AC 1BHK</option>
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
        <p className="mt-6 rounded-[16px] bg-card px-5 py-8 text-center text-[16px] text-muted">No bookings match these filters.</p>
      ) : (
        <>
          <p className="mt-3 text-[14px] text-muted">
            {rows.length} {rows.length === 1 ? 'booking' : 'bookings'}
          </p>
          {/* Phones and tablets */}
          <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-[16px] border border-hairline bg-white lg:hidden">
            {rows.map((r) => (
              <li key={r.ref}>
                <button onClick={() => onOpen(r.ref)} className="w-full px-4 py-3.5 text-left hover:bg-cream">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                        {r.needsAttention && <CircleAlert size={16} className="shrink-0 text-[#a3261b]" aria-label="Needs attention" />}
                        <span className="truncate">{name(r)}</span>
                      </span>
                      <span className="block text-[14.5px] text-muted">
                        {r.roomName} · {formatISODate(r.checkIn)} → {formatISODate(r.checkOut)} · {nightsLabel(r.nights)}
                      </span>
                      {r.guestPhone && <span className="block text-[14.5px] text-muted">{r.guestPhone}</span>}
                    </span>
                    {r.totalPaise > 0 && <span className="shrink-0 text-[15px] font-semibold tabular-nums">{formatPaise(r.totalPaise)}</span>}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {statusChip(r)}
                    {payChip(r)}
                    <Chip>{r.ref}</Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Desktop */}
          <div className="mt-2 hidden overflow-x-auto rounded-[16px] border border-hairline bg-white lg:block">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-muted">
                <tr>
                  {['Booking', 'Guest', 'Phone / email', 'Check-in', 'Check-out', 'Guests', 'Total', 'Payment', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr key={r.ref} className="cursor-pointer align-top hover:bg-cream" onClick={() => onOpen(r.ref)}>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold tracking-[0.02em]">
                      <button className="flex items-center gap-1 font-semibold underline-offset-4 hover:underline" onClick={() => onOpen(r.ref)}>
                        {r.needsAttention && <CircleAlert size={15} className="text-[#a3261b]" aria-label="Needs attention" />}
                        {r.ref}
                      </button>
                      <span className="block text-[12.5px] font-normal text-muted">{r.roomName}</span>
                    </td>
                    <td className="max-w-[170px] px-3 py-3">
                      <span className="block truncate font-medium">{name(r)}</span>
                      <span className="block text-[12.5px] text-muted">{SOURCE_LABEL[r.source] ?? r.source}</span>
                    </td>
                    <td className="max-w-[200px] px-3 py-3">
                      <span className="block whitespace-nowrap">{r.guestPhone || '—'}</span>
                      {r.guestEmail && <span className="block truncate text-[12.5px] text-muted" title={r.guestEmail}>{r.guestEmail}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{formatISODate(r.checkIn)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatISODate(r.checkOut)}
                      <span className="block text-[12.5px] text-muted">{nightsLabel(r.nights)}</span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{r.kind === 'block' ? '—' : r.guests}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {r.totalPaise ? formatPaise(r.totalPaise) : '—'}
                      {r.amountPaidPaise > 0 && r.amountPaidPaise < r.totalPaise && <span className="block text-[12.5px] text-muted">paid {formatPaise(r.amountPaidPaise)}</span>}
                    </td>
                    <td className="px-3 py-3">{payChip(r) ?? '—'}</td>
                    <td className="px-3 py-3">{statusChip(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
