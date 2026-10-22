import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { CLIENT_SECRET, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness()));
after(() => h.close());

describe('QR payment (Method B)', () => {
  test('the transaction reference (UTR) is required', async () => {
    const b = await h.book({ checkIn: '2026-10-27', checkOut: '2026-10-28' });
    for (const body of [{}, { utr: '' }, { utr: '   ' }]) {
      const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, body, h.guest(b.json.token));
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.code, 'UTR_REQUIRED');
    }
    assert.equal((await h.paymentsOf(b.json.booking.ref)).filter((p) => p.method === 'qr').length, 0, 'nothing recorded');
  });

  test('invalid transaction references are rejected', async () => {
    const b = await h.book({ checkIn: '2026-10-25', checkOut: '2026-10-26' });
    for (const utr of ['12345', 'ABCDEFGHIJKL', '1234567890123', 'T2410112233445566']) {
      const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr }, h.guest(b.json.token));
      assert.equal(r.status, 400, `utr=${utr}`);
      assert.equal(r.json.code, 'INVALID_UTR');
    }
  });

  test('a submitted UTR moves the booking to Pending Verification — NOT confirmed', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-10-25', checkOut: '2026-10-27' });
    const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '4123 4567 8901' }, h.guest(b.json.token));
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'pending_verification');
    assert.equal(r.json.paymentStatus, 'pending_verification');
    assert.equal(r.json.amountPaidPaise, 0);
    assert.equal(r.json.lastPayment.reference, '412345678901');
    // The hold no longer expires while waiting for the owner.
    h.clock.ms += 3 * 3600_000;
    const v = await h.api('GET', `/api/bookings/${b.json.booking.ref}`, undefined, h.guest(b.json.token));
    assert.equal(v.json.status, 'pending_verification');
  });

  test('the same UTR cannot be reused for another booking', async () => {
    const b = await h.book({ roomId: '2bhk', checkIn: '2026-11-01', checkOut: '2026-11-02' });
    const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '412345678901' }, h.guest(b.json.token));
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'UTR_USED');
  });
});

describe('admin', () => {
  test('admin API requires login; wrong password is refused', async () => {
    h.clearCookie();
    assert.equal((await h.api('GET', '/api/admin/bookings')).status, 401);
    assert.equal((await h.api('POST', '/api/admin/login', { password: 'nope' })).status, 401);
    assert.equal((await h.login()).status, 200);
    assert.equal((await h.api('GET', '/api/admin/bookings')).status, 200);
  });

  test('verifying a QR payment confirms the booking and is audit-logged with the note', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2026-11-15', checkOut: '2026-11-17' });
    await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '512345678901' }, h.guest(b.json.token));
    await h.login();
    const list = await h.api('GET', '/api/admin/bookings?filter=action');
    assert.ok(list.json.some((x: { ref: string }) => x.ref === b.json.booking.ref));
    const d = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
    const paymentId = d.json.payments[0].id;
    assert.equal((await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/verify-qr`, { paymentId, note: '' })).json.code, 'NOTE_REQUIRED');
    const ok = await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/verify-qr`, { paymentId, note: 'Matched ₹3,198 in PhonePe Business app' });
    assert.equal(ok.status, 200);
    const v = await h.api('GET', `/api/bookings/${b.json.booking.ref}`, undefined, h.guest(b.json.token));
    assert.equal(v.json.status, 'confirmed');
    assert.equal(v.json.amountPaidPaise, 319_800);
    const after = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
    const entry = after.json.history.find((x: { action: string }) => x.action === 'payment.qr_verified');
    assert.match(entry.details, /Matched/);
    assert.match(entry.actor, /^admin@/);
  });

  test('rejecting a QR payment cancels the booking and frees the room', async () => {
    const b = await h.book({ roomId: '2bhk', checkIn: '2026-12-05', checkOut: '2026-12-06' });
    await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '612345678901' }, h.guest(b.json.token));
    await h.login();
    const d = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
    await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/reject-qr`, { paymentId: d.json.payments[0].id, note: 'No such UTR in merchant app' });
    const v = await h.api('GET', `/api/bookings/${b.json.booking.ref}`, undefined, h.guest(b.json.token));
    assert.equal(v.json.status, 'cancelled');
    assert.equal(v.json.paymentStatus, 'failed');
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2026-12-05', checkOut: '2026-12-06' })).status, 201);
  });

  test('manual refund of a verified QR payment marks it Refunded', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-01-05', checkOut: '2027-01-06' });
    await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '712345678901' }, h.guest(b.json.token));
    await h.login();
    const d = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
    const paymentId = d.json.payments[0].id;
    await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/verify-qr`, { paymentId, note: 'Received' });
    await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/cancel`, { note: 'Guest changed plans' });
    const r = await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/refund`, { paymentId, amount: 1299, note: 'Refunded via PhonePe Business app' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const after = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
    assert.equal(after.json.paymentStatus, 'refunded');
    assert.equal(after.json.status, 'cancelled');
    assert.equal(after.json.needsAttention, null);
  });

  test('admin mutations reject non-JSON bodies (CSRF hardening)', async () => {
    await h.login();
    const r = await h.api('POST', '/api/admin/bookings/GSXXXXXX/cancel', undefined, { 'Content-Type': 'text/plain' });
    assert.equal(r.status, 415);
  });
});

describe('secrets', () => {
  test('public config exposes no credentials', async () => {
    const r = await h.api('GET', '/api/config');
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes(CLIENT_SECRET));
    assert.ok(!/secret|password|client_?id|webhook/i.test(text), text);
  });
});

describe('rate limiting', () => {
  test('booking creation is rate limited per IP', async () => {
    const rl = await startHarness({ rateLimits: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await rl.book({ checkIn: '2027-07-01', checkOut: '2027-07-02', phone: 'bad' })).status);
      assert.equal(codes.filter((c) => c === 429).length, 2);
    } finally {
      await rl.close();
    }
  });
});
