import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Clock, Copy, MapPin, Phone, ShieldCheck, Users } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import type { BookingView, PublicConfig } from '../../shared/types.ts';
import { formatISODate } from '../../shared/validate.ts';
import { WhatsAppIcon } from '../components/icons';
import { UpiPay } from './UpiPay';
import { Alert, BookingChip, PageShell, Panel, PaymentChip, Spinner } from '../components/ui';
import { business } from '../data/site';
import { ApiError, api } from '../lib/api';
import { rememberBooking, savedToken } from '../lib/bookingStore';
import { waLink } from '../lib/enquiry';
import { useAuth } from '../lib/auth';
import { AuthPanel } from '../components/AuthPanel';

const params = new URLSearchParams(window.location.search);
const ref = (params.get('ref') ?? '').toUpperCase();
const token = params.get('t') ?? savedToken(ref) ?? '';

// Without the link token, the signed-in owner can still open their booking.
let idTokenFn: () => Promise<string | null> = async () => null;
/** Credentials for API calls: the private link token, else the guest's Firebase sign-in. */
const creds = async () => (token ? { token } : { idToken: await idTokenFn() });
const returning = params.get('return') === '1';

const POLL_MS = 3000;
const POLL_MAX = 20;

export function BookingPage() {
  const auth = useAuth();
  idTokenFn = auth.idToken;
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [checking, setChecking] = useState(returning);
  const polls = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    const b = await api<BookingView>(`/bookings/${encodeURIComponent(ref)}${refresh ? '?refresh=1' : ''}`, await creds());
    setBooking(b);
    return b;
  }, []);

  const needsSignIn = Boolean(ref) && !token && auth.ready && !auth.user;

  useEffect(() => {
    if (!ref) {
      setLoadError('This booking link is incomplete. Please use the full link from your booking.');
      return;
    }
    if (token) {
      rememberBooking(ref, token);
      // Keep the private link (so it can be bookmarked) but drop return=1 so a reload doesn't re-poll.
      window.history.replaceState(null, '', `/booking/?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(token)}`);
    } else if (!auth.ready || !auth.user) {
      return; // wait for sign-in (or show the sign-in panel)
    }
    api<PublicConfig>('/config').then(setConfig).catch(() => setConfig(null));
    load(returning).catch((e) => setLoadError((e as Error).message));
  }, [load, auth.ready, auth.user]);

  // After returning from PhonePe, poll until the payment settles (verified on the server).
  useEffect(() => {
    if (!checking || !booking) return;
    const settled = booking.status !== 'pending_payment' || booking.lastPayment?.state === 'failed' || booking.lastPayment?.state === 'completed';
    if (settled || polls.current >= POLL_MAX) {
      setChecking(false);
      return;
    }
    const t = window.setTimeout(() => {
      polls.current += 1;
      load(true).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [checking, booking, load]);

  if (loadError) {
    return (
      <PageShell>
        <div className="mx-auto max-w-[560px]">
          <Alert tone="danger" title="We couldn’t open this booking" role="alert">
            {loadError}{' '}
            <a className="link-underline font-semibold" href={waLink(`Hello Golden Stay, I need help with my booking ${ref}.`)} target="_blank" rel="noopener noreferrer">
              Contact us on WhatsApp
            </a>
          </Alert>
        </div>
      </PageShell>
    );
  }

  if (needsSignIn) {
    return (
      <PageShell>
        <div className="mx-auto max-w-[460px]">
          <Panel>
            <AuthPanel intro={`Sign in with the account you used to book ${ref}.`} />
          </Panel>
        </div>
      </PageShell>
    );
  }

  if (!booking) {
    return (
      <PageShell>
        <p className="flex items-center justify-center gap-2 py-24 text-muted" role="status">
          <Spinner label="Loading" /> Loading your booking…
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-[14px]">
          <StatusHeader booking={booking} checking={checking} />
          {booking.status === 'pending_payment' && !checking && (
            <PaymentOptions booking={booking} config={config} onUpdate={setBooking} />
          )}
        </div>
        <Summary booking={booking} />
      </div>
    </PageShell>
  );
}

function StatusHeader({ booking: b, checking }: { booking: BookingView; checking: boolean }) {
  const contact = waLink(`Hello Golden Stay, this is about my booking ${b.ref} (${b.roomName}, ${formatISODate(b.checkIn)} – ${formatISODate(b.checkOut)}).`);
  const contactLink = (
    <a className="link-underline font-semibold" href={contact} target="_blank" rel="noopener noreferrer">
      message us on WhatsApp
    </a>
  );

  if (checking) {
    return (
      <Panel>
        <p className="flex items-center gap-2.5 text-[15px] font-semibold" role="status">
          <Spinner label="Checking payment" /> Checking your payment with PhonePe…
        </p>
        <p className="mt-2 text-[13.5px] text-muted">This usually takes a few seconds. Please don’t close this page.</p>
      </Panel>
    );
  }

  switch (b.status) {
    case 'confirmed':
      return (
        <Panel className="bg-[#eef4ef]">
          <span className="grid size-11 place-items-center rounded-full bg-[#24603a] text-white">
            <Check size={22} aria-hidden="true" />
          </span>
          <h1 className="heading mt-4 text-[34px] leading-[1.05] md:text-[42px]">
            Booking <span className="accent">confirmed</span>
          </h1>
          <p className="mt-3 text-[14.5px] leading-[1.6] text-ink/80">
            Thank you, {b.guestName.split(' ')[0]}. Your payment has been verified and your stay at Golden Stay is confirmed. Keep your booking ID handy — you can return to this page any time from this browser.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={contact} target="_blank" rel="noopener noreferrer" className="btn btn-dark h-11 px-5 text-[14px]">
              <WhatsAppIcon size={16} /> Message Golden Stay
            </a>
            <a href={business.directionsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline h-11 px-5 text-[14px]">
              <MapPin size={15} aria-hidden="true" /> Directions
            </a>
          </div>
        </Panel>
      );
    case 'pending_verification':
      return (
        <Panel>
          <span className="grid size-11 place-items-center rounded-full bg-[#fbf0dc] text-[#7a4f00]">
            <Clock size={22} aria-hidden="true" />
          </span>
          <h1 className="heading mt-4 text-[32px] leading-[1.05] md:text-[38px]">
            Payment <span className="accent">submitted</span>
          </h1>
          <p className="mt-3 text-[14.5px] leading-[1.6] text-ink/80">
            Thanks{b.lastPayment?.reference ? (
              <>
                {' '}— we’ve received your UPI reference <strong className="tabular-nums">{b.lastPayment.reference}</strong>
              </>
            ) : null}
            . Golden Stay will check the payment and confirm your booking.
            <strong> Your booking is not confirmed yet.</strong> Your room stays reserved while we verify.
          </p>
          <p className="mt-3 text-[13.5px] text-muted">Questions? Call {business.phone.display} or {contactLink}.</p>
        </Panel>
      );
    case 'expired':
      return (
        <Panel>
          <h1 className="heading text-[30px] leading-[1.05]">This hold has expired</h1>
          {b.paymentStatus === 'successful' ? (
            <p className="mt-3 text-[14.5px] leading-[1.6]">
              We received your payment after the hold ended. Golden Stay will contact you to confirm your dates or arrange a refund — or {contactLink}.
            </p>
          ) : (
            <>
              <p className="mt-3 text-[14.5px] leading-[1.6] text-muted">No payment was taken. The room may still be free — start a new booking to try again.</p>
              <a
                href={`/book/?room=${b.roomId}&in=${b.checkIn}&out=${b.checkOut}&guests=${b.guests}`}
                className="btn btn-dark mt-5 h-11 px-5 text-[14px]"
              >
                Book again
              </a>
            </>
          )}
        </Panel>
      );
    case 'cancelled':
      return (
        <Panel>
          <h1 className="heading text-[30px] leading-[1.05]">This booking was cancelled</h1>
          <p className="mt-3 text-[14.5px] leading-[1.6] text-muted">
            {b.paymentStatus === 'failed' && b.lastPayment?.method === 'qr'
              ? 'We couldn’t match your payment reference to a payment in our account. If you did pay, please '
              : 'If you think this is a mistake, please '}
            {contactLink}.
          </p>
        </Panel>
      );
    default:
      return (
        <div>
          <h1 className="heading h2">
            Complete your <span className="accent">payment</span>
          </h1>
          <HoldNotice until={b.holdExpiresAt} />
          {b.paymentStatus === 'failed' && (
            <div className="mt-4">
              <Alert tone="danger" title="Your last payment didn’t go through" role="alert">
                No money was taken for that attempt. You can try again below.
              </Alert>
            </div>
          )}
          {b.lastPayment?.method === 'gateway' && b.lastPayment.state === 'pending' && (
            <div className="mt-4">
              <Alert tone="warn" title="Payment still processing">
                PhonePe hasn’t confirmed your last payment yet. If money left your account, don’t pay again — refresh this page in a minute.
              </Alert>
            </div>
          )}
        </div>
      );
  }
}

function HoldNotice({ until }: { until: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!until) return null;
  const mins = Math.max(0, Math.round((Date.parse(until) - Date.now()) / 60_000));
  const time = new Date(until).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return (
    <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
      <Clock size={15} aria-hidden="true" />
      Your room is held until <strong className="text-ink">{time}</strong> ({mins} min left).
    </p>
  );
}

function PaymentOptions({ booking, config, onUpdate }: { booking: BookingView; config: PublicConfig | null; onUpdate: (b: BookingView) => void }) {
  const gateway = config?.gatewayEnabled ?? false;
  return (
    <>
      {gateway && <GatewayPay booking={booking} />}
      {config && (
        <UpiPay
          booking={booking}
          config={config}
          secondary={gateway}
          onPaid={async (utr) => {
            onUpdate(await api<BookingView>(`/bookings/${encodeURIComponent(booking.ref)}/pay/qr`, { method: 'POST', body: { utr }, ...(await creds()) }));
            window.scrollTo({ top: 0 });
          }}
        />
      )}
      <CancelHold booking={booking} onUpdate={onUpdate} />
    </>
  );
}

function GatewayPay({ booking }: { booking: BookingView }) {
  const [state, setState] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState('');

  const pay = async () => {
    setError('');
    setState('loading');
    try {
      const res = await api<{ redirectUrl?: string; alreadyPaid?: boolean }>(`/bookings/${encodeURIComponent(booking.ref)}/pay/gateway`, {
        method: 'POST',
        body: {},
        ...(await creds()),
      });
      if (res.alreadyPaid) return window.location.reload();
      // Only ever redirect to PhonePe's own checkout host.
      const url = new URL(res.redirectUrl!);
      if (url.protocol !== 'https:' || !/(^|\.)phonepe\.com$/.test(url.hostname)) throw new ApiError(502, { error: 'Unexpected payment page. Please try again.' });
      window.location.assign(url.toString());
    } catch (e) {
      setState('idle');
      setError((e as Error).message);
    }
  };

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Pay online with PhonePe</h2>
          <p className="mt-1 text-[13.5px] text-muted">UPI, cards or net banking on PhonePe’s secure checkout. Confirmed instantly once PhonePe verifies the payment.</p>
        </div>
        <ShieldCheck size={22} className="shrink-0 text-taupe" aria-hidden="true" />
      </div>
      {error && (
        <div className="mt-4">
          <Alert tone="danger" role="alert" title="Payment couldn’t start">
            {error}
          </Alert>
        </div>
      )}
      <button type="button" onClick={pay} disabled={state === 'loading'} className="btn btn-dark mt-5 h-[52px] w-full text-[15px] disabled:opacity-60">
        {state === 'loading' ? (
          <>
            <Spinner label="Opening PhonePe" /> Opening PhonePe…
          </>
        ) : (
          <>Pay Now with PhonePe · {formatPaise(booking.payNowPaise)}</>
        )}
      </button>
    </Panel>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-field bg-white px-3 py-1.5 text-[12.5px] font-medium hover:border-ink"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CancelHold({ booking, onUpdate }: { booking: BookingView; onUpdate: (b: BookingView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="px-1 text-center text-[13px] text-muted">
      Changed your mind?{' '}
      <button
        type="button"
        disabled={busy}
        className="link-underline font-semibold text-ink"
        onClick={async () => {
          if (!window.confirm('Cancel this booking and release the room?')) return;
          setBusy(true);
          try {
            onUpdate(await api<BookingView>(`/bookings/${encodeURIComponent(booking.ref)}/cancel`, { method: 'POST', body: {}, ...(await creds()) }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Cancel this booking
      </button>
      {error && <p className="mt-1 text-[#b42318]">{error}</p>}
    </div>
  );
}

function Summary({ booking: b }: { booking: BookingView }) {
  return (
    <aside aria-label="Booking summary" className="lg:sticky lg:top-6">
      <Panel className="bg-cream">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Booking ID</p>
            <p className="mt-0.5 flex items-center gap-2 text-[20px] font-bold tracking-[0.04em]">
              {b.ref} <CopyButton text={b.ref} label="booking ID" />
            </p>
          </div>
          <BookingChip status={b.status} />
        </div>

        <h2 className="heading mt-5 text-[24px] leading-tight">{b.roomName}</h2>
        <dl className="mt-3 space-y-2 text-[13.5px]">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-muted" aria-hidden="true" />
            <dt className="sr-only">Dates</dt>
            <dd>
              {formatISODate(b.checkIn)} → {formatISODate(b.checkOut)} <span className="text-muted">· {b.nights} {b.nights === 1 ? 'night' : 'nights'}</span>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users size={15} className="text-muted" aria-hidden="true" />
            <dt className="sr-only">Guests</dt>
            <dd>
              {b.guests} {b.guests === 1 ? 'guest' : 'guests'} · {b.guestName}
            </dd>
          </div>
        </dl>

        <ul className="mt-5 space-y-1.5 border-t border-hairline pt-4 text-[13.5px]">
          {b.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-4">
              <span className="text-muted">{l.label}</span>
              <span className="tabular-nums">{formatPaise(l.amountPaise)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-3">
          <span className="text-[14px] font-semibold">Total</span>
          <span className="text-[22px] font-bold tabular-nums">{formatPaise(b.totalPaise)}</span>
        </div>
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Amount paid</dt>
            <dd className="font-semibold tabular-nums">{formatPaise(b.amountPaidPaise)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Payment status</dt>
            <dd>
              <PaymentChip status={b.paymentStatus} />
            </dd>
          </div>
          {b.lastPayment?.reference && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{b.lastPayment.method === 'qr' ? 'UPI reference' : 'Transaction ID'}</dt>
              <dd className="break-all text-right tabular-nums">{b.lastPayment.reference}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 border-t border-hairline pt-4 text-[12.5px] leading-[1.6] text-muted">
          <p className="flex items-start gap-2">
            <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {business.address.line1} {business.address.line2}, {business.address.city}
          </p>
          <p className="mt-1.5 flex items-center gap-2">
            <Phone size={14} aria-hidden="true" />
            <a href={business.phone.tel} className="link-underline">
              {business.phone.display}
            </a>
          </p>
          {b.status === 'confirmed' && <p className="mt-3">Need to change your dates? Contact us — changes depend on availability.</p>}
        </div>
      </Panel>
    </aside>
  );
}
