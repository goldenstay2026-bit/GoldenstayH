import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from '../lib/router';
import { CircleCheck, Send } from 'lucide-react';
import { DATES_TAKEN_MESSAGE, monthsBetween, rangeHitsBooked, refreshAvailability, useBookedNights } from '../lib/availability';
import { CalendarIcon, DateRangeField, dateText } from './DateRangeField';
import {
  BOOKING_TYPE_OPTION,
  ENQUIRY_BOOKING_TYPES,
  GROUP_MAX_GUESTS,
  HONEYPOT_FIELD,
  isGroupBooking,
  type EnquiryBookingType,
} from '../../shared/validate.ts';
import { ANY_ROOM, ANY_ROOM_LABEL, business, GUEST_OPTIONS, roomLabel, rooms } from '../data/site';
import {
  buildMessage,
  validate,
  waLink,
  type EnquiryErrors,
  type EnquiryValues,
} from '../lib/enquiry';
import { ENQUIRY_FIRST_FIELD_ID, ENQUIRY_FORM_ID, useEnquiry } from '../lib/EnquiryContext';
import { ApiError, api } from '../lib/api';
import { useToday } from '../lib/useToday';
import { WhatsAppIcon } from './icons';
import { Alert, Spinner } from './ui';

type Field = keyof EnquiryValues;
const FIELD_ORDER: Field[] = ['bookingType', 'name', 'phone', 'checkIn', 'checkOut', 'guests', 'room', 'occasion'];
const GROUP_GUEST_OPTIONS = Array.from({ length: GROUP_MAX_GUESTS }, (_, i) => i + 1);
const fieldId = (f: Field) => (f === 'name' ? ENQUIRY_FIRST_FIELD_ID : `enq-${f}`);

function Row({
  field,
  label,
  error,
  optional,
  children,
}: {
  field: Field;
  label: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={fieldId(field)} className="mb-1.5 block text-[12.5px] font-semibold text-ink">
        {label}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${fieldId(field)}-error`} className="mt-1.5 text-[12px] font-medium text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Carries whatever the guest already chose over to the online checkout. */
function bookHref(v: EnquiryValues) {
  const q = new URLSearchParams();
  if (v.room && v.room !== ANY_ROOM) q.set('room', v.room);
  if (v.checkIn) q.set('in', v.checkIn);
  if (v.checkOut) q.set('out', v.checkOut);
  if (v.guests) q.set('guests', v.guests);
  const qs = q.toString();
  return `/book/${qs ? `?${qs}` : ''}`;
}

export function EnquiryForm() {
  const { values, setValues } = useEnquiry();
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState('');
  // Errors the server reported for specific fields (it re-validates everything).
  const [serverErrors, setServerErrors] = useState<EnquiryErrors>({});
  // Honeypot: hidden from people; bots that fill every field reveal themselves.
  const [honeypot, setHoneypot] = useState('');
  const successRef = useRef<HTMLDivElement>(null);

  const today = useToday();
  // Fresh availability each time the guest opens the Contact tab.
  const { route } = useRouter();
  useEffect(() => {
    if (route === 'contact') refreshAvailability();
  }, [route]);
  const group = isGroupBooking(values.bookingType);
  // Which nights are taken for what the guest is asking for.
  const availabilityOption = group ? 'entire' : values.room || 'any';
  const rangeChosen = Boolean(values.checkIn && values.checkOut && values.checkOut > values.checkIn);
  const { booked } = useBookedNights(rangeChosen ? availabilityOption : null, rangeChosen ? monthsBetween(values.checkIn, values.checkOut) : []);
  const datesTaken = rangeChosen && rangeHitsBooked(values.checkIn, values.checkOut, booked);
  const errors: EnquiryErrors = {
    ...validate(values, today || undefined),
    ...(datesTaken ? { checkIn: DATES_TAKEN_MESSAGE } : {}),
    ...serverErrors,
  };
  const shown = (f: Field) => (submitted || touched[f] ? errors[f] : undefined);
  const whatsappUrl = waLink(buildMessage(values));

  const set = (f: Field, v: string) => {
    if (status === 'error') setStatus('idle');
    if (serverErrors[f]) setServerErrors((e) => ({ ...e, [f]: undefined }));
    setValues((prev) => {
      const next = { ...prev, [f]: v };
      // Keep check-out valid when check-in moves past it.
      if (f === 'checkIn' && next.checkOut && v && next.checkOut <= v) next.checkOut = '';
      if (f === 'checkIn' || f === 'checkOut') setServerErrors((e) => ({ ...e, checkIn: undefined, checkOut: undefined }));
      // Room stays allow up to 8 guests; bring a larger group count back into range.
      if (f === 'bookingType' && v === 'room' && Number(next.guests) > 8) next.guests = '8';
      return next;
    });
  };

  const a11y = (f: Field) => ({
    id: fieldId(f),
    name: f,
    'aria-invalid': shown(f) ? true : undefined,
    'aria-describedby': shown(f) ? `${fieldId(f)}-error` : undefined,
    onBlur: () => setTouched((t) => ({ ...t, [f]: true })),
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setSubmitted(true);
    const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    setStatus('sending');
    setSendError('');
    // Open the WhatsApp tab now, while we still have the click (popup blockers),
    // and point it at WhatsApp once the request is saved.
    const tab = window.open('', '_blank');
    const openWhatsApp = () => {
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = whatsappUrl;
      }
      setStatus('sent');
      window.setTimeout(() => successRef.current?.focus(), 0);
    };
    try {
      await api<{ ok: true }>('/enquiry', {
        method: 'POST',
        body: { ...values, guests: Number(values.guests), [HONEYPOT_FIELD]: honeypot },
      });
      openWhatsApp();
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'DATES_TAKEN' || (ae.status === 400 && ae.field && (FIELD_ORDER as string[]).includes(ae.field))) {
        // Dates just got booked, or the server disagreed with a field: show it inline, no WhatsApp.
        tab?.close();
        const field = (ae.code === 'DATES_TAKEN' ? 'checkIn' : ae.field) as Field;
        setServerErrors({ [field]: ae.code === 'DATES_TAKEN' ? DATES_TAKEN_MESSAGE : ae.message });
        if (ae.code === 'DATES_TAKEN') refreshAvailability();
        setStatus('idle');
        document.getElementById(fieldId(field))?.focus();
        return;
      }
      if (ae.status === 429) {
        tab?.close();
        setSendError(ae.message);
        setStatus('error');
        return;
      }
      // Network or server trouble: the WhatsApp message still reaches Golden Stay.
      console.error('[enquiry] could not save the request; continuing on WhatsApp:', ae.message);
      openWhatsApp();
    }
  };

  const startOver = () => {
    setValues((v) => ({ ...v, checkIn: '', checkOut: '', message: '' }));
    setSubmitted(false);
    setTouched({});
    setStatus('idle');
  };

  if (status === 'sent') {
    return (
      <div id={ENQUIRY_FORM_ID} className="flex flex-col justify-center rounded-[22px] bg-cream p-6 md:p-9">
        <div ref={successRef} tabIndex={-1} role="status" className="outline-none">
          <span className="grid size-12 place-items-center rounded-full bg-ink text-white">
            <CircleCheck size={24} aria-hidden="true" />
          </span>
          <h3 className="heading mt-5 text-[30px] leading-tight md:text-[34px]">
            Request <span className="accent">received.</span>
          </h3>
          <p className="mt-3 text-[14px] leading-[1.6] text-muted">
            Request received and WhatsApp opened. Send the message to complete your enquiry. Your booking is confirmed only when Golden Stay replies.
          </p>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn btn-dark mt-5 h-12 w-full text-[14.5px] md:w-auto md:px-6">
            <WhatsAppIcon size={17} /> WhatsApp didn’t open? Tap here
          </a>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={startOver} className="btn btn-outline h-11 px-5 text-[14px]">
              Send another enquiry
            </button>
            <a href={business.phone.tel} className="btn h-11 px-5 text-[14px] text-ink hover:bg-card">
              Call {business.phone.display}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id={ENQUIRY_FORM_ID} className="rounded-[22px] bg-cream p-5 md:p-7">
      <form onSubmit={onSubmit} noValidate aria-label="Enquiry form" aria-busy={status === 'sending'} className="relative space-y-4">
        {/* Honeypot: visually hidden and skipped by keyboard and screen readers. Leave empty. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
          <label htmlFor="enq-website">Website (leave blank)</label>
          <input
            id="enq-website"
            name={HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <Row field="bookingType" label="Booking type">
          <select
            {...a11y('bookingType')}
            className="field"
            value={values.bookingType}
            onChange={(e) => set('bookingType', e.target.value as EnquiryBookingType)}
          >
            {ENQUIRY_BOOKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {BOOKING_TYPE_OPTION[t]}
              </option>
            ))}
          </select>
        </Row>

        <Row field="name" label="Full name" error={shown('name')}>
          <input
            {...a11y('name')}
            className="field"
            type="text"
            autoComplete="name"
            placeholder="Your full name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            required
          />
        </Row>

        <Row field="phone" label="Phone / WhatsApp" error={shown('phone')}>
          <input
            {...a11y('phone')}
            className="field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            required
          />
        </Row>

        <DateRangeField
          idIn={fieldId('checkIn')}
          idOut={fieldId('checkOut')}
          option={availabilityOption}
          checkIn={values.checkIn}
          checkOut={values.checkOut}
          today={today}
          onChange={(ci, co) => {
            set('checkIn', ci);
            set('checkOut', co);
          }}
          onClose={() => setTouched((t) => ({ ...t, checkIn: true, checkOut: true }))}
        >
          {(open, expanded) => (
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              {(['checkIn', 'checkOut'] as const).map((f) => (
                <Row key={f} field={f} label={f === 'checkIn' ? 'Check-in' : 'Check-out'} error={f === 'checkIn' ? shown('checkIn') : shown('checkOut')}>
                  <button
                    type="button"
                    id={fieldId(f)}
                    aria-haspopup="dialog"
                    aria-expanded={expanded}
                    aria-invalid={shown(f) ? true : undefined}
                    aria-describedby={shown(f) ? `${fieldId(f)}-error` : undefined}
                    onClick={open}
                    disabled={!today}
                    className={`field flex items-center justify-between gap-2 text-left ${values[f] ? '' : 'text-muted'}`}
                  >
                    <span className="truncate">{dateText(values[f], 'Choose date')}</span>
                    <CalendarIcon />
                  </button>
                </Row>
              ))}
            </div>
          )}
        </DateRangeField>

        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 md:grid-cols-2">
          <Row field="guests" label={group ? 'Approximate number of guests' : 'Guests'} error={shown('guests')}>
            <select
              {...a11y('guests')}
              className="field"
              value={values.guests}
              onChange={(e) => set('guests', e.target.value)}
              required
            >
              {(group ? GROUP_GUEST_OPTIONS : GUEST_OPTIONS).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Row>
          {group ? (
            <Row field="occasion" label="Occasion" optional error={shown('occasion')}>
              <input
                {...a11y('occasion')}
                className="field"
                type="text"
                maxLength={80}
                placeholder="e.g. Birthday, Family gathering"
                value={values.occasion}
                onChange={(e) => set('occasion', e.target.value)}
              />
            </Row>
          ) : (
          <Row field="room" label="Preferred room" error={shown('room')}>
            <select
              {...a11y('room')}
              className="field"
              value={values.room}
              onChange={(e) => set('room', e.target.value)}
              required
            >
              <option value="" disabled>
                Select a room
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {roomLabel(r)}
                </option>
              ))}
              <option value={ANY_ROOM}>{ANY_ROOM_LABEL}</option>
            </select>
          </Row>
          )}
        </div>

        <Row field="message" label="Message" optional>
          <textarea
            id={fieldId('message')}
            name="message"
            className="field h-auto min-h-[92px] resize-y py-3 leading-[1.5]"
            rows={3}
            placeholder="Arrival time, special requests…"
            value={values.message}
            onChange={(e) => set('message', e.target.value)}
          />
        </Row>

        <button
          type="submit"
          disabled={status === 'sending'}
          className="btn btn-dark h-[52px] w-full text-[15px] disabled:cursor-wait disabled:opacity-70"
        >
          {status === 'sending' ? (
            <>
              <Spinner size={17} label="Sending your enquiry" /> Sending…
            </>
          ) : (
            <>
              <Send size={16} aria-hidden="true" /> Send Enquiry
            </>
          )}
        </button>

        {group && (
          <p className="rounded-[12px] bg-white px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-ink/85">
            Parties and events are subject to approval. Golden Stay will confirm availability, price and any conditions.
          </p>
        )}

        <div aria-live="assertive">
          {status === 'error' && (
            <div className="space-y-3">
              <Alert tone="danger" role="alert" title="Enquiry not sent">
                {sendError}
              </Alert>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline h-12 w-full text-[14.5px]"
              >
                <WhatsAppIcon size={17} /> Send on WhatsApp instead
              </a>
            </div>
          )}
        </div>

        <div className="text-center text-[11.5px] leading-[1.6] text-muted">
          <p>We’ll reply on WhatsApp or by phone. This is an enquiry, not a confirmed booking — no payment needed.</p>
          <p className="mt-1">
            By sending an enquiry you agree to our{' '}
            <a href="#terms" className="link-underline text-ink">
              Terms
            </a>
            ,{' '}
            <a href="#house-rules" className="link-underline text-ink">
              House Rules
            </a>{' '}
            and{' '}
            <a href="#cancellation" className="link-underline text-ink">
              Cancellation Policy
            </a>
            .
          </p>
          <p className="mt-1">
            Prefer WhatsApp?{' '}
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="link-underline font-semibold text-ink">
              Send these details on WhatsApp
            </a>
          </p>
          <p className="mt-1">
            Prefer to call?{' '}
            <a href={business.altPhone.tel} className="link-underline font-semibold text-ink">
              {business.altPhone.display}
            </a>
          </p>
          <p className="mt-1">
            Ready to book now?{' '}
            <a href={bookHref(values)} className="link-underline font-semibold text-ink">
              Book &amp; pay online
            </a>
          </p>
        </div>
      </form>
    </div>
  );
}
