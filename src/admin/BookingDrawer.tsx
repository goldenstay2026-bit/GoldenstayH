// Booking details: guest, stay, payments (verify / reject / refund), edit,
// WhatsApp confirmation, cancel, and the audit history.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MessageCircle, Pencil, Phone, RefreshCw, X } from 'lucide-react';
import { formatPaise, type OptionId } from '../../shared/catalog.ts';
import type { BookingStatus, PaymentStatus } from '../../shared/types.ts';
import { formatISODate } from '../../shared/validate.ts';
import { Alert, BookingChip, Chip, Field, PaymentChip, Spinner } from '../components/ui';
import { useModal } from '../lib/useModal';
import { SOURCE_LABEL, confirmationMessage, nightsLabel, useAdmin, waUrl, when } from './lib';
import type { FormInit } from './BookingForm';

export type Row = {
  ref: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  needsAttention: string | null;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  guestName: string;
  /** Display form, e.g. "+91 98640 12345" ('' when not given) */
  guestPhone: string;
  /** Digits for wa.me / tel: links, with country code */
  whatsapp: string;
  optionId: OptionId;
  kind: 'booking' | 'block';
  source: string;
  occasion: string;
  notes: string;
  totalPaise: number;
  amountPaidPaise: number;
  method: 'gateway' | 'qr' | null;
  createdAt: string;
};

type Payment = {
  id: number;
  method: 'gateway' | 'qr';
  state: string;
  amountPaise: number;
  merchantOrderId: string | null;
  gatewayOrderId: string | null;
  gatewayTransactionId: string | null;
  paymentMode: string | null;
  errorCode: string | null;
  utr: string | null;
  createdAt: string;
  updatedAt: string;
};

type Detail = Row & {
  roomId: OptionId;
  guestEmail: string;
  guestMessage: string;
  lines: { label: string; amountPaise: number }[];
  payNowPaise: number;
  holdExpiresAt: string | null;
  payments: Payment[];
  refunds: { id: number; paymentId: number; method: string; merchantRefundId: string; amountPaise: number; state: string; note: string; createdAt: string }[];
  history: { at: string; actor: string; action: string; details: string }[];
};

const PAYMENT_STATE_TONE: Record<string, 'neutral' | 'success' | 'warn' | 'danger'> = {
  created: 'neutral',
  pending: 'warn',
  completed: 'success',
  verified: 'success',
  submitted: 'warn',
  failed: 'danger',
  rejected: 'danger',
};

type Action =
  | { kind: 'verify' | 'reject'; payment: Payment }
  | { kind: 'refund'; payment: Payment; max: number }
  | { kind: 'cancel' }
  | { kind: 'clear' };

const ACTION_COPY: Record<Action['kind'], { title: string; button: string; danger?: boolean; help: string }> = {
  verify: { title: 'Verify QR payment', button: 'Mark verified & confirm booking', help: 'Only verify after you find this UTR and the exact amount in your PhonePe Business app / bank statement.' },
  reject: { title: 'Reject QR payment', button: 'Reject & cancel booking', danger: true, help: 'Use when the UTR or amount can’t be found. The booking is cancelled and the room released.' },
  refund: { title: 'Refund payment', button: 'Refund', danger: true, help: 'Gateway payments are refunded through PhonePe. For QR payments, refund in your PhonePe Business app first, then record it here.' },
  cancel: { title: 'Cancel booking', button: 'Cancel booking', danger: true, help: 'Releases the room for these dates so they can be booked again. Paid online bookings will be flagged for refund.' },
  clear: { title: 'Mark issue resolved', button: 'Mark resolved', help: 'Clears the “needs attention” flag. Describe what you did.' },
};

export function BookingDrawer({ refId, onClose, onEdit }: { refId: string; onClose: () => void; onEdit: (init: FormInit) => void }) {
  const { call, version } = useAdmin();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, !action, onClose);

  const load = useCallback(() => {
    call<Detail>(`/bookings/${refId}`)
      .then(setD)
      .catch((e) => setError((e as Error).message));
  }, [refId, call]);
  useEffect(load, [load, version.bookings]);
  const online = d?.source === 'website_online';
  const block = d?.kind === 'block';

  const refresh = async () => {
    setBusy(true);
    try {
      await call(`/bookings/${refId}/refresh`, { method: 'POST', body: {} });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={block ? `Blocked dates ${refId}` : `Booking ${refId}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">{block ? 'Blocked dates' : 'Booking'}</p>
            <p className="text-[20px] font-bold tracking-[0.04em]">{refId}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-card" data-autofocus>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
          {!d ? (
            !error && (
              <p className="flex justify-center gap-2 py-16 text-muted">
                <Spinner /> Loading…
              </p>
            )
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-1.5">
                {block ? <Chip tone={d.status === 'cancelled' ? 'danger' : 'neutral'}>{d.status === 'cancelled' ? 'Removed' : 'Blocked'}</Chip> : <BookingChip status={d.status} />}
                {online && <PaymentChip status={d.paymentStatus} />}
                <Chip>{SOURCE_LABEL[d.source] ?? d.source}</Chip>
              </div>

              {d.status !== 'cancelled' && (
                <div className="flex flex-wrap gap-2">
                  {!online && (
                    <button
                      className="btn btn-outline h-12 gap-2 px-5 text-[16px]"
                      onClick={() =>
                        onEdit({
                          ref: d.ref,
                          kind: d.kind,
                          optionId: d.roomId,
                          checkIn: d.checkIn,
                          checkOut: d.checkOut,
                          guestName: d.guestName,
                          guestPhone: d.guestPhone,
                          guests: d.guests,
                          occasion: d.occasion,
                          source: d.source,
                          notes: d.notes,
                        })
                      }
                    >
                      <Pencil size={17} aria-hidden="true" /> Edit
                    </button>
                  )}
                  {!block && d.whatsapp && d.status === 'confirmed' && (
                    <a
                      className="btn btn-dark h-12 gap-2 px-5 text-[16px]"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={waUrl(d.whatsapp, confirmationMessage({ name: d.guestName, optionName: d.roomName, checkIn: d.checkIn, checkOut: d.checkOut, guests: d.guests }))}
                    >
                      <MessageCircle size={17} aria-hidden="true" /> WhatsApp confirmation
                    </a>
                  )}
                  {!block && d.whatsapp && (
                    <a className="btn btn-outline h-12 gap-2 px-5 text-[16px]" href={`tel:+${d.whatsapp}`}>
                      <Phone size={17} aria-hidden="true" /> Call
                    </a>
                  )}
                </div>
              )}
              {d.needsAttention && (
                <Alert tone="danger" title="Needs attention">
                  {d.needsAttention}{' '}
                  <button className="link-underline font-semibold" onClick={() => setAction({ kind: 'clear' })}>
                    Mark resolved
                  </button>
                </Alert>
              )}

              {!block && (
                <Section title="Guest">
                  <KV k="Name" v={d.guestName} />
                  <KV k="Phone" v={d.guestPhone ? <a className="link-underline" href={`tel:+${d.whatsapp}`}>{d.guestPhone}</a> : '—'} />
                  {d.guestEmail && <KV k="Email" v={<a className="link-underline break-all" href={`mailto:${d.guestEmail}`}>{d.guestEmail}</a>} />}
                  {d.guestMessage && <KV k="Message" v={d.guestMessage} />}
                </Section>
              )}

              <Section title={block ? 'Blocked' : 'Stay'}>
                <KV k={block ? 'What' : 'Room'} v={d.roomName} />
                <KV k="Dates" v={`${formatISODate(d.checkIn)} → ${formatISODate(d.checkOut)} (${nightsLabel(d.nights)})`} />
                {!block && <KV k="Guests" v={String(d.guests)} />}
                {d.occasion && <KV k="Occasion" v={d.occasion} />}
                {d.notes && <KV k={block ? 'Reason' : 'Notes'} v={d.notes} />}
                <KV k={block ? 'Added' : 'Booked'} v={when(d.createdAt)} />
                {d.holdExpiresAt && <KV k="Hold until" v={when(d.holdExpiresAt)} />}
              </Section>

              {online && (
              <>
              <Section title="Amounts">
                {d.lines.map((l) => (
                  <KV key={l.label} k={l.label} v={formatPaise(l.amountPaise)} />
                ))}
                <KV k="Total" v={<strong>{formatPaise(d.totalPaise)}</strong>} />
                <KV k="Amount paid (net of refunds)" v={<strong>{formatPaise(d.amountPaidPaise)}</strong>} />
              </Section>

              <Section
                title="Payments"
                action={
                  d.payments.some((p) => p.method === 'gateway') || d.refunds.some((r) => r.state === 'pending') ? (
                    <button onClick={refresh} disabled={busy} className="flex items-center gap-1.5 text-[12.5px] font-semibold link-underline">
                      {busy ? <Spinner size={13} /> : <RefreshCw size={13} aria-hidden="true" />} Check with PhonePe
                    </button>
                  ) : undefined
                }
              >
                {d.payments.length === 0 && <p className="text-[13px] text-muted">No payment attempts yet.</p>}
                <ul className="space-y-2.5">
                  {d.payments.map((p) => {
                    const refunded = d.refunds.filter((r) => r.paymentId === p.id && r.state !== 'failed').reduce((s, r) => s + r.amountPaise, 0);
                    return (
                      <li key={p.id} className="rounded-[14px] border border-hairline p-3.5 text-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold">
                            {p.method === 'qr' ? 'QR / UPI' : 'PhonePe gateway'} · {formatPaise(p.amountPaise)}
                          </span>
                          <Chip tone={PAYMENT_STATE_TONE[p.state] ?? 'neutral'}>{p.state}</Chip>
                        </div>
                        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
                          {p.method === 'qr' && <><dt className="text-muted">UTR</dt><dd className="font-semibold tabular-nums">{p.utr ?? 'not given'}</dd></>}
                          {p.merchantOrderId && <><dt className="text-muted">Order ID</dt><dd className="break-all">{p.merchantOrderId}</dd></>}
                          {p.gatewayTransactionId && <><dt className="text-muted">Transaction</dt><dd className="break-all">{p.gatewayTransactionId}</dd></>}
                          {p.paymentMode && <><dt className="text-muted">Mode</dt><dd>{p.paymentMode}</dd></>}
                          {p.errorCode && <><dt className="text-muted">Error</dt><dd>{p.errorCode}</dd></>}
                          <dt className="text-muted">Updated</dt>
                          <dd>{when(p.updatedAt)}</dd>
                          {refunded > 0 && <><dt className="text-muted">Refunded</dt><dd>{formatPaise(refunded)}</dd></>}
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {p.method === 'qr' && p.state === 'submitted' && (
                            <>
                              <button className="btn btn-dark h-9 px-4 text-[13px]" onClick={() => setAction({ kind: 'verify', payment: p })}>
                                Verify payment
                              </button>
                              <button className="btn btn-outline h-9 px-4 text-[13px]" onClick={() => setAction({ kind: 'reject', payment: p })}>
                                Reject
                              </button>
                            </>
                          )}
                          {(p.state === 'completed' || p.state === 'verified') && p.amountPaise - refunded >= 100 && (
                            <button className="btn btn-outline h-9 px-4 text-[13px]" onClick={() => setAction({ kind: 'refund', payment: p, max: p.amountPaise - refunded })}>
                              Refund…
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {d.refunds.length > 0 && (
                  <ul className="mt-3 space-y-1.5 text-[12.5px]">
                    {d.refunds.map((r) => (
                      <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-[10px] bg-card px-3 py-2">
                        <span>
                          Refund {formatPaise(r.amountPaise)} · {r.method} · {when(r.createdAt)}
                        </span>
                        <Chip tone={r.state === 'completed' ? 'success' : r.state === 'failed' ? 'danger' : 'warn'}>{r.state}</Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              </>
              )}

              {d.status !== 'cancelled' && (
                <button className="btn btn-outline h-12 px-5 text-[16px] text-[#a3261b] !border-[#e3b4ae]" onClick={() => setAction({ kind: 'cancel' })}>
                  {block ? 'Remove block…' : 'Cancel booking…'}
                </button>
              )}

              <Section title="History">
                <ol className="space-y-2 border-l border-hairline pl-4 text-[12.5px]">
                  {d.history.map((h, i) => (
                    <li key={i}>
                      <p>
                        <span className="font-semibold">{h.action}</span> <span className="text-muted">· {h.actor} · {when(h.at)}</span>
                      </p>
                      {h.details !== '{}' && <p className="break-all text-muted">{h.details}</p>}
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          )}
        </div>
      </div>

      {action && d && (
        <ActionDialog
          action={action}
          bookingRef={d.ref}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ActionDialog({ action, bookingRef, onClose, onDone }: { action: Action; bookingRef: string; onClose: () => void; onDone: () => void }) {
  const { call } = useAdmin();
  const copy = ACTION_COPY[action.kind];
  const [note, setNote] = useState(action.kind === 'cancel' ? 'Cancelled by owner' : '');
  const [amount, setAmount] = useState(action.kind === 'refund' ? String(action.max / 100) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useModal(ref, true, onClose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const path = { verify: 'verify-qr', reject: 'reject-qr', refund: 'refund', cancel: 'cancel', clear: 'clear-attention' }[action.kind];
    const body: Record<string, unknown> = { note };
    if ('payment' in action) body.paymentId = action.payment.id;
    if (action.kind === 'refund') body.amount = Number(amount);
    try {
      await call(`/bookings/${bookingRef}/${path}`, { method: 'POST', body });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <form ref={ref} onSubmit={submit} role="dialog" aria-modal="true" aria-label={copy.title} className="relative w-full max-w-[460px] rounded-[22px] bg-white p-6 shadow-2xl">
        <h2 className="text-[19px] font-semibold">{copy.title}</h2>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-muted">{copy.help}</p>
        {'payment' in action && (
          <p className="mt-3 rounded-[12px] bg-card px-3 py-2 text-[13px]">
            {action.payment.method === 'qr' ? (action.payment.utr ? `UTR ${action.payment.utr}` : 'No UTR given — look for the booking ID in the payment note') : action.payment.merchantOrderId} · {formatPaise(action.payment.amountPaise)}
          </p>
        )}
        <div className="mt-4 space-y-4">
          {action.kind === 'refund' && (
            <Field id="act-amount" label={`Amount (₹, up to ${formatPaise(action.max)})`}>
              <input id="act-amount" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          )}
          <Field id="act-note" label="Note for the audit log">
            <textarea
              id="act-note"
              className="field h-auto min-h-[84px] py-3"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={action.kind === 'verify' ? 'e.g. Found ₹3,198 from Riya on 14 Nov in PhonePe Business app' : 'What happened and why'}
              data-autofocus
            />
          </Field>
        </div>
        {error && (
          <div className="mt-4">
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-outline h-10 px-4 text-[13.5px]">
            Back
          </button>
          <button disabled={busy || note.trim().length < 3} className={`btn h-10 px-4 text-[13.5px] text-white disabled:opacity-50 ${copy.danger ? 'bg-[#a3261b] hover:bg-[#8a1f16]' : 'btn-dark'}`}>
            {busy ? <Spinner label="Working" /> : copy.button}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-3 text-[13.5px]">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  );
}
