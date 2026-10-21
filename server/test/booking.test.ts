import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness()));
after(() => h.close());

describe('pricing (server-side, from the database)', () => {
  const cases = [
    { roomId: 'ac-1bhk', checkOut: '2026-10-21', nights: 1, total: 159_900 },
    { roomId: 'ac-1bhk', checkOut: '2026-10-23', nights: 3, total: 479_700 },
    { roomId: 'nonac-1bhk', checkOut: '2026-10-22', nights: 2, total: 259_800 },
    { roomId: 'nonac-1bhk', checkOut: '2026-10-27', nights: 7, total: 909_300 },
    { roomId: '2bhk', checkOut: '2026-10-21', nights: 1, total: 259_900 },
    { roomId: '2bhk', checkOut: '2026-10-25', nights: 5, total: 1_299_500 },
  ];
  for (const c of cases) {
    test(`${c.roomId} × ${c.nights} night(s) = ₹${c.total / 100}`, async () => {
      const r = await h.api('POST', '/api/quote', { roomId: c.roomId, checkIn: '2026-10-20', checkOut: c.checkOut, guests: 2 });
      assert.equal(r.status, 200);
      assert.equal(r.json.nights, c.nights);
      assert.equal(r.json.totalPaise, c.total);
      assert.equal(r.json.payNowPaise, c.total);
      assert.equal(r.json.available, true);
    });
  }

  test('client-supplied amounts are ignored', async () => {
    const r = await h.book({ checkIn: '2026-11-01', checkOut: '2026-11-03', amount: 1, totalPaise: 100, payNowPaise: 100, price: 1 });
    assert.equal(r.status, 201);
    assert.equal(r.json.booking.totalPaise, 319_800);
    assert.equal(r.json.booking.payNowPaise, 319_800);
  });

  test('admin price change is used for new quotes, but locked for existing bookings', async () => {
    const before = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-01', checkOut: '2026-12-02' });
    await h.login();
    const upd = await h.api('PUT', '/api/admin/rooms/nonac-1bhk', { price: 1399, note: 'Winter rate' });
    assert.equal(upd.status, 200);
    const q = await h.api('POST', '/api/quote', { roomId: 'nonac-1bhk', checkIn: '2026-12-05', checkOut: '2026-12-06', guests: 1 });
    assert.equal(q.json.totalPaise, 139_900);
    const view = await h.api('GET', `/api/bookings/${before.json.booking.ref}`, undefined, h.guest(before.json.token));
    assert.equal(view.json.totalPaise, 129_900);
    await h.api('PUT', '/api/admin/rooms/nonac-1bhk', { price: 1299, note: 'Back to published price' });
    h.clearCookie();
  });

  const invalid: [string, Record<string, unknown>, string][] = [
    ['check-in in the past', { checkIn: '2026-10-10', checkOut: '2026-10-12' }, 'INVALID_DATES'],
    ['check-out not after check-in', { checkIn: '2026-10-20', checkOut: '2026-10-20' }, 'INVALID_DATES'],
    ['impossible date', { checkIn: '2026-02-30', checkOut: '2026-03-02' }, 'INVALID_DATES'],
    ['more than 30 nights', { checkIn: '2026-10-20', checkOut: '2026-11-25' }, 'INVALID_DATES'],
    ['unknown room', { roomId: 'penthouse' }, 'INVALID_ROOM'],
    ['0 guests', { guests: 0 }, 'INVALID_GUESTS'],
    ['9 guests', { guests: 9 }, 'INVALID_GUESTS'],
    ['bad phone', { phone: '12345' }, 'INVALID_PHONE'],
    ['no name', { name: ' ' }, 'INVALID_NAME'],
  ];
  for (const [label, over, code] of invalid) {
    test(`rejects ${label}`, async () => {
      const r = await h.book(over);
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.equal(r.json.code, code);
    });
  }
});

describe('availability and double-booking protection', () => {
  test('a 1BHK booking blocks the same room and the 2BHK, not the other 1BHK', async () => {
    const a = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-01-10', checkOut: '2027-01-13' });
    assert.equal(a.status, 201);
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-01-12', checkOut: '2027-01-14' })).status, 409);
    assert.equal((await h.book({ roomId: '2bhk', checkIn: '2027-01-11', checkOut: '2027-01-12' })).status, 409);
    assert.equal((await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-01-10', checkOut: '2027-01-13' })).status, 201);
    const q = await h.api('POST', '/api/quote', { roomId: '2bhk', checkIn: '2027-01-12', checkOut: '2027-01-13', guests: 4 });
    assert.equal(q.json.available, false);
  });

  test('back-to-back stays are allowed (check-out day = next check-in)', async () => {
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-01-13', checkOut: '2027-01-15' })).status, 201);
  });

  test('a 2BHK booking blocks both 1BHKs', async () => {
    assert.equal((await h.book({ roomId: '2bhk', checkIn: '2027-02-01', checkOut: '2027-02-03' })).status, 201);
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-02-02', checkOut: '2027-02-04' })).status, 409);
    assert.equal((await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-01-31', checkOut: '2027-02-02' })).status, 409);
  });

  test('concurrent attempts for the same room and dates: exactly one succeeds', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => h.book({ roomId: 'nonac-1bhk', checkIn: '2027-03-05', checkOut: '2027-03-08', name: `Guest ${i}` })),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409]);
    const held = await h.night('nonac', '2027-03-06');
    assert.ok(held, 'exactly one booking holds the night (one document per room-night)');
  });

  test('an unpaid hold expires and frees the room', async () => {
    const a = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-04-01', checkOut: '2027-04-02' });
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-04-01', checkOut: '2027-04-02' })).status, 409);
    h.clock.ms += 31 * 60_000;
    const view = await h.api('GET', `/api/bookings/${a.json.booking.ref}`, undefined, h.guest(a.json.token));
    assert.equal(view.json.status, 'expired');
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-04-01', checkOut: '2027-04-02' })).status, 201);
  });

  test('guest booking access requires the private token', async () => {
    const a = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-05-01', checkOut: '2027-05-02' });
    assert.equal((await h.api('GET', `/api/bookings/${a.json.booking.ref}`)).status, 404);
    assert.equal((await h.api('GET', `/api/bookings/${a.json.booking.ref}`, undefined, h.guest('wrong'))).status, 404);
    const ok = await h.api('GET', `/api/bookings/${a.json.booking.ref}`, undefined, h.guest(a.json.token));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.guestName, 'Riya Sharma');
    assert.equal('guestPhone' in ok.json, false, 'guest view must not echo contact details');
  });

  test('guest can cancel an unpaid hold, which frees the room', async () => {
    const a = await h.book({ roomId: '2bhk', checkIn: '2027-06-01', checkOut: '2027-06-03' });
    const c = await h.api('POST', `/api/bookings/${a.json.booking.ref}/cancel`, {}, h.guest(a.json.token));
    assert.equal(c.json.status, 'cancelled');
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-06-01', checkOut: '2027-06-02' })).status, 201);
  });
});
