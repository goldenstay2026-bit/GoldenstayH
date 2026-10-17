import { useEffect, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import { formatISODate } from '../../shared/validate.ts';
import { Alert, Field, PageShell, Panel, Spinner } from '../components/ui';
import { api } from '../lib/api';

type Info = {
  ref: string;
  bookingStatus: string;
  paymentState: 'submitted' | 'verified' | 'rejected';
  amountPaise: number;
  utr: string | null;
  paidAt: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  needsAttention: string | null;
};

const token = new URLSearchParams(window.location.search).get('t') ?? '';
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Owner page opened from the "Payment to verify" email: Confirm or Reject. */
export function ConfirmPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'confirmed' | 'rejected' | null>(null);

  const load = () =>
    api<Info>(`/owner-action/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    // Keep the private link out of the address bar / history once loaded.
    if (token) {
      load();
      window.history.replaceState(null, '', '/confirm/');
    } else setError('This link is incomplete. Please use the button in the email.');
  }, []);

  const act = async (decision: 'confirm' | 'reject') => {
    setBusy(decision);
    setError('');
    try {
      await api(`/owner-action/${encodeURIComponent(token)}`, { method: 'POST', body: { decision, reason } });
      setDone(decision === 'confirm' ? 'confirmed' : 'rejected');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell right={<span className="text-[13px] font-medium text-muted">Owner</span>}>
      <div className="mx-auto max-w-[560px]">
        <h1 className="heading h2">
          Confirm <span className="accent">booking</span>
        </h1>

        {error && (
          <div className="mt-6">
            <Alert tone="danger" role="alert" title="Can’t continue">
              {error}{' '}
              <a href="/admin/" className="link-underline font-semibold">
                Open the admin
              </a>
            </Alert>
          </div>
        )}

        {!info && !error && (
          <p className="mt-10 flex justify-center gap-2 text-muted" role="status">
            <Spinner /> Loading…
          </p>
        )}

        {info && (
          <>
            {done === 'confirmed' || info.paymentState === 'verified' ? (
              <div className="mt-6">
                <Alert tone="success" role="status" title={`Booking ${info.ref} is confirmed`}>
                  The guest sees it as confirmed, the Sheet is updated and a confirmation email is on its way to you.
                </Alert>
              </div>
            ) : done === 'rejected' || info.paymentState === 'rejected' ? (
              <div className="mt-6">
                <Alert tone="danger" role="status" title={`Payment rejected — booking ${info.ref} cancelled`}>
                  The room is free again for these dates.
                </Alert>
              </div>
            ) : (
              <p className="mt-3 text-[14.5px] leading-[1.6] text-muted">
                <strong className="text-ink">{info.guestName}</strong> says they’ve paid <strong className="text-ink">{formatPaise(info.amountPaise)}</strong>. Check
                your PhonePe Business app for this payment, then confirm.
              </p>
            )}

            <Panel className="mt-6">
              <dl className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-x-4 gap-y-2.5 text-[14px]">
                <dt className="text-muted">Amount to check</dt>
                <dd className="text-[20px] font-bold tabular-nums">{formatPaise(info.amountPaise)}</dd>
                <dt className="text-muted">UPI reference</dt>
                <dd className="font-semibold tabular-nums">{info.utr ?? <span className="font-normal text-muted">Not given — look for “{info.ref}” in the payment note</span>}</dd>
                <dt className="text-muted">Booking ID</dt>
                <dd className="font-semibold">{info.ref}</dd>
                <dt className="text-muted">Guest</dt>
                <dd>
                  {info.guestName}
                  <br />
                  <a className="link-underline" href={`tel:${info.guestPhone.replace(/\s/g, '')}`}>
                    {info.guestPhone}
                  </a>{' '}
                  · <span className="break-all">{info.guestEmail}</span>
                </dd>
                <dt className="text-muted">Stay</dt>
                <dd>
                  {info.roomName}
                  <br />
                  {formatISODate(info.checkIn)} → {formatISODate(info.checkOut)} · {info.nights} {info.nights === 1 ? 'night' : 'nights'} · {info.guests}{' '}
                  {info.guests === 1 ? 'guest' : 'guests'}
                </dd>
                <dt className="text-muted">Guest says paid</dt>
                <dd>{when(info.paidAt)}</dd>
              </dl>
              {info.needsAttention && (
                <div className="mt-4">
                  <Alert tone="warn" title="Needs attention">
                    {info.needsAttention}
                  </Alert>
                </div>
              )}
            </Panel>

            {info.paymentState === 'submitted' && !done && (
              <div className="mt-6 space-y-3">
                {!rejecting ? (
                  <>
                    <button type="button" onClick={() => act('confirm')} disabled={busy !== null} className="btn btn-dark h-[54px] w-full text-[15.5px] disabled:opacity-60">
                      {busy === 'confirm' ? <Spinner label="Confirming" /> : <CircleCheck size={18} aria-hidden="true" />}
                      I’ve received {formatPaise(info.amountPaise)} — Confirm booking
                    </button>
                    <button type="button" onClick={() => setRejecting(true)} className="btn btn-outline h-12 w-full text-[14px]">
                      <CircleX size={17} aria-hidden="true" /> Payment not found — Reject
                    </button>
                  </>
                ) : (
                  <Panel className="bg-cream">
                    <Field id="reason" label="Reason" optional>
                      <input id="reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No payment received" />
                    </Field>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => setRejecting(false)} className="btn btn-outline h-11 flex-1 text-[14px]">
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => act('reject')}
                        disabled={busy !== null}
                        className="btn h-11 flex-1 bg-[#a3261b] text-[14px] text-white hover:bg-[#8a1f16] disabled:opacity-60"
                      >
                        {busy === 'reject' ? <Spinner label="Rejecting" /> : 'Reject & cancel booking'}
                      </button>
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
