import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authAs, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness({ notify: true })));
after(() => h.close());

const row = (ref: string) => h.notify!.bookingRows.get(ref)!;
const upsertsFor = (ref: string) => h.notify!.upserts.filter((u) => u.ref === ref).length;

describe('Google Sheet "Bookings" tab', () => {
  test('a booking’s row follows it from creation to confirmation, cancellation and refund', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2026-11-14', checkOut: '2026-11-16', guests: 2, message: 'Late check-in' });
    const ref = b.json.booking.ref;
    await h.settle();
    assert.deepEqual(
      { ...row(ref), bookedAt: '-', updatedAt: '-', version: '-' },
      {
        ref,
        status: 'Awaiting payment',
        payment: 'Not paid',
        guestName: 'Riya Sharma',
        guestPhone: '+91 98765 43210',
        guestEmail: 'riya@example.com',
        room: 'AC 1BHK',
        checkIn: '2026-11-14',
        checkOut: '2026-11-16',
        nights: 2,
        guests: 2,
        total: '₹3,198',
        paid: '₹0',
        method: '—',
        reference: '',
        bookedAt: '-',
        updatedAt: '-',
        needsAttention: '',
        message: 'Late check-in',
        version: '-',
      },
    );
    assert.match(row(ref).bookedAt, /IST$/);

    await h.api('POST', `/api/bookings/${ref}/pay/qr`, { utr: '512345678912' }, h.guest(b.json.token));
    await h.settle();
    assert.equal(row(ref).status, 'Pending verification');
    assert.equal(row(ref).payment, 'To verify');
    assert.equal(row(ref).method, 'UPI QR');
    assert.equal(row(ref).reference, '512345678912');

    await h.login();
    const d = await h.api('GET', `/api/admin/bookings/${ref}`);
    const paymentId = d.json.payments[0].id;
    const before = upsertsFor(ref);
    await h.api('POST', `/api/admin/bookings/${ref}/verify-qr`, { paymentId, note: 'Found in PhonePe app' });
    await h.settle();
    assert.equal(row(ref).status, 'Confirmed');
    assert.equal(row(ref).payment, 'Paid');
    assert.equal(row(ref).paid, '₹3,198');
    assert.equal(upsertsFor(ref) - before, 1, 'several changes in one action → one sheet update');

    await h.api('POST', `/api/admin/bookings/${ref}/cancel`, { note: 'Guest changed plans' });
    await h.settle();
    assert.equal(row(ref).status, 'Cancelled');
    assert.match(row(ref).needsAttention, /refund due/);
    await h.api('POST', `/api/admin/bookings/${ref}/refund`, { paymentId, amount: 3198, note: 'Refunded in PhonePe app' });
    await h.settle();
    assert.equal(row(ref).payment, 'Refunded');
    assert.equal(row(ref).paid, '₹0');
    assert.equal(row(ref).needsAttention, '');
    h.clearCookie();
  });

  test('an unpaid booking that expires shows as Expired', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-10', checkOut: '2026-12-11' });
    h.clock.ms += 31 * 60_000;
    await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2026-12-20', checkOut: '2026-12-21', guests: 1 }); // triggers the expiry sweep
    await h.settle();
    assert.equal(row(b.json.booking.ref).status, 'Expired (unpaid)');
  });

  test('a rejected double-booking never gets a row', async () => {
    await h.book({ roomId: '2bhk', checkIn: '2027-01-10', checkOut: '2027-01-12' }, authAs('u-a', 'a@example.com'));
    await h.settle();
    const n = h.notify!.bookingRows.size;
    const clash = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-01-11', checkOut: '2027-01-12' }, authAs('u-b', 'b@example.com'));
    assert.equal(clash.status, 409);
    await h.settle();
    assert.equal(h.notify!.bookingRows.size, n);
  });

  test('a sheet outage never affects the booking itself', async () => {
    h.notify!.mode.sheets = 'fail';
    try {
      const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-02-01', checkOut: '2027-02-02' });
      assert.equal(b.status, 201);
      await h.settle();
      assert.equal(h.notify!.bookingRows.has(b.json.booking.ref), false);
      const v = await h.api('GET', `/api/bookings/${b.json.booking.ref}`, undefined, h.guest(b.json.token));
      assert.equal(v.json.status, 'pending_payment');
    } finally {
      h.notify!.mode.sheets = 'ok';
    }
  });
});
