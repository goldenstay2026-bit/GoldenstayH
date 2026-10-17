// Public availability: which nights are already booked for a room (never who
// booked them). Fetched per visible month and cached, so moving between
// months or reopening the calendar doesn't refetch. Refreshed when the
// Contact tab opens.

import { useEffect, useState } from 'react';
import { addDays } from './enquiry';
import { api } from './api';

/** A room id, 'entire' (group bookings) or 'any' (= nights with no room free). */
export type AvailabilityOption = string;

const cache = new Map<string, Promise<string[]>>();
const listeners = new Set<() => void>();

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export function nextMonth(first: string) {
  const y = +first.slice(0, 4);
  const m = +first.slice(5, 7);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function loadMonth(option: AvailabilityOption, first: string): Promise<string[]> {
  const key = `${option}|${first}`;
  let p = cache.get(key);
  if (!p) {
    p = api<{ booked: string[] }>(`/availability?option=${encodeURIComponent(option)}&from=${first}&to=${nextMonth(first)}`)
      .then((r) => r.booked)
      .catch((e) => {
        cache.delete(key); // try again next time
        console.warn('[availability]', (e as Error).message);
        return [];
      });
    cache.set(key, p);
  }
  return p;
}

/** Forget cached months (e.g. when the Contact tab opens) and let open calendars refetch. */
export function refreshAvailability() {
  cache.clear();
  for (const l of listeners) l();
}

/** Booked nights for `option` across the given months (yyyy-mm-01). */
export function useBookedNights(option: AvailabilityOption | null, months: string[]) {
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const key = months.join(',');
  useEffect(() => {
    if (!option || months.length === 0) return setBooked(new Set());
    let live = true;
    setLoading(true);
    Promise.all(months.map((m) => loadMonth(option, monthStart(m)))).then((lists) => {
      if (!live) return;
      setBooked(new Set(lists.flat()));
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, key, tick]);
  return { booked, loading };
}

/** Months a stay touches, for checking a chosen range. */
export function monthsBetween(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(checkIn); m <= monthStart(addDays(checkOut, -1)); m = nextMonth(m)) out.push(m);
  return out;
}

/** True when any night of the stay (check-in … check-out − 1) is booked. */
export function rangeHitsBooked(checkIn: string, checkOut: string, booked: Set<string>) {
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) if (booked.has(d)) return true;
  return false;
}

export const DATES_TAKEN_MESSAGE = 'Some of these nights are already booked. Please choose different dates.';
export const AVAILABILITY_NOTE = 'Availability is updated by the host. Final confirmation is always by WhatsApp or phone.';

/** Which booking options are free for the whole stay (Rooms tab). */
export async function optionsAvailability(checkIn: string, checkOut: string) {
  return (await api<{ available: Record<string, boolean> }>(`/availability/options?checkIn=${checkIn}&checkOut=${checkOut}`)).available;
}
