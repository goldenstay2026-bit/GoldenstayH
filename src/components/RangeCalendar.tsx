// The calendar inside the date-range dialog (lazy-loaded with react-day-picker).
// Booked nights are greyed out and can't be chosen as a night of the stay —
// but the first booked night after check-in can still be the check-out day.

import { useEffect, useMemo, useState } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import 'react-day-picker/style.css';
import { ENQUIRY_MAX_NIGHTS, formatISODate } from '../../shared/validate.ts';
import { AVAILABILITY_NOTE, nextMonth, useBookedNights } from '../lib/availability';
import { addDays } from '../lib/enquiry';

const toDate = (iso: string) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function RangeCalendar({
  option,
  checkIn,
  checkOut,
  today,
  onChange,
  onDone,
}: {
  option: string;
  checkIn: string;
  checkOut: string;
  today: string;
  onChange: (checkIn: string, checkOut: string) => void;
  onDone: () => void;
}) {
  const [twoUp, setTwoUp] = useState(() => window.matchMedia('(min-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 760px)');
    const on = () => setTwoUp(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const [month, setMonth] = useState(() => toDate(`${(checkIn || today).slice(0, 7)}-01`));
  const first = `${toISO(month).slice(0, 7)}-01`;
  const months = twoUp ? [first, nextMonth(first)] : [first];
  const { booked, loading } = useBookedNights(option, months);

  // Start picked, end not yet: the first booked night after it caps the stay (it can be the check-out day).
  const pending = checkIn && !checkOut ? checkIn : '';
  const cap = useMemo(() => {
    if (!pending) return '';
    const sorted = [...booked].filter((n) => n > pending).sort();
    const maxOut = addDays(pending, ENQUIRY_MAX_NIGHTS);
    return sorted[0] && sorted[0] < maxOut ? sorted[0] : maxOut;
  }, [pending, booked]);

  const disabled: Matcher = (date: Date) => {
    const d = toISO(date);
    if (d < today) return true;
    if (pending && d > pending) return d > cap;
    return booked.has(d);
  };

  const [error, setError] = useState('');
  const onDayClick = (date: Date, mods: { disabled?: boolean }) => {
    if (mods.disabled) return;
    const d = toISO(date);
    setError('');
    if (pending && d > pending) {
      onChange(pending, d);
      onDone();
      return;
    }
    if (booked.has(d)) return setError('That night is already booked.');
    onChange(d, '');
  };

  const status = !checkIn
    ? 'Choose your check-in date.'
    : !checkOut
      ? `Check-in ${formatISODate(checkIn)}. Now choose check-out.`
      : `${formatISODate(checkIn)} → ${formatISODate(checkOut)}`;

  return (
    <div className="gs-rdp">
      <DayPicker
        mode="range"
        selected={{ from: checkIn ? toDate(checkIn) : undefined, to: checkOut ? toDate(checkOut) : undefined }}
        onSelect={() => undefined}
        onDayClick={onDayClick}
        month={month}
        onMonthChange={setMonth}
        startMonth={toDate(`${today.slice(0, 7)}-01`)}
        endMonth={toDate(`${addDays(today, 720).slice(0, 7)}-01`)}
        numberOfMonths={twoUp ? 2 : 1}
        weekStartsOn={1}
        disabled={disabled}
        modifiers={{ booked: [...booked].map(toDate) }}
        modifiersClassNames={{ booked: 'gs-booked' }}
        labels={{
          labelDayButton: (date, mods) =>
            `${date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${mods.booked ? ', booked' : mods.disabled ? ', unavailable' : ', available'}${mods.selected ? ', selected' : ''}`,
        }}
      />
      <p className="mt-1 min-h-[20px] text-[13px] font-medium text-ink" aria-live="polite">
        {loading ? 'Checking availability…' : error || status}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="gs-legend-booked" aria-hidden="true">
            14
          </span>
          Booked
        </li>
        <li className="flex items-center gap-1.5">
          <span className="gs-legend-free" aria-hidden="true">
            14
          </span>
          Available
        </li>
      </ul>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">{AVAILABILITY_NOTE}</p>
    </div>
  );
}
