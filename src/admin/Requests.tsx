// Website enquiries: pending first. Approve → booking (+ WhatsApp confirmation),
// Decline → WhatsApp "not available" message, Call → phone.

import { useState } from 'react';
import { CircleAlert, MessageCircle, Phone } from 'lucide-react';
import { ROOM_CATALOG, optionById, type OptionId } from '../../shared/catalog.ts';
import { Alert, Chip, Spinner } from '../components/ui';
import { confirmationMessage, dateRange, declineMessage, nightsLabel, useAdmin, waUrl, when, type RequestItem } from './lib';

const TYPE_LABEL = { room: 'Room stay', entire: 'Entire homestay', party: 'Party / event' } as const;
const STATUS_TONE = { pending: 'warn', approved: 'success', declined: 'neutral', expired: 'neutral' } as const;

export function RequestsView({ items, error, onOpenBooking }: { items: RequestItem[] | null; error: string; onOpenBooking: (ref: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  // Requests handled on this screen stay in place so their WhatsApp follow-up stays visible.
  const [handled, setHandled] = useState<Set<number>>(() => new Set());
  const markHandled = (id: number) => setHandled((s) => new Set(s).add(id));
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!items)
    return (
      <p className="flex justify-center gap-2 py-24 text-muted">
        <Spinner /> Loading…
      </p>
    );
  const pending = items.filter((r) => r.status === 'pending' || handled.has(r.id));
  const others = items.filter((r) => r.status !== 'pending' && !handled.has(r.id));
  const conflicts = pending.filter((r) => r.status === 'pending' && r.conflict).length;
  return (
    <div>
      <h1 className="text-[24px] font-bold">Requests</h1>
      <p className="mt-1 text-[15px] text-muted">Enquiries from the website. Nothing is booked until you approve it.</p>
      {conflicts > 0 && (
        <div className="mt-4">
          <Alert tone="warn" role="status" title={`${conflicts} ${conflicts === 1 ? 'request clashes' : 'requests clash'} with existing bookings`}>
            Those dates were booked after the guest asked. Decline, or call them to offer other dates.
          </Alert>
        </div>
      )}
      {pending.length === 0 ? (
        <p className="mt-6 rounded-[16px] bg-card px-5 py-8 text-center text-[16px] text-muted">No pending requests.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {pending.map((r) => (
            <RequestCard key={r.id} r={r} onOpenBooking={onOpenBooking} onHandled={markHandled} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <section className="mt-8">
          <button onClick={() => setShowAll((s) => !s)} aria-expanded={showAll} className="text-[15px] font-semibold underline underline-offset-4">
            {showAll ? 'Hide' : 'Show'} handled requests ({others.length})
          </button>
          {showAll && (
            <ul className="mt-3 space-y-3">
              {others.map((r) => (
                <RequestCard key={r.id} r={r} onOpenBooking={onOpenBooking} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RequestCard({ r, onOpenBooking, onHandled }: { r: RequestItem; onOpenBooking: (ref: string) => void; onHandled?: (id: number) => void }) {
  const { call } = useAdmin();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState('');
  const [choose, setChoose] = useState(false);
  const [option, setOption] = useState<OptionId>('ac-1bhk');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [done, setDone] = useState<{ kind: 'approved'; ref: string; text: string } | { kind: 'declined'; text: string } | null>(null);

  const approve = async () => {
    if (r.optionId === 'any' && !choose) return setChoose(true);
    setBusy('approve');
    setError('');
    try {
      const chosen = r.optionId === 'any' ? option : r.optionId;
      onHandled?.(r.id);
      const res = await call<{ ref: string }>(`/requests/${r.id}/approve`, { method: 'POST', body: r.optionId === 'any' ? { optionId: option } : {} });
      setDone({ kind: 'approved', ref: res.ref, text: confirmationMessage({ name: r.guestName, optionName: optionById(chosen).name, checkIn: r.checkIn, checkOut: r.checkOut, guests: r.guests }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    setBusy('decline');
    setError('');
    try {
      onHandled?.(r.id);
      await call(`/requests/${r.id}/decline`, { method: 'POST', body: {} });
      setDone({ kind: 'declined', text: declineMessage({ name: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmDecline(false);
    }
  };

  return (
    <li className={`rounded-[18px] border bg-white p-4 text-[16px] ${r.conflict ? 'border-[#e3b4ae]' : 'border-hairline'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[18px] font-bold">{r.guestName}</p>
          <p className="text-[15px] text-muted">{r.guestPhone}</p>
        </div>
        <Chip tone={STATUS_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Chip>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px]">
        <dt className="text-muted">Dates</dt>
        <dd>
          {dateRange(r.checkIn, r.checkOut)} · {nightsLabel(r.nights)}
        </dd>
        <dt className="text-muted">{r.bookingType === 'room' ? 'Room' : 'Type'}</dt>
        <dd>{r.bookingType === 'room' ? r.optionName : TYPE_LABEL[r.bookingType]}</dd>
        <dt className="text-muted">Guests</dt>
        <dd>{r.guests}</dd>
        {r.occasion && (
          <>
            <dt className="text-muted">Occasion</dt>
            <dd>{r.occasion}</dd>
          </>
        )}
        {r.message && (
          <>
            <dt className="text-muted">Message</dt>
            <dd className="whitespace-pre-wrap break-words">{r.message}</dd>
          </>
        )}
        <dt className="text-muted">Received</dt>
        <dd>{when(r.createdAt)}</dd>
      </dl>

      {r.conflict && r.conflictMessage && (
        <p className="mt-3 flex gap-2 rounded-[12px] bg-[#fbe9e7] px-3 py-2.5 text-[15px] text-[#a3261b]">
          <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {r.conflictMessage}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        </div>
      )}

      {done ? (
        <div className="mt-4 rounded-[14px] bg-card p-4" role="status">
          <p className="font-semibold">{done.kind === 'approved' ? `Approved · booking ${done.ref}` : 'Declined'}</p>
          <a href={waUrl(r.whatsapp, done.text)} target="_blank" rel="noopener noreferrer" className="btn btn-dark mt-3 h-12 w-full gap-2 text-[16px]">
            <MessageCircle size={18} aria-hidden="true" /> {done.kind === 'approved' ? 'Send confirmation on WhatsApp' : 'Tell the guest on WhatsApp'}
          </a>
          {done.kind === 'approved' && (
            <button onClick={() => onOpenBooking(done.ref)} className="btn btn-outline mt-2 h-12 w-full text-[16px]">
              Open booking
            </button>
          )}
        </div>
      ) : r.status === 'pending' ? (
        <>
          {choose && (
            <fieldset className="mt-4">
              <legend className="text-[15px] font-semibold">The guest asked for any room. Give them:</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {ROOM_CATALOG.filter((x) => x.units.length === 1).map((x) => (
                  <label key={x.id} className={`flex h-12 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] font-semibold ${option === x.id ? 'border-ink bg-ink text-white' : 'border-hairline'}`}>
                    <input type="radio" name={`opt-${r.id}`} className="sr-only" checked={option === x.id} onChange={() => setOption(x.id)} />
                    {x.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {confirmDecline ? (
            <div className="mt-4 rounded-[14px] bg-card p-4">
              <p className="font-semibold">Decline this request?</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setConfirmDecline(false)} className="btn btn-outline h-12 flex-1 text-[16px]">
                  Back
                </button>
                <button onClick={decline} disabled={busy !== null} className="btn h-12 flex-1 bg-[#a3261b] text-[16px] text-white hover:bg-[#8a1f16]">
                  {busy === 'decline' ? <Spinner label="Declining" /> : 'Decline'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={approve} disabled={busy !== null || r.conflict} className="btn btn-dark h-12 text-[16px] disabled:opacity-40">
                {busy === 'approve' ? <Spinner label="Approving" /> : choose ? 'Confirm' : 'Approve'}
              </button>
              <button onClick={() => setConfirmDecline(true)} disabled={busy !== null} className="btn btn-outline h-12 text-[16px]">
                Decline
              </button>
              <a href={`tel:+${r.whatsapp}`} className="btn btn-outline h-12 gap-1.5 text-[16px]">
                <Phone size={17} aria-hidden="true" /> Call
              </a>
            </div>
          )}
        </>
      ) : (
        r.bookingRef && (
          <button onClick={() => onOpenBooking(r.bookingRef!)} className="mt-3 text-[15px] font-semibold underline underline-offset-4">
            Open booking {r.bookingRef}
          </button>
        )
      )}
    </li>
  );
}
