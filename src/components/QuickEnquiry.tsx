import { useId, useState, type FormEvent } from 'react';
import { DEFAULT_GUESTS, GUEST_OPTIONS } from '../data/site';
import { todayISO } from '../lib/enquiry';
import { DateRangeField, dateText } from './DateRangeField';
import { useToday } from '../lib/useToday';
import { useEnquiry } from '../lib/EnquiryContext';

const rowCls = 'flex items-center justify-between gap-3 py-[7px]';
const labelCls = 'shrink-0 text-[13px] font-semibold text-ink';
const inputCls =
  'min-w-0 rounded-md bg-transparent text-right text-[16px] text-ink md:text-[13px] [&::-webkit-date-and-time-value]:text-right';

/** Hero "Check in / Check out / Guests" card — prefills the main enquiry form. */
export function QuickEnquiry() {
  const { prefill } = useEnquiry();
  const id = useId();
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(String(DEFAULT_GUESTS));
  const [error, setError] = useState('');

  const today = useToday();


  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (checkIn && checkIn < todayISO()) return setError('Check-in can’t be in the past.');
    if (checkIn && checkOut && checkOut <= checkIn) return setError('Check-out must be after check-in.');
    setError('');
    // Book Now → online booking with the chosen dates and guests.
    window.location.href = bookHref;
  };
  const bookHref = `/book/?${new URLSearchParams({ ...(checkIn && { in: checkIn }), ...(checkOut && { out: checkOut }), guests }).toString()}`;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Book your stay"
      className="flex flex-col justify-center rounded-[22px] bg-card px-4 py-3.5 lg:px-[18px]"
    >
      <DateRangeField
        idIn={`${id}-in`}
        idOut={`${id}-out`}
        option="any"
        checkIn={checkIn}
        checkOut={checkOut}
        today={today}
        onChange={(ci, co) => {
          setCheckIn(ci);
          setCheckOut(co);
          setError('');
        }}
      >
        {(open, expanded) =>
          (['in', 'out'] as const).map((k) => (
            <div key={k} className={rowCls}>
              <span id={`${id}-${k}-label`} className={labelCls}>
                {k === 'in' ? 'Check In' : 'Check Out'}
              </span>
              <button
                type="button"
                id={`${id}-${k}`}
                aria-labelledby={`${id}-${k}-label ${id}-${k}`}
                aria-haspopup="dialog"
                aria-expanded={expanded}
                onClick={open}
                disabled={!today}
                className={`${inputCls} ${(k === 'in' ? checkIn : checkOut) ? '' : 'text-muted'}`}
              >
                {dateText(k === 'in' ? checkIn : checkOut, 'Add date')}
              </button>
            </div>
          ))
        }
      </DateRangeField>
      <div className={rowCls}>
        <label htmlFor={`${id}-guests`} className={labelCls}>
          Guests
        </label>
        <select
          id={`${id}-guests`}
          className="select-bare rounded-md bg-transparent pr-5 text-right text-[16px] text-ink md:text-[13px]"
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
        >
          {GUEST_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'Guest' : 'Guests'}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="pt-1 text-[12px] font-medium text-[#b42318]">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-dark mt-2.5 h-11 w-full text-[13.5px]">
        Book Now
      </button>
      <p className="mt-2 text-center text-[11px] text-muted">
        Prefer to ask first?{' '}
        <button type="button" onClick={() => prefill({ checkIn, checkOut, guests })} className="link-underline font-semibold text-ink">
          Enquire on WhatsApp
        </button>
      </p>
    </form>
  );
}
