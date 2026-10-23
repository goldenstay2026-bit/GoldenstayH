import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authAs, startHarness, type Harness } from './helpers.ts';

// Harness clock: 11 Oct 2026 (IST). Owner = owner@goldenstay.test (ADMIN_EMAILS).
let h: Harness;
before(async () => (h = await startHarness({ notify: true })));
after(() => h.close());

const owner = authAs('u-owner', 'owner@goldenstay.test');
const admin = (method: string, path: string, body?: unknown) => h.api(method, `/api/admin${path}`, body, owner);
const booked = async (option: string, from: string, to: string) =>
  (await h.api('GET', `/api/availability?option=${option}&from=${from}&to=${to}`)).json.booked as string[];
const detail = async (ref: string) => (await admin('GET', `/bookings/${ref}`)).json;
const audits = async (ref: string, action: string) => (await detail(ref)).history.filter((x: { action: string }) => x.action === action).length;

describe('the full workflow', () => {
  test('enquiry → owner approves → calendar + public availability → cancel → dates free again', async () => {
    const r = await h.api('POST', '/api/enquiry', { name: 'Flow Guest', phone: '98765 70000', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2, room: 'ac-1bhk', message: '', website: '' });
    assert.equal(r.status, 200);
    assert.deepEqual(await booked('ac-1bhk', '2026-12-01', '2026-12-04'), [], 'an enquiry does not hold the dates');
    const ok = await admin('POST', `/requests/${r.json.requestId}/approve`, {});
    assert.equal(ok.status, 200);
    const cal = await admin('GET', '/calendar?from=2026-12-01&to=2027-01-01');
    assert.ok(cal.json.bookings.some((b: { ref: string; state: string }) => b.ref === ok.json.ref && b.state === 'booked'));
    assert.deepEqual(await booked('ac-1bhk', '2026-12-01', '2026-12-04'), ['2026-12-01', '2026-12-02'], 'public calendar greys the nights');
    const clash = await h.book({ roomId: 'ac-1bhk', checkIn: '2026-12-02', checkOut: '2026-12-03' });
    assert.equal(clash.status, 409, 'nobody can book them online');
    assert.equal((await admin('POST', `/bookings/${ok.json.ref}/cancel`, { note: 'Guest cancelled' })).status, 200);
    assert.deepEqual(await booked('ac-1bhk', '2026-12-01', '2026-12-04'), [], 'cancelling frees the nights');
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2026-12-02', checkOut: '2026-12-03' })).status, 201, 'and they can be booked again');
  });
});

describe('booking status actions', () => {
  test('owner confirms a pending online booking → confirmed, guest emailed', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2026-12-10', checkOut: '2026-12-12' });
    const ref = b.json.booking.ref;
    assert.equal((await admin('POST', `/bookings/${ref}/confirm`, {})).status, 400, 'a note is required');
    const r = await admin('POST', `/bookings/${ref}/confirm`, { note: 'Paid cash at the door' });
    assert.equal(r.status, 200);
    await h.settle();
    assert.equal((await detail(ref)).status, 'confirmed');
    const mail = h.notify!.guestEmails.find((e) => e.subject.includes(ref));
    assert.ok(mail, 'guest confirmation email sent');
    assert.equal(mail.to, 'riya@example.com');
    assert.match(mail.subject, /confirmed/);
    assert.equal(await audits(ref, 'email.guest_confirmed_sent'), 1);
    assert.equal((await admin('POST', `/bookings/${ref}/confirm`, { note: 'again' })).status, 409, 'only pending bookings');
  });

  test('confirming re-checks the dates on the server', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2026-12-20', checkOut: '2026-12-21' });
    const ref = b.json.booking.ref;
    h.clock.ms += 31 * 60_000; // hold expires
    await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2027-01-02', checkOut: '2027-01-03', guests: 1 }); // sweep
    assert.equal((await detail(ref)).status, 'expired');
    await admin('POST', '/manual-bookings', { optionId: 'ac-1bhk', checkIn: '2026-12-20', checkOut: '2026-12-21', guestName: 'Walk In', guests: 1 });
    const r = await admin('POST', `/bookings/${ref}/confirm`, { note: 'Guest says paid' });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'DATES_TAKEN');
  });

  test('reject a pending booking → nights released, UPI claim rejected, guest told', async () => {
    const b = await h.book({ roomId: '2bhk', checkIn: '2027-01-10', checkOut: '2027-01-12' });
    const ref = b.json.booking.ref;
    await h.api('POST', `/api/bookings/${ref}/pay/qr`, { utr: '512345678901' }, h.guest(b.json.token));
    assert.deepEqual(await booked('2bhk', '2027-01-09', '2027-01-13'), ['2027-01-10', '2027-01-11']);
    const r = await admin('POST', `/bookings/${ref}/reject`, { note: 'No payment found' });
    assert.equal(r.status, 200);
    await h.settle();
    const d = await detail(ref);
    assert.equal(d.status, 'rejected');
    assert.equal(d.payments[0].state, 'rejected');
    assert.deepEqual(await booked('2bhk', '2027-01-09', '2027-01-13'), []);
    assert.ok(h.notify!.guestEmails.some((e) => e.subject.includes(ref) && /request/.test(e.subject)), 'rejection email');
    assert.equal((await admin('POST', `/bookings/${ref}/confirm`, { note: 'oops' })).status, 409, 'a rejected booking stays rejected');
    const guestView = await h.api('GET', `/api/bookings/${ref}`, undefined, h.guest(b.json.token));
    assert.equal(guestView.json.status, 'rejected');
  });

  test('mark completed only from the check-out day', async () => {
    const m = await admin('POST', '/manual-bookings', { optionId: 'nonac-1bhk', checkIn: '2026-10-12', checkOut: '2026-10-14', guestName: 'Short Stay', guests: 2 });
    const early = await admin('POST', `/bookings/${m.json.ref}/complete`, { note: 'Checked out' });
    assert.equal(early.status, 409);
    assert.equal(early.json.code, 'TOO_EARLY');
    const saved = h.clock.ms;
    h.clock.ms = Date.parse('2026-10-14T05:00:00Z');
    assert.equal((await admin('POST', `/bookings/${m.json.ref}/complete`, { note: 'Checked out' })).status, 200);
    h.clock.ms = saved;
    assert.equal((await detail(m.json.ref)).status, 'completed');
    const block = await admin('POST', '/manual-bookings', { kind: 'block', optionId: 'ac-1bhk', checkIn: '2027-02-01', checkOut: '2027-02-02', reason: 'Repairs' });
    assert.equal((await admin('POST', `/bookings/${block.json.ref}/complete`, { note: 'x' + 'xx' })).status, 409, 'blocks cannot be completed');
  });
});

describe('payments: pending, partially paid, paid, refunded', () => {
  test('owner-entered booking with a price: record cash and UPI payments, then a refund', async () => {
    const m = await admin('POST', '/manual-bookings', { optionId: 'ac-1bhk', checkIn: '2027-03-01', checkOut: '2027-03-03', guestName: 'Pay Later', guests: 2, totalPrice: 3000 });
    const ref = m.json.ref;
    assert.equal((await detail(ref)).payment, 'pending');
    assert.equal((await detail(ref)).totalPaise, 300000);
    const p1 = await admin('POST', `/bookings/${ref}/payments`, { amount: 1000, method: 'cash', note: 'Advance in cash' });
    assert.equal(p1.status, 201);
    assert.equal((await detail(ref)).payment, 'partially_paid');
    await admin('POST', `/bookings/${ref}/payments`, { amount: 2000, method: 'upi', reference: '612345678901', note: 'Balance by UPI' });
    let d = await detail(ref);
    assert.equal(d.payment, 'paid');
    assert.equal(d.amountPaidPaise, 300000);
    const listPaid = await admin('GET', '/bookings?payment=paid');
    assert.ok(listPaid.json.some((b: { ref: string }) => b.ref === ref), 'payment filter');
    await admin('POST', `/bookings/${ref}/refund`, { paymentId: d.payments[1].id, amount: 500, note: 'Returned ₹500 in cash' });
    d = await detail(ref);
    assert.equal(d.amountPaidPaise, 250000);
    assert.equal(d.payment, 'partially_paid');
    assert.equal((await admin('POST', `/bookings/${ref}/payments`, { amount: 0, method: 'cash', note: 'zero' })).status, 400);
  });

  test('a booking without a price shows "not recorded"; blocks have no payments', async () => {
    const m = await admin('POST', '/manual-bookings', { optionId: 'ac-1bhk', checkIn: '2027-03-10', checkOut: '2027-03-11', guestName: 'No Price', guests: 1 });
    assert.equal((await detail(m.json.ref)).payment, 'not_recorded');
    const block = await admin('POST', '/manual-bookings', { kind: 'block', optionId: 'nonac-1bhk', checkIn: '2027-03-10', checkOut: '2027-03-11', reason: 'Family' });
    assert.equal((await admin('POST', `/bookings/${block.json.ref}/payments`, { amount: 100, method: 'cash', note: 'test' })).status, 409);
  });
});

describe('seasonal prices', () => {
  test('a seasonal price changes the quote for the nights it covers, and can be removed', async () => {
    const add = await admin('POST', '/seasonal-prices', { roomId: 'ac-1bhk', from: '2026-12-24', to: '2026-12-25', price: 2500, label: 'Christmas' });
    assert.equal(add.status, 201);
    const q = await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2026-12-23', checkOut: '2026-12-26', guests: 2 });
    assert.equal(q.json.totalPaise, 159900 + 2 * 250000);
    assert.deepEqual(q.json.lines.map((l: { label: string }) => l.label), ['AC 1BHK · ₹1,599 × 1 night', 'AC 1BHK · Christmas ₹2,500 × 2 nights']);
    const nonac = await h.api('POST', '/api/quote', { roomId: 'nonac-1bhk', checkIn: '2026-12-24', checkOut: '2026-12-25', guests: 2 });
    assert.equal(nonac.json.totalPaise, 129900, 'other rooms unaffected');
    assert.equal((await admin('POST', '/seasonal-prices', { roomId: 'ac-1bhk', from: '2026-12-25', to: '2026-12-24', price: 2000 })).status, 400);
    assert.equal((await admin('DELETE', `/seasonal-prices/${add.json.id}`)).status, 200);
    const back = await h.api('POST', '/api/quote', { roomId: 'ac-1bhk', checkIn: '2026-12-23', checkOut: '2026-12-26', guests: 2 });
    assert.equal(back.json.totalPaise, 3 * 159900);
  });
});

describe('property settings (stay details & house rules)', () => {
  test('owner sets check-in/out times; the public site reads them; invalid input refused', async () => {
    const put = await admin('PUT', '/property', { checkInTime: '12:00 PM', checkOutTime: '11:00 AM', smoking: 'not allowed indoors', freeCancellationHours: '48' });
    assert.equal(put.status, 200);
    const pub = await h.api('GET', '/api/property');
    assert.equal(pub.json.checkInTime, '12:00 PM');
    assert.equal(pub.json.freeCancellationHours, 48);
    assert.equal(pub.json.pets, null, 'empty fields stay hidden');
    assert.equal((await admin('PUT', '/property', { refundDays: 'soon' })).status, 400);
    assert.equal((await h.api('PUT', '/api/admin/property', { checkInTime: 'x' }, authAs('u-riya', 'riya@example.com'))).status, 403);
  });

  test('confirmation emails include the times', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-04-05', checkOut: '2027-04-06' });
    await admin('POST', `/bookings/${b.json.booking.ref}/confirm`, { note: 'Confirmed by phone' });
    await h.settle();
    const mail = h.notify!.guestEmails.find((e) => e.subject.includes(b.json.booking.ref));
    assert.match(mail!.text, /Check-in: 5 Apr 2027 from 12:00 PM/);
    assert.match(mail!.text, /Check-out: 6 Apr 2027 by 11:00 AM/);
  });
});

describe('dashboard and guests', () => {
  test('dashboard figures come from the real bookings and payments', async () => {
    const d = await admin('GET', '/dashboard');
    assert.equal(d.status, 200);
    assert.ok(d.json.counts.totalBookings >= 5);
    assert.ok(d.json.counts.confirmed >= 1);
    assert.ok(d.json.counts.cancelled >= 2, 'cancelled + rejected');
    assert.equal(d.json.counts.completed, 1);
    assert.equal(d.json.revenue.byMonth.length, 12);
    assert.equal(d.json.revenue.byMonth.at(-1).month, '2026-10');
    assert.equal(d.json.revenue.thisMonthPaise, 250000, '₹3,000 recorded − ₹500 refunded, this month');
    assert.equal(d.json.occupancy.length, 2);
    assert.ok(Array.isArray(d.json.notifications));
  });

  test('guests: one row per phone number, searchable, with their history', async () => {
    const all = await admin('GET', '/guests');
    const riya = all.json.find((g: { name: string }) => g.name === 'Riya Sharma');
    assert.ok(riya && riya.bookings >= 3, 'Riya’s online bookings grouped');
    const byPhone = await admin('GET', '/guests?q=98765%2070000');
    assert.equal(byPhone.json.length, 1);
    assert.equal(byPhone.json[0].name, 'Flow Guest');
    const g = await admin('GET', `/guests/${encodeURIComponent(riya.key)}`);
    assert.equal(g.status, 200);
    assert.ok(g.json.bookingList.length >= 3);
    assert.equal((await admin('GET', '/guests/pnobody')).status, 404);
  });

  test('guest details are only for the owner', async () => {
    for (const path of ['/guests', '/dashboard', '/seasonal-prices', '/property']) {
      assert.equal((await h.api('GET', `/api/admin${path}`)).status, 401, `anonymous ${path}`);
      assert.equal((await h.api('GET', `/api/admin${path}`, undefined, authAs('u-riya', 'riya@example.com'))).status, 403, `guest ${path}`);
    }
    for (const [m, path] of [['POST', '/bookings/GSXXXXXX/confirm'], ['POST', '/bookings/GSXXXXXX/reject'], ['POST', '/bookings/GSXXXXXX/payments'], ['POST', '/seasonal-prices']]) {
      assert.equal((await h.api(m, `/api/admin${path}`, {})).status, 401, `anonymous ${m} ${path}`);
    }
  });

  test('a failed guest email is recorded as failed, never as sent', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-05-01', checkOut: '2027-05-02' });
    h.notify!.mode.sheets = 'fail';
    await admin('POST', `/bookings/${b.json.booking.ref}/confirm`, { note: 'Confirmed' });
    await h.settle();
    h.notify!.mode.sheets = 'ok';
    assert.equal(await audits(b.json.booking.ref, 'email.guest_confirmed_sent'), 0);
    assert.equal(await audits(b.json.booking.ref, 'email.guest_confirmed_failed'), 1);
  });

  test('owner can send the confirmation email again; the answer says what really happened', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-06-01', checkOut: '2027-06-02' });
    const ref = b.json.booking.ref;
    assert.equal((await admin('POST', `/bookings/${ref}/email-guest`, {})).status, 409, 'not for a pending booking');
    h.notify!.mode.sheets = 'fail';
    await admin('POST', `/bookings/${ref}/confirm`, { note: 'Confirmed' });
    await h.settle();
    const failed = await admin('POST', `/bookings/${ref}/email-guest`, {});
    h.notify!.mode.sheets = 'ok';
    assert.equal(failed.status, 502);
    assert.equal(failed.json.code, 'EMAIL_FAILED');
    assert.match(failed.json.error, /not sent/);
    const before = h.notify!.guestEmails.length;
    const sent = await admin('POST', `/bookings/${ref}/email-guest`, {});
    assert.equal(sent.status, 200);
    assert.equal(sent.json.to, 'riya@example.com');
    assert.equal(h.notify!.guestEmails.length, before + 1);
    assert.match(h.notify!.guestEmails.at(-1)!.subject, new RegExp(`${ref}.*|confirmed`));
    assert.equal(await audits(ref, 'email.guest_confirmed_sent'), 1);
    assert.equal(await audits(ref, 'email.guest_confirmed_failed'), 2);
    assert.equal((await h.api('POST', `/api/admin/bookings/${ref}/email-guest`, {})).status, 401, 'owner only');
  });
});
