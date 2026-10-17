// Month calendar: one row of markers per room, tap a day to see or add
// bookings, "Select range" (or long-press) to add a multi-night booking.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { UNITS, UNIT_LABEL, type Unit } from '../../shared/catalog.ts';
import { todayInIndia } from '../../shared/validate.ts';
import { Alert, Spinner } from '../components/ui';
import { addDaysISO, addMonths, formatISODate, monthStart, monthTitle, nightsLabel, useAdmin, weekdayMon, type CalBooking, type CalRequest, type CalendarResponse } from './lib';

type Filter = 'all' | Unit;
type DayInfo = { bookings: CalBooking[]; requests: CalRequest[] };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarView({
  onOpenBooking,
  onNewBooking,
}: {
  onOpenBooking: (ref: string) => void;
  onNewBooking: (init: { checkIn: string; checkOut: string }) => void;
}) {
  const { call, version } = useAdmin();
  const [month, setMonth] = useState(() => monthStart(todayInIndia()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>(() => {
    try {
      return (localStorage.getItem('gs-admin-unit') as Filter) || 'all';
    } catch {
      return 'all';
    }
  });
  const [range, setRange] = useState<{ on: boolean; start: string | null }>({ on: false, start: null });
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('gs-admin-unit', filter);
    } catch {
      /* private mode */
    }
  }, [filter]);

  const shown = month;
  const [loadedMonth, setLoadedMonth] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    call<CalendarResponse>(`/calendar?from=${month}&to=${addMonths(month, 1)}`, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setLoadedMonth(month);
        setError('');
      })
      .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message));
    return () => ctrl.abort();
  }, [month, version.bookings, version.requests, call]);

  const units: Unit[] = filter === 'all' ? [...UNITS] : [filter];
  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    if (!data || loadedMonth !== shown) return map;
    const next = addMonths(shown, 1);
    for (let d = shown; d < next; d = addDaysISO(d, 1)) {
      map.set(d, {
        bookings: data.bookings.filter((b) => b.checkIn <= d && d < b.checkOut && b.units.some((u) => units.includes(u))),
        requests: data.requests.filter((r) => r.checkIn <= d && d < r.checkOut && r.units.some((u) => units.includes(u))),
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loadedMonth, filter]);

  const go = (n: number) => setMonth((m) => addMonths(m, n));
  const today = data?.today ?? todayInIndia();

  // Swipe left/right to change month.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  // Long-press a day to start a range from it.
  const press = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const startPress = (d: string) => {
    longPressed.current = false;
    press.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(20);
      setRange({ on: true, start: d });
    }, 550);
  };
  const endPress = () => window.clearTimeout(press.current);

  const tap = (d: string) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (range.on) {
      if (!range.start || d <= range.start) return setRange({ on: true, start: d });
      onNewBooking({ checkIn: range.start, checkOut: d });
      return setRange({ on: false, start: null });
    }
    const info = byDay.get(d);
    if (!info || (info.bookings.length === 0 && info.requests.length === 0)) return onNewBooking({ checkIn: d, checkOut: addDaysISO(d, 1) });
    if (info.bookings.length === 1 && info.requests.length === 0) return onOpenBooking(info.bookings[0].ref);
    setDay(d);
  };

  const cells: (string | null)[] = [];
  if (shown) {
    for (let i = 0; i < weekdayMon(shown); i++) cells.push(null);
    for (let d = shown; d < addMonths(shown, 1); d = addDaysISO(d, 1)) cells.push(d);
  }

  const inRange = (d: string) => range.on && range.start !== null && d >= range.start;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-[-0.01em]">{shown ? monthTitle(shown) : 'Calendar'}</h1>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(monthStart(today))} className="h-11 rounded-full border border-hairline px-4 text-[15px] font-semibold hover:border-ink">
            Today
          </button>
          <button onClick={() => go(-1)} aria-label="Previous month" className="grid size-11 place-items-center rounded-full border border-hairline hover:border-ink">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button onClick={() => go(1)} aria-label="Next month" className="grid size-11 place-items-center rounded-full border border-hairline hover:border-ink">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show room" className="flex rounded-full bg-card p-1">
          {(['all', ...UNITS] as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`h-10 rounded-full px-4 text-[15px] font-semibold ${filter === f ? 'bg-white shadow-sm' : 'text-muted'}`}
            >
              {f === 'all' ? 'Both rooms' : UNIT_LABEL[f]}
            </button>
          ))}
        </div>
        <button
          aria-pressed={range.on}
          onClick={() => setRange((r) => ({ on: !r.on, start: null }))}
          className={`flex h-12 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold ${range.on ? 'border-ink bg-ink text-white' : 'border-hairline hover:border-ink'}`}
        >
          <CalendarRange size={18} aria-hidden="true" /> {range.on ? 'Cancel range' : 'Select range'}
        </button>
      </div>

      {range.on && (
        <p className="mt-3 rounded-[12px] bg-[#fbf0dc] px-4 py-3 text-[15px] text-[#7a4f00]" role="status">
          {range.start ? `Check-in ${formatISODate(range.start)}. Now tap the check-out day.` : 'Tap the check-in day, then the check-out day.'}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        </div>
      )}

      <div className="mt-4 select-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grid grid-cols-7 text-center text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted" aria-hidden="true">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1.5">
              {w}
            </span>
          ))}
        </div>
        {!data || loadedMonth !== shown ? (
          <p className="flex justify-center gap-2 py-24 text-muted">
            <Spinner /> Loading…
          </p>
        ) : (
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label={shown ? monthTitle(shown) : undefined}>
            {cells.map((d, i) =>
              d === null ? (
                <span key={`pad-${i}`} />
              ) : (
                <DayCell
                  key={d}
                  date={d}
                  info={byDay.get(d)!}
                  units={units}
                  isToday={d === today}
                  isPast={d < today}
                  selected={inRange(d) && d === range.start}
                  onClick={() => tap(d)}
                  onPressStart={() => startPress(d)}
                  onPressEnd={endPress}
                />
              ),
            )}
          </div>
        )}
      </div>

      <Legend showUnits={filter === 'all'} />

      {data && loadedMonth === shown && <MonthList data={data} month={shown} units={units} onOpen={onOpenBooking} />}

      {day && byDay.get(day) && (
        <DaySheet
          date={day}
          info={byDay.get(day)!}
          freeUnits={units.filter((u) => !byDay.get(day)!.bookings.some((b) => b.units.includes(u)))}
          onClose={() => setDay(null)}
          onOpen={(ref) => {
            setDay(null);
            onOpenBooking(ref);
          }}
          onNew={() => {
            setDay(null);
            onNewBooking({ checkIn: day, checkOut: addDaysISO(day, 1) });
          }}
        />
      )}
    </div>
  );
}

function marker(info: DayInfo, unit: Unit): 'booked' | 'block' | 'pending' | 'request' | null {
  const b = info.bookings.find((x) => x.units.includes(unit));
  if (b) return b.state;
  return info.requests.some((r) => r.units.includes(unit)) ? 'request' : null;
}

const MARKER_CLS = {
  booked: 'bg-taupe',
  block: 'bg-[#a8a29c]',
  pending: 'border-2 border-dashed border-taupe',
  request: 'border-2 border-taupe',
} as const;
const MARKER_TEXT = { booked: 'booked', block: 'blocked', pending: 'awaiting payment', request: 'enquiry pending' } as const;

function DayCell({
  date,
  info,
  units,
  isToday,
  isPast,
  selected,
  onClick,
  onPressStart,
  onPressEnd,
}: {
  date: string;
  info: DayInfo;
  units: Unit[];
  isToday: boolean;
  isPast: boolean;
  selected: boolean;
  onClick: () => void;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  const marks = units.map((u) => [u, marker(info, u)] as const);
  const label = `${formatISODate(date)}${isToday ? ' (today)' : ''}: ${marks.map(([u, m]) => `${UNIT_LABEL[u]} ${m ? MARKER_TEXT[m] : 'free'}`).join(', ')}`;
  return (
    <button
      role="gridcell"
      data-date={date}
      aria-label={label}
      aria-selected={selected || undefined}
      onClick={onClick}
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onPointerCancel={onPressEnd}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex min-h-[64px] flex-col items-stretch rounded-[10px] border p-1 text-left md:min-h-[86px] md:p-1.5 ${
        selected ? 'border-ink ring-2 ring-ink' : isToday ? 'border-ink' : 'border-hairline'
      } ${isPast ? 'bg-cream/60 text-muted' : 'bg-white'} hover:border-ink`}
    >
      <span className={`text-[15px] font-semibold leading-none md:text-[16px] ${isToday ? 'text-ink' : ''}`}>{+date.slice(8)}</span>
      <span className="mt-auto flex flex-col gap-1">
        {marks.map(([u, m]) => (
          <span key={u} className={`flex h-[14px] items-center overflow-hidden rounded-[4px] md:h-[18px] ${m ? MARKER_CLS[m] : ''}`} aria-hidden="true">
            {units.length > 1 && <span className={`hidden px-1 text-[10.5px] md:inline font-bold leading-none ${m === 'booked' ? 'text-white' : m === 'block' ? 'text-white' : 'text-muted'}`}>{UNIT_LABEL[u]}</span>}
          </span>
        ))}
      </span>
    </button>
  );
}

function Legend({ showUnits }: { showUnits: boolean }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px]" aria-label="Legend">
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded-[4px] bg-taupe" aria-hidden="true" /> Booked
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded-[4px] bg-[#a8a29c]" aria-hidden="true" /> Blocked
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded-[4px] border-2 border-taupe" aria-hidden="true" /> Enquiry pending
      </li>
      <li className="flex items-center gap-2">
        <span className="h-4 w-6 rounded-[4px] border-2 border-dashed border-taupe" aria-hidden="true" /> Awaiting payment
      </li>
      {showUnits && <li className="text-muted">Top bar: AC 1BHK · bottom bar: Non-AC 1BHK</li>}
    </ul>
  );
}

function MonthList({ data, month, units, onOpen }: { data: CalendarResponse; month: string; units: Unit[]; onOpen: (ref: string) => void }) {
  const next = addMonths(month, 1);
  const items = data.bookings.filter((b) => b.checkIn < next && b.checkOut > month && b.units.some((u) => units.includes(u)));
  if (items.length === 0) return <p className="mt-6 text-[15px] text-muted">Nothing booked this month yet. Tap a day to add a booking.</p>;
  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">This month</h2>
      <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-[16px] border border-hairline">
        {items.map((b) => (
          <li key={b.ref}>
            <button onClick={() => onOpen(b.ref)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-cream">
              <span className={`h-9 w-1.5 shrink-0 rounded-full ${MARKER_CLS[b.state]}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{b.guestName}</span>
                <span className="block text-[14px] text-muted">
                  {b.optionName} · {formatISODate(b.checkIn)} → {formatISODate(b.checkOut)}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DaySheet({ date, info, freeUnits, onClose, onOpen, onNew }: { date: string; info: DayInfo; freeUnits: Unit[]; onClose: () => void; onOpen: (ref: string) => void; onNew: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={formatISODate(date)}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-[520px] rounded-t-[22px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl md:rounded-[22px]">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold">{formatISODate(date)}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full bg-card" autoFocus>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {info.bookings.map((b) => (
            <li key={b.ref}>
              <button onClick={() => onOpen(b.ref)} className="flex w-full items-center gap-3 rounded-[14px] border border-hairline px-4 py-3 text-left hover:border-ink">
                <span className={`h-8 w-1.5 rounded-full ${MARKER_CLS[b.state]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold">{b.guestName}</span>
                  <span className="block text-[14px] text-muted">
                    {b.optionName} · {nightsLabel(Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86_400_000))}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {info.requests.map((r) => (
            <li key={`r${r.id}`} className="flex items-center gap-3 rounded-[14px] border-2 border-taupe px-4 py-3 text-[15px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.guestName}</span>
                <span className="block text-[14px] text-muted">Enquiry pending — see Requests</span>
              </span>
            </li>
          ))}
        </ul>
        {freeUnits.length > 0 && (
          <button onClick={onNew} className="btn btn-dark mt-4 h-12 w-full gap-2 text-[16px]">
            <Plus size={18} aria-hidden="true" /> New booking from this day
          </button>
        )}
      </div>
    </div>
  );
}
