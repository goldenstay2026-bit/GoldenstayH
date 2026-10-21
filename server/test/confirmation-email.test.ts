import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { SHEETS_SECRET, WEBHOOK_PASS, WEBHOOK_USER, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness({ notify: true, gateway: true })));
after(() => h.close());
const confirmations = () => h.notify!.emails.filter((e) => String(e.subject).startsWith('✅'));
beforeEach(() => {
  h.notify!.emails.length = 0;
  h.notify!.mode.sheets = 'ok';
});

const audits = (ref: string, action: string) => h.auditCount(ref, action);
const orderIdOf = async (ref: string) => (await h.paymentsOf(ref)).at(-1)!.merchant_order_id!;
const webhookAuth = crypto.createHash('sha256').update(`${WEBHOOK_USER}:${WEBHOOK_PASS}`).digest('hex');

async function verifyQr(over: Record<string, unknown>, utr: string) {
  const b = await h.book(over);
  await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr }, h.guest(b.json.token));
  await h.login();
  const d = await h.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
  const r = await h.api('POST', `/api/admin/bookings/${b.json.booking.ref}/verify-qr`, { paymentId: d.json.payments[0].id, note: 'Found in PhonePe Business app' });
  assert.equal(r.status, 200);
  h.clearCookie();
  await h.settle();
  return b.json.booking.ref as string;
}

describe('booking-confirmed email to the owner', () => {
  test('QR payment verified → one confirmation email with the booking details', async () => {
    const ref = await verifyQr({ roomId: 'nonac-1bhk', checkIn: '2026-11-20', checkOut: '2026-11-22', guests: 3, message: 'Late arrival' }, '312345678901');
    assert.equal(confirmations().length, 1);
    const e = confirmations()[0];
    assert.equal(e.secret, SHEETS_SECRET);
    assert.equal(e.action, 'booking_confirmed');
    assert.equal(e.subject, `✅ Booking confirmed – ${ref} · Non-AC 1BHK · 20 Nov 2026 → 22 Nov 2026`);
    assert.deepEqual(
      { ...e.booking, confirmedAt: 'x' },
      {
        ref,
        guestName: 'Riya Sharma',
        guestPhone: '+91 98765 43210',
        guestEmail: 'riya@example.com',
        room: 'Non-AC 1BHK',
        checkIn: '20 Nov 2026',
        checkOut: '22 Nov 2026',
        nights: 2,
        guests: 3,
        amountPaid: '₹2,598',
        method: 'UPI QR (verified by owner)',
        reference: '312345678901',
        confirmedAt: 'x',
      },
    );
    assert.match(e.booking.confirmedAt, /IST$/);
    assert.match(e.text, /Guest message: Late arrival/);
    assert.match(e.html, /Booking confirmed/);
    assert.equal((await audits(ref, 'email.confirmation_sent')), 1);
  });

  test('guest-entered text is HTML-escaped in the email', async () => {
    await verifyQr({ name: 'Ann <img src=x onerror=alert(1)>', checkIn: '2026-12-01', checkOut: '2026-12-02' }, '322345678901');
    const html = confirmations()[0].html as string;
    assert.ok(!html.includes('<img'), 'no raw HTML from the guest');
    assert.match(html, /Ann &lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('gateway payment confirmed → exactly one email, even with duplicate webhooks', async () => {
    const b = await h.book({ roomId: '2bhk', checkIn: '2027-01-05', checkOut: '2027-01-07' });
    const ref = b.json.booking.ref;
    await h.api('POST', `/api/bookings/${ref}/pay/gateway`, {}, h.guest(b.json.token));
    const oid = (await orderIdOf(ref));
    h.mock!.orders.get(oid)!.state = 'COMPLETED';
    for (let i = 0; i < 3; i++) {
      await h.api('POST', '/api/webhooks/phonepe', { event: 'checkout.order.completed', payload: { merchantOrderId: oid } }, { Authorization: webhookAuth });
    }
    await h.api('GET', `/api/bookings/${ref}?refresh=1`, undefined, h.guest(b.json.token));
    await h.settle();
    const mine = confirmations().filter((e) => e.booking.ref === ref);
    assert.equal(mine.length, 1);
    assert.match(mine[0].booking.method, /^PhonePe online/);
    assert.equal(mine[0].booking.reference, `OM${oid}`);
    assert.equal(mine[0].booking.amountPaid, '₹5,198');
  });

  test('no email when the money arrives but the booking can’t be confirmed', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-03-10', checkOut: '2027-03-12' });
    const ref = b.json.booking.ref;
    await h.api('POST', `/api/bookings/${ref}/pay/gateway`, {}, h.guest(b.json.token));
    h.clock.ms += 60 * 60_000; // hold expires
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-03-11', checkOut: '2027-03-12', name: 'Other' })).status, 201);
    h.mock!.orders.get((await orderIdOf(ref)))!.state = 'COMPLETED';
    await h.api('GET', `/api/bookings/${ref}?refresh=1`, undefined, h.guest(b.json.token));
    await h.settle();
    assert.equal(confirmations().filter((e) => e.booking.ref === ref).length, 0);
  });

  test('email failure never undoes the confirmation and is recorded', async () => {
    h.notify!.mode.sheets = 'fail';
    const ref = await verifyQr({ checkIn: '2027-04-01', checkOut: '2027-04-02' }, '332345678901');
    const row = await h.byRef(ref);
    assert.equal(row.status, 'confirmed');
    assert.equal((await audits(ref, 'email.confirmation_failed')), 1);
    assert.equal(confirmations().length, 0);
  });
});

describe('without the Apps Script configured', () => {
  test('confirmation still works; no email is attempted', async () => {
    const plain = await startHarness();
    try {
      const b = await plain.book({ checkIn: '2026-11-05', checkOut: '2026-11-06' });
      await plain.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '342345678901' }, plain.guest(b.json.token));
      await plain.login();
      const d = await plain.api('GET', `/api/admin/bookings/${b.json.booking.ref}`);
      const r = await plain.api('POST', `/api/admin/bookings/${b.json.booking.ref}/verify-qr`, { paymentId: d.json.payments[0].id, note: 'ok' + 'k' });
      assert.equal(r.status, 200);
      await plain.settle();
      const v = await plain.api('GET', `/api/bookings/${b.json.booking.ref}`, undefined, plain.guest(b.json.token));
      assert.equal(v.json.status, 'confirmed');
    } finally {
      await plain.close();
    }
  });
});
