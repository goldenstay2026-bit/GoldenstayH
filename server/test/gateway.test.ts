import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startHarness, type Harness } from './helpers.ts';

describe('PhonePe gateway disabled (no credentials yet)', () => {
  let h: Harness;
  before(async () => (h = await startHarness({ gateway: false })));
  after(() => h.close());

  test('config advertises QR only, and gateway initiation is refused', async () => {
    const cfg = await h.api('GET', '/api/config');
    assert.equal(cfg.json.gatewayEnabled, false);
    const b = await h.book();
    const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/gateway`, {}, h.guest(b.json.token));
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'GATEWAY_DISABLED');
  });
});

describe('PhonePe gateway enabled (against a mock PhonePe)', () => {
  let h: Harness;
  before(async () => (h = await startHarness({ gateway: true })));
  after(() => h.close());

  const orderIdOf = async (ref: string) => (await h.paymentsOf(ref)).at(-1)!.merchant_order_id!;
  const audits = (ref: string, action: string) => h.auditCount(ref, action);

  async function startPay(over: Record<string, unknown>) {
    const b = await h.book(over);
    assert.equal(b.status, 201);
    const pay = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/gateway`, {}, h.guest(b.json.token));
    assert.equal(pay.status, 200, JSON.stringify(pay.json));
    return { ref: b.json.booking.ref as string, token: b.json.token as string, redirectUrl: pay.json.redirectUrl as string, totalPaise: b.json.booking.totalPaise as number };
  }

  test('creates a PhonePe order for the server-calculated amount and returns PhonePe’s checkout URL', async () => {
    const p = await startPay({ roomId: '2bhk', checkIn: '2026-10-20', checkOut: '2026-10-23' });
    assert.match(p.redirectUrl, /^https:\/\/mercury-uat\.phonepe\.com\//);
    const order = h.mock!.orders.get((await orderIdOf(p.ref)))!;
    assert.equal(order.amount, 779_700);
    assert.match((await orderIdOf(p.ref)), /^[A-Za-z0-9_-]{1,63}$/);
  });

  test('successful payment via authenticated webhook confirms the booking; duplicates are harmless', async () => {
    const p = await startPay({ roomId: 'ac-1bhk', checkIn: '2026-11-10', checkOut: '2026-11-12' });
    const oid = (await orderIdOf(p.ref));
    h.mock!.orders.get(oid)!.state = 'COMPLETED';
    for (let i = 0; i < 3; i++) assert.equal((await h.webhook('checkout.order.completed', oid)).status, 200);
    await h.settle();
    const v = await h.api('GET', `/api/bookings/${p.ref}`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'confirmed');
    assert.equal(v.json.paymentStatus, 'successful');
    assert.equal(v.json.amountPaidPaise, p.totalPaise);
    assert.equal((await audits(p.ref, 'booking.confirmed')), 1, 'confirmed exactly once despite 3 webhooks');
  });

  test('webhook with a wrong Authorization header is rejected and changes nothing', async () => {
    const p = await startPay({ roomId: 'nonac-1bhk', checkIn: '2026-11-10', checkOut: '2026-11-11' });
    const oid = (await orderIdOf(p.ref));
    h.mock!.orders.get(oid)!.state = 'COMPLETED';
    assert.equal((await h.webhook('checkout.order.completed', oid, 'not-the-hash')).status, 401);
    assert.equal((await h.webhook('checkout.order.completed', oid, '')).status, 401);
    await h.settle();
    const v = await h.api('GET', `/api/bookings/${p.ref}`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'pending_payment');
  });

  test('a genuine-looking webhook claiming success is NOT trusted while PhonePe still says PENDING', async () => {
    const p = await startPay({ roomId: 'nonac-1bhk', checkIn: '2026-11-20', checkOut: '2026-11-21' });
    await h.webhook('checkout.order.completed', (await orderIdOf(p.ref))); // payload says COMPLETED, status API says PENDING
    await h.settle();
    const v = await h.api('GET', `/api/bookings/${p.ref}`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'pending_payment');
    assert.equal(v.json.paymentStatus, 'pending');
  });

  test('returning from PhonePe confirms via the status API even if no webhook arrives', async () => {
    const p = await startPay({ roomId: 'ac-1bhk', checkIn: '2026-12-01', checkOut: '2026-12-02' });
    h.mock!.orders.get((await orderIdOf(p.ref)))!.state = 'COMPLETED';
    const v = await h.api('GET', `/api/bookings/${p.ref}?refresh=1`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'confirmed');
  });

  test('failed payment: booking stays held, guest can retry with a NEW order ID', async () => {
    const p = await startPay({ roomId: 'ac-1bhk', checkIn: '2026-12-10', checkOut: '2026-12-11' });
    const first = (await orderIdOf(p.ref));
    h.mock!.orders.get(first)!.state = 'FAILED';
    await h.webhook('checkout.order.failed', first, undefined, 'FAILED');
    await h.settle();
    let v = await h.api('GET', `/api/bookings/${p.ref}`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'pending_payment');
    assert.equal(v.json.paymentStatus, 'failed');
    const retry = await h.api('POST', `/api/bookings/${p.ref}/pay/gateway`, {}, h.guest(p.token));
    assert.equal(retry.status, 200);
    const second = (await orderIdOf(p.ref));
    assert.notEqual(second, first);
    h.mock!.orders.get(second)!.state = 'COMPLETED';
    v = await h.api('GET', `/api/bookings/${p.ref}?refresh=1`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'confirmed');
  });

  test('double-clicking Pay reuses the open order instead of creating another', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-15', checkOut: '2026-12-16' });
    const go = () => h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/gateway`, {}, h.guest(b.json.token));
    const a = await go();
    const c = await go();
    assert.equal(a.json.redirectUrl, c.json.redirectUrl);
    assert.equal((await h.paymentsOf(b.json.booking.ref)).length, 1);
  });

  test('PhonePe error while creating an order surfaces a retryable error', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-20', checkOut: '2026-12-21' });
    h.mock!.failNextPay();
    const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/gateway`, {}, h.guest(b.json.token));
    assert.equal(r.status, 502);
    assert.equal(r.json.code, 'GATEWAY_ERROR');
    const again = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/gateway`, {}, h.guest(b.json.token));
    assert.equal(again.status, 200);
  });

  test('amount mismatch reported by PhonePe never confirms and is flagged', async () => {
    const p = await startPay({ roomId: 'ac-1bhk', checkIn: '2027-01-20', checkOut: '2027-01-21' });
    const o = h.mock!.orders.get((await orderIdOf(p.ref)))!;
    o.state = 'COMPLETED';
    o.reportedAmount = 100;
    const v = await h.api('GET', `/api/bookings/${p.ref}?refresh=1`, undefined, h.guest(p.token));
    assert.notEqual(v.json.status, 'confirmed');
    const row = await h.byRef(p.ref);
    assert.match(row.needs_attention ?? '', /reported 100 paise/);
  });

  test('payment that lands after the hold expired still confirms if the room is free', async () => {
    const p = await startPay({ roomId: 'nonac-1bhk', checkIn: '2027-02-10', checkOut: '2027-02-12' });
    h.clock.ms += 60 * 60_000; // past the extended hold
    await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2027-02-10', checkOut: '2027-02-11', guests: 1 }); // triggers sweep
    assert.equal((await h.byRef(p.ref)).status, 'expired');
    h.mock!.orders.get((await orderIdOf(p.ref)))!.state = 'COMPLETED';
    await h.webhook('checkout.order.completed', (await orderIdOf(p.ref)));
    await h.settle();
    const v = await h.api('GET', `/api/bookings/${p.ref}`, undefined, h.guest(p.token));
    assert.equal(v.json.status, 'confirmed');
  });

  test('late payment when someone else took the room is flagged for refund, never double-booked', async () => {
    const p = await startPay({ roomId: 'ac-1bhk', checkIn: '2027-03-10', checkOut: '2027-03-12' });
    h.clock.ms += 60 * 60_000;
    const other = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-03-11', checkOut: '2027-03-13', name: 'Other Guest' });
    assert.equal(other.status, 201);
    h.mock!.orders.get((await orderIdOf(p.ref)))!.state = 'COMPLETED';
    await h.webhook('checkout.order.completed', (await orderIdOf(p.ref)));
    await h.settle();
    const row = await h.byRef(p.ref);
    assert.equal(row.status, 'expired');
    assert.equal(row.payment_status, 'successful');
    assert.match(row.needs_attention ?? '', /refund/);
    assert.ok(await h.night('ac', '2027-03-11'), 'the other guest keeps the night');
  });

  test('admin can refund a gateway payment; refund webhook completes it', async () => {
    const p = await startPay({ roomId: 'nonac-1bhk', checkIn: '2027-04-10', checkOut: '2027-04-11' });
    h.mock!.orders.get((await orderIdOf(p.ref)))!.state = 'COMPLETED';
    await h.api('GET', `/api/bookings/${p.ref}?refresh=1`, undefined, h.guest(p.token));
    await h.login();
    const detail = await h.api('GET', `/api/admin/bookings/${p.ref}`);
    const paymentId = detail.json.payments[0].id;
    assert.equal((await h.api('POST', `/api/admin/bookings/${p.ref}/refund`, { paymentId, amount: 2000, note: 'too much' })).status, 400);
    const r = await h.api('POST', `/api/admin/bookings/${p.ref}/refund`, { paymentId, amount: 1299, note: 'Guest cancelled' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const [refundId] = [...h.mock!.refunds.keys()];
    h.mock!.refunds.get(refundId)!.state = 'COMPLETED';
    await h.api('POST', '/api/webhooks/phonepe', { event: 'pg.refund.completed', payload: { merchantRefundId: refundId } }, {
      Authorization: (await import('node:crypto')).createHash('sha256').update('gs-webhook:gs-webhook-secret-123').digest('hex'),
    });
    await h.settle();
    const after = await h.api('GET', `/api/admin/bookings/${p.ref}`);
    assert.equal(after.json.paymentStatus, 'refunded');
    assert.equal(after.json.refunds[0].state, 'completed');
    h.clearCookie();
  });
});
