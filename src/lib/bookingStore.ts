// Remembers this browser's booking links so a guest who returns from PhonePe
// in a new tab (or reopens the site) can still reach their booking. Browser
// storage only — the server never relies on it.

const KEY = 'gs-bookings';
type Saved = Record<string, { t: string; at: number }>;

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

export function rememberBooking(ref: string, token: string) {
  try {
    const all = read();
    all[ref] = { t: token, at: Date.now() };
    // Keep the 10 most recent.
    const trimmed = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 10));
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable — the booking link still works */
  }
}

export function savedToken(ref: string): string | undefined {
  return read()[ref]?.t;
}
