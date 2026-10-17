import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Users } from 'lucide-react';
import { formatPaise, isRoomId, type RoomId } from '../../shared/catalog.ts';
import type { BookingView, PublicRoom, Quote } from '../../shared/types.ts';
import {
  MAX_GUESTS,
  addDaysISO,
  checkStayDates,
  formatISODate,
  normaliseIndianMobile,
  todayInIndia,
} from '../../shared/validate.ts';
import { Img } from '../components/Img';
import { Alert, Field, PageShell, Panel, Spinner } from '../components/ui';
import { rooms as siteRooms } from '../data/site';
import { ApiError, api } from '../lib/api';
import { rememberBooking } from '../lib/bookingStore';
import { useAuth } from '../lib/auth';
import { AuthPanel } from '../components/AuthPanel';

type Details = { name: string; phone: string; message: string };
type Errors = Partial<Record<keyof Details | 'stay' | 'auth', string>>;

const params = new URLSearchParams(window.location.search);
const initialRoom = isRoomId(params.get('room')) ? (params.get('room') as RoomId) : 'ac-1bhk';
const initialGuests = Math.min(MAX_GUESTS, Math.max(1, Number(params.get('guests')) || 2));

export function Checkout() {
  const today = todayInIndia();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [roomId, setRoomId] = useState<RoomId>(initialRoom);
  const [checkIn, setCheckIn] = useState(params.get('in') ?? '');
  const [checkOut, setCheckOut] = useState(params.get('out') ?? '');
  const [guests, setGuests] = useState(initialGuests);
  const [details, setDetails] = useState<Details>({ name: '', phone: '', message: '' });
  const auth = useAuth();

  // Prefill from the guest's saved profile (Firestore) or account name.
  useEffect(() => {
    if (!auth.user) return;
    setErrors((e) => ({ ...e, auth: undefined, name: undefined, phone: undefined }));
    setDetails((d) => ({
      ...d,
      name: d.name || auth.profile?.name || auth.user?.displayName || '',
      phone: d.phone || auth.profile?.phone || '',
    }));
  }, [auth.user, auth.profile]);
  const [errors, setErrors] = useState<Errors>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    api<PublicRoom[]>('/rooms')
      .then(setRooms)
      .catch(() => setRooms([]));
  }, []);

  const dateProblem = checkIn && checkOut ? checkStayDates(checkIn, checkOut, today) : null;

  // Live quote from the server whenever room, dates or guests change. The
  // browser never computes the amount that will be charged.
  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!checkIn || !checkOut || dateProblem) {
      setQuoteState('idle');
      return;
    }
    const ctrl = new AbortController();
    setQuoteState('loading');
    const t = window.setTimeout(() => {
      api<Quote>('/quote', { method: 'POST', body: { roomId, checkIn, checkOut, guests }, signal: ctrl.signal })
        .then((q) => {
          setQuote(q);
          setQuoteState('idle');
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setQuoteError((e as Error).message);
          setQuoteState('error');
        });
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [roomId, checkIn, checkOut, guests, dateProblem]);

  const roomMeta = useMemo(() => siteRooms.find((r) => r.id === roomId)!, [roomId]);
  const liveRoom = rooms?.find((r) => r.id === roomId);

  const setDetail = (k: keyof Details, v: string) => {
    setDetails((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!checkIn || !checkOut) e.stay = 'Please choose your check-in and check-out dates.';
    else if (dateProblem) e.stay = dateProblem;
    else if (quote && !quote.available) e.stay = 'This room isn’t available for those dates. Please try other dates or another room.';
    // Name and phone are only shown (and checked) once the guest is signed in.
    if (!auth.user) {
      e.auth = 'Please sign in or create an account to book.';
      return e;
    }
    if (details.name.trim().length < 2) e.name = 'Please enter your full name.';
    if (!normaliseIndianMobile(details.phone)) e.phone = 'Enter a 10-digit Indian mobile number, e.g. +91 98765 43210.';
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setSubmitError('');
    const e = validate();
    setErrors(e);
    const first = (['stay', 'auth', 'name', 'phone'] as const).find((k) => e[k]);
    if (first) {
      document.getElementById(first === 'stay' ? 'bk-in' : first === 'auth' ? 'au-email' : `bk-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ token: string; booking: BookingView }>('/bookings', {
        method: 'POST',
        body: { roomId, checkIn, checkOut, guests, ...details },
        idToken: await auth.idToken(),
      });
      rememberBooking(res.booking.ref, res.token);
      // Save name + phone to the guest's Firestore profile for next time (never blocks the booking).
      const phone = normaliseIndianMobile(details.phone);
      if (phone) {
        await Promise.race([auth.saveProfile({ name: details.name, phone }).catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
      }
      window.location.assign(`/booking/?ref=${encodeURIComponent(res.booking.ref)}&t=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setSubmitting(false);
      const ae = err as ApiError;
      if (ae.field && ['name', 'phone'].includes(ae.field)) setErrors({ [ae.field]: ae.message });
      else if (ae.code === 'SIGNIN_REQUIRED' || ae.code === 'BAD_ID_TOKEN') setErrors({ auth: ae.message });
      else if (ae.field || ae.code === 'NOT_AVAILABLE') setErrors({ stay: ae.message });
      else setSubmitError(ae.message);
    }
  };

  const nightsLabel = quote ? `${quote.nights} ${quote.nights === 1 ? 'night' : 'nights'}` : '';

  return (
    <PageShell>
      <div className="mb-8 max-w-[640px]">
        <h1 className="heading h2">
          Book your <span className="accent">stay</span>
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted md:text-[15px]">
          Choose your room and dates, then pay securely to confirm. Your room is held while you complete the payment.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-[14px]">
          <Panel>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">1. Choose your room</h2>
            <fieldset className="mt-4">
              <legend className="sr-only">Room</legend>
              <div className="grid gap-2.5 md:grid-cols-3">
                {siteRooms.map((r) => {
                  const live = rooms?.find((x) => x.id === r.id);
                  const disabled = live ? !live.bookable : false;
                  const price = live ? live.pricePaise : (r.price ?? 0) * 100;
                  return (
                    <label
                      key={r.id}
                      className={`group relative flex cursor-pointer gap-3 rounded-[16px] border bg-white p-2.5 transition-colors md:flex-col md:gap-0 md:p-2 ${
                        roomId === r.id ? 'border-ink ring-1 ring-ink' : 'border-hairline hover:border-[#c9c2ba]'
                      } ${disabled ? 'cursor-not-allowed opacity-50' : ''} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2`}
                    >
                      <input
                        type="radio"
                        name="room"
                        value={r.id}
                        checked={roomId === r.id}
                        disabled={disabled}
                        onChange={() => setRoomId(r.id)}
                        className="sr-only"
                      />
                      <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-[12px] bg-beige md:w-full">
                        <Img name={r.image} alt="" sizes="(min-width: 641px) 220px, 96px" className="size-full object-cover" />
                      </div>
                      <div className="min-w-0 self-center md:px-1.5 md:pb-1 md:pt-3">
                        <p className="text-[14.5px] font-semibold leading-tight">{r.name}</p>
                        <p className="mt-1 text-[13px] text-muted">
                          <span className="font-semibold tabular-nums text-ink">{formatPaise(price)}</span> / night
                        </p>
                        {disabled && <p className="mt-1 text-[12px] font-medium text-[#a3261b]">Not bookable online</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </Panel>

          <Panel>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">2. Dates &amp; guests</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_0.7fr] [&>*]:min-w-0">
              <Field id="bk-in" label="Check-in">
                <input
                  id="bk-in"
                  type="date"
                  className="field"
                  min={today}
                  value={checkIn}
                  aria-invalid={errors.stay ? true : undefined}
                  aria-describedby={errors.stay ? 'stay-error' : undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCheckIn(v);
                    setErrors((x) => ({ ...x, stay: undefined }));
                    if (checkOut && v && checkOut <= v) setCheckOut(addDaysISO(v, 1));
                  }}
                />
              </Field>
              <Field id="bk-out" label="Check-out">
                <input
                  id="bk-out"
                  type="date"
                  className="field"
                  min={checkIn ? addDaysISO(checkIn, 1) : addDaysISO(today, 1)}
                  value={checkOut}
                  onChange={(e) => {
                    setCheckOut(e.target.value);
                    setErrors((x) => ({ ...x, stay: undefined }));
                  }}
                />
              </Field>
              <div className="col-span-2 md:col-span-1">
                <Field id="bk-guests" label="Guests">
                  <select id="bk-guests" className="field" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
                    {Array.from({ length: MAX_GUESTS }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'guest' : 'guests'}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div aria-live="polite" className="mt-3 min-h-[1.5em] text-[13px]">
              {(errors.stay || dateProblem) && (
                <p id="stay-error" className="font-medium text-[#b42318]">
                  {errors.stay ?? dateProblem}
                </p>
              )}
              {!errors.stay && !dateProblem && quoteState === 'loading' && (
                <p className="flex items-center gap-2 text-muted">
                  <Spinner size={14} /> Checking availability…
                </p>
              )}
              {!errors.stay && !dateProblem && quoteState === 'error' && <p className="font-medium text-[#b42318]">{quoteError}</p>}
              {!errors.stay && quote && (quote.available ? (
                <p className="font-medium text-[#24603a]">Available for your dates.</p>
              ) : (
                <p className="font-medium text-[#b42318]">Not available for these dates — please try other dates or another room.</p>
              ))}
            </div>
          </Panel>

          <Panel>
            {!auth.ready ? (
              <p className="flex items-center gap-2 text-[13.5px] text-muted" role="status">
                <Spinner size={14} /> Checking your sign-in…
              </p>
            ) : !auth.user ? (
              <>
                <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Step 3 of 3</p>
                <AuthPanel intro="You need a Golden Stay account to book online. It keeps your bookings in one place." />
                {errors.auth && (
                  <p className="mt-3 text-[12.5px] font-medium text-[#b42318]" role="alert">
                    {errors.auth}
                  </p>
                )}
              </>
            ) : (
            <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">3. Your details</h2>
              <p className="text-[12.5px] text-muted">
                Signed in as <span className="font-semibold text-ink">{auth.user.email}</span> ·{' '}
                <button type="button" className="link-underline" onClick={() => void auth.signOut()}>
                  Sign out
                </button>
              </p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
              <div className="md:col-span-2">
                <Field id="bk-name" label="Full name" error={errors.name}>
                  <input
                    id="bk-name"
                    className="field"
                    autoComplete="name"
                    value={details.name}
                    onChange={(e) => setDetail('name', e.target.value)}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? 'bk-name-error' : undefined}
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
              <Field id="bk-phone" label="Phone / WhatsApp" error={errors.phone}>
                <input
                  id="bk-phone"
                  className="field"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91"
                  value={details.phone}
                  onChange={(e) => setDetail('phone', e.target.value)}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? 'bk-phone-error' : undefined}
                />
              </Field>
              </div>
              <div className="md:col-span-2">
                <Field id="bk-message" label="Message" optional>
                  <textarea
                    id="bk-message"
                    className="field h-auto min-h-[84px] resize-y py-3 leading-[1.5]"
                    maxLength={500}
                    placeholder="Arrival time, special requests…"
                    value={details.message}
                    onChange={(e) => setDetail('message', e.target.value)}
                  />
                </Field>
              </div>
            </div>
            </>
            )}
          </Panel>
        </div>

        {/* Summary — sticky on desktop */}
        <aside aria-label="Booking summary" className="lg:sticky lg:top-6">
          <Panel className="bg-cream">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-beige">
              <Img name={roomMeta.image} alt={roomMeta.alt} sizes="(min-width: 1101px) 420px, 100vw" className="size-full object-cover" />
            </div>
            <h2 className="heading mt-4 text-[26px] leading-tight">{roomMeta.name}</h2>
            <dl className="mt-3 space-y-2 text-[13.5px]">
              <div className="flex items-center gap-2 text-muted">
                <CalendarDays size={15} aria-hidden="true" />
                <dt className="sr-only">Dates</dt>
                <dd>
                  {checkIn && checkOut && !dateProblem ? (
                    <>
                      <span className="text-ink">{formatISODate(checkIn)}</span> → <span className="text-ink">{formatISODate(checkOut)}</span>
                      {nightsLabel && <> · {nightsLabel}</>}
                    </>
                  ) : (
                    'Choose your dates'
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-2 text-muted">
                <Users size={15} aria-hidden="true" />
                <dt className="sr-only">Guests</dt>
                <dd className="text-ink">
                  {guests} {guests === 1 ? 'guest' : 'guests'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 border-t border-hairline pt-4">
              {quote ? (
                <>
                  <ul className="space-y-1.5 text-[13.5px]">
                    {quote.lines.map((l) => (
                      <li key={l.label} className="flex justify-between gap-4">
                        <span className="text-muted">{l.label}</span>
                        <span className="tabular-nums">{formatPaise(l.amountPaise)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-3">
                    <span className="text-[14px] font-semibold">Total to pay</span>
                    <span className="text-[24px] font-bold tabular-nums tracking-[-0.02em]">{formatPaise(quote.payNowPaise)}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">No booking fees are added. Final amount is confirmed by our server.</p>
                </>
              ) : (
                <p className="text-[13.5px] text-muted">
                  {liveRoom ? (
                    <>
                      <span className="font-semibold tabular-nums text-ink">{formatPaise(liveRoom.pricePaise)}</span> per night. Choose dates to see your total.
                    </>
                  ) : (
                    'Choose dates to see your total.'
                  )}
                </p>
              )}
            </div>

            {submitError && (
              <div className="mt-4">
                <Alert tone="danger" role="alert" title="Couldn’t create your booking">
                  {submitError}
                </Alert>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || quoteState === 'loading' || (quote !== null && !quote.available)}
              className="btn btn-dark mt-5 h-[52px] w-full text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Spinner label="Creating your booking" /> Holding your room…
                </>
              ) : (
                <>
                  Continue to payment <ArrowRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
            <p className="mt-2.5 text-center text-[11.5px] leading-[1.5] text-muted">
              Your booking is confirmed only after payment is verified.
            </p>
          </Panel>
        </aside>
      </form>
    </PageShell>
  );
}
