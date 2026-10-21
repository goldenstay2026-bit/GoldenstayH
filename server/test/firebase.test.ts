import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authAs, startHarness, type Harness } from './helpers.ts';

describe('guest sign-in (Firebase Auth) is required to book', () => {
  let h: Harness;
  before(async () => (h = await startHarness()));
  after(() => h.close());

  test('no sign-in → 401 SIGNIN_REQUIRED', async () => {
    const r = await h.book({}, {});
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'SIGNIN_REQUIRED');
  });

  test('invalid or expired ID token → 401', async () => {
    const r = await h.book({}, { Authorization: 'Bearer not-a-real-token' });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'BAD_ID_TOKEN');
  });

  test('email comes from the verified account, not the form', async () => {
    const r = await h.book({ checkIn: '2026-11-01', checkOut: '2026-11-02', email: 'someone-else@example.com' }, authAs('u-amit', 'Amit@Example.com'));
    assert.equal(r.status, 201);
    const row = await h.byRef(r.json.booking.ref);
    assert.equal(row.guest_email, 'amit@example.com');
    assert.equal(row.user_uid, 'u-amit');
  });

  test('account without a valid email is rejected', async () => {
    const r = await h.book({ checkIn: '2026-11-03', checkOut: '2026-11-04' }, authAs('u-x', 'not-an-email'));
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'INVALID_EMAIL');
  });

  test('the signed-in owner can open their booking without the link token; others cannot', async () => {
    const b = await h.book({ checkIn: '2026-11-10', checkOut: '2026-11-12' }, authAs('u-owner', 'owner@example.com'));
    const ref = b.json.booking.ref;
    assert.equal((await h.api('GET', `/api/bookings/${ref}`, undefined, authAs('u-owner', 'owner@example.com'))).status, 200);
    assert.equal((await h.api('GET', `/api/bookings/${ref}`, undefined, authAs('u-stranger', 's@example.com'))).status, 404);
    assert.equal((await h.api('GET', `/api/bookings/${ref}`)).status, 404);
    // The private link still works without signing in (e.g. on another device).
    assert.equal((await h.api('GET', `/api/bookings/${ref}`, undefined, h.guest(b.json.token))).status, 200);
    // Owner can submit a QR reference while signed in.
    const qr = await h.api('POST', `/api/bookings/${ref}/pay/qr`, { utr: '812345678901' }, authAs('u-owner', 'owner@example.com'));
    assert.equal(qr.json.status, 'pending_verification');
  });

  test('/api/me/bookings lists only the signed-in guest’s bookings', async () => {
    await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-01', checkOut: '2026-12-02' }, authAs('u-meera', 'meera@example.com'));
    await h.book({ roomId: '2bhk', checkIn: '2026-12-05', checkOut: '2026-12-06' }, authAs('u-meera', 'meera@example.com'));
    await h.book({ roomId: 'ac-1bhk', checkIn: '2026-12-05', checkOut: '2026-12-06' }, authAs('u-other', 'o@example.com')).catch(() => undefined);
    const mine = await h.api('GET', '/api/me/bookings', undefined, authAs('u-meera', 'meera@example.com'));
    assert.equal(mine.status, 200);
    assert.equal(mine.json.length, 2);
    assert.deepEqual(mine.json.map((b: { roomId: string }) => b.roomId), ['2bhk', 'nonac-1bhk']);
    assert.ok(mine.json.every((b: Record<string, unknown>) => !('token' in b) && !('guestPhone' in b)));
    assert.equal((await h.api('GET', '/api/me/bookings')).status, 401);
  });

  test('bookings are copied to Firestore (users/{uid}/bookings/{ref}) after each change', async () => {
    h.mirror.length = 0;
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-01-10', checkOut: '2027-01-12' }, authAs('u-sync', 'sync@example.com'));
    await h.settle();
    const ref = b.json.booking.ref;
    let copy = h.mirror.filter((m) => m.ref === ref).at(-1)!;
    assert.equal(copy.uid, 'u-sync');
    assert.equal(copy.data.status, 'pending_payment');
    assert.equal(copy.data.totalPaise, 259_800);
    assert.ok(!('token' in copy.data) && !('guestPhone' in copy.data), 'no secrets or contact data in the copy');

    await h.api('POST', `/api/bookings/${ref}/pay/qr`, { utr: '912345678901' }, h.guest(b.json.token));
    await h.login();
    const d = await h.api('GET', `/api/admin/bookings/${ref}`);
    assert.equal(d.json.userUid, 'u-sync');
    await h.api('POST', `/api/admin/bookings/${ref}/verify-qr`, { paymentId: d.json.payments[0].id, note: 'Found in PhonePe app' });
    await h.settle();
    copy = h.mirror.filter((m) => m.ref === ref).at(-1)!;
    assert.equal(copy.data.status, 'confirmed');
    assert.equal(copy.data.paymentStatus, 'successful');
    assert.equal(copy.data.amountPaidPaise, 259_800);
    h.clearCookie();
  });

  test('a rejected (double-booked) attempt is never copied to Firestore', async () => {
    await h.book({ roomId: 'ac-1bhk', checkIn: '2027-02-01', checkOut: '2027-02-03' }, authAs('u-first', 'first@example.com'));
    await h.settle();
    h.mirror.length = 0;
    const clash = await h.book({ roomId: '2bhk', checkIn: '2027-02-02', checkOut: '2027-02-04' }, authAs('u-second', 'second@example.com'));
    assert.equal(clash.status, 409);
    await h.settle();
    assert.equal(h.mirror.filter((m) => m.uid === 'u-second').length, 0);
  });
});

describe('Firebase not configured', () => {
  let h: Harness;
  before(async () => (h = await startHarness({ firebase: false })));
  after(() => h.close());

  test('online booking is refused with a clear 503', async () => {
    const r = await h.book();
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'SIGNIN_NOT_CONFIGURED');
  });

  test('enquiries and quotes still work without Firebase', async () => {
    const q = await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 2 });
    assert.equal(q.status, 200);
  });
});
