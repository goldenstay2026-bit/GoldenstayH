import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { SHEETS_SECRET, TG_CHAT, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness({ notify: true })));
after(() => h.close());
beforeEach(() => {
  h.notify!.telegram.length = 0;
  h.notify!.rows.length = 0;
  h.notify!.mode.telegram = 'ok';
  h.notify!.mode.sheets = 'ok';
});

// Harness clock: 11 Oct 2026 (IST).
const enquiry = (over: Record<string, unknown> = {}) => ({
  name: '  Riya   Sharma ',
  phone: '+91 98765 43210',
  checkIn: '2026-11-14',
  checkOut: '2026-11-16',
  guests: 2,
  room: 'ac-1bhk',
  message: 'Arriving around 6 pm',
  website: '',
  ...over,
});
const send = (body: unknown) => h.api('POST', '/api/enquiry', body);

describe('POST /api/enquiry', () => {
  test('only POST is allowed', async () => {
    const r = await h.api('GET', '/api/enquiry');
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST');
  });

  test('non-JSON body is rejected with 400', async () => {
    const r = await h.api('POST', '/api/enquiry', undefined, { 'Content-Type': 'text/plain' });
    assert.equal(r.status, 400);
  });

  test('valid enquiry → Telegram message + Sheet row, 200', async () => {
    const r = await send(enquiry());
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(typeof r.json.requestId, 'number', 'saved as a request for the admin');
    assert.equal(r.json.notified, true);

    assert.equal(h.notify!.telegram.length, 1);
    const msg = h.notify!.telegram[0];
    assert.equal(msg.chat_id, TG_CHAT);
    assert.equal(msg.parse_mode, 'HTML');
    assert.match(msg.text, /🏠 <b>New Enquiry – Golden Stay<\/b>/);
    assert.match(msg.text, /👤 <b>Name:<\/b> Riya Sharma\n/, 'name trimmed and whitespace collapsed');
    assert.match(msg.text, /<a href="tel:\+919876543210">\+91 98765 43210<\/a>/);
    assert.match(msg.text, /14 Nov 2026 → 16 Nov 2026 \(2 nights\)/);
    assert.match(msg.text, /🛏 <b>Room:<\/b> AC 1BHK — ₹1,599\/night/);
    assert.match(msg.text, /🕒 <b>Received:<\/b> 11 Oct 2026, .* IST/);
    assert.match(msg.text, /Open admin: https:\/\/goldenstay\.test\/admin$/);
    assert.deepEqual(msg.reply_markup, { inline_keyboard: [[{ text: '💬 WhatsApp guest', url: 'https://wa.me/919876543210' }]] });

    assert.equal(h.notify!.rows.length, 1);
    const row = h.notify!.rows[0];
    assert.equal(row.secret, SHEETS_SECRET);
    assert.deepEqual(
      { ...row, secret: undefined },
      { secret: undefined, name: 'Riya Sharma', phone: '+91 98765 43210', checkIn: '2026-11-14', checkOut: '2026-11-16', nights: 2, guests: 2, room: 'AC 1BHK — ₹1,599/night', message: 'Arriving around 6 pm' },
    );
  });

  test('user input is HTML-escaped in the Telegram message', async () => {
    await send(enquiry({ name: 'Ann <b>&</b>', message: '<a href="https://evil.example">click</a> & <script>' }));
    const text = h.notify!.telegram[0].text;
    assert.match(text, /Ann &lt;b&gt;&amp;&lt;\/b&gt;/);
    assert.match(text, /&lt;a href="https:\/\/evil.example"&gt;click&lt;\/a&gt; &amp; &lt;script&gt;/);
    assert.ok(!text.includes('<script>'));
  });

  test('"Any available room" and empty message are handled', async () => {
    await send(enquiry({ room: 'any', message: '   ' }));
    const text = h.notify!.telegram[0].text;
    assert.match(text, /Room:<\/b> Any available room/);
    assert.match(text, /Message:<\/b> —/);
  });

  test('if Telegram rejects the tel: link, it retries with a plain phone number', async () => {
    h.notify!.mode.telegram = 'reject-links';
    const r = await send(enquiry());
    assert.equal(r.status, 200);
    assert.equal(h.notify!.telegram.length, 1);
    assert.ok(!h.notify!.telegram[0].text.includes('href="tel:'));
    assert.match(h.notify!.telegram[0].text, /📞 <b>Phone:<\/b> \+91 98765 43210/);
  });

  test('one channel failing still succeeds (Telegram down)', async () => {
    h.notify!.mode.telegram = 'fail';
    const r = await send(enquiry());
    assert.equal(r.status, 200);
    assert.equal(h.notify!.rows.length, 1);
  });

  test('one channel failing still succeeds (Sheets misconfigured)', async () => {
    h.notify!.mode.sheets = 'html';
    const r = await send(enquiry());
    assert.equal(r.status, 200);
    assert.equal(h.notify!.telegram.length, 1);
  });

  test('both channels failing → still 200: the request is already saved for the admin', async () => {
    h.notify!.mode.telegram = 'fail';
    h.notify!.mode.sheets = 'fail';
    const r = await send(enquiry());
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.notified, false);
    assert.ok(!JSON.stringify(r.json).includes('bot'), 'no token or internals leaked');
  });

  test('honeypot filled → 200 but nothing is sent', async () => {
    const r = await send(enquiry({ website: 'http://spam.example' }));
    assert.equal(r.status, 200);
    assert.equal(h.notify!.telegram.length, 0);
    assert.equal(h.notify!.rows.length, 0);
  });

  const invalid: [string, Record<string, unknown>, string][] = [
    ['missing name', { name: '' }, 'name'],
    ['bad phone', { phone: '12345' }, 'phone'],
    ['landline-style phone', { phone: '0361 2570000' }, 'phone'],
    ['missing check-in', { checkIn: '' }, 'checkIn'],
    ['past check-in', { checkIn: '2026-10-01', checkOut: '2026-10-03' }, 'checkIn'],
    ['impossible date', { checkIn: '2026-11-31', checkOut: '2026-12-02' }, 'checkIn'],
    ['check-out not after check-in', { checkOut: '2026-11-14' }, 'checkOut'],
    ['0 guests', { guests: 0 }, 'guests'],
    ['9 guests', { guests: 9 }, 'guests'],
    ['unknown room', { room: 'penthouse' }, 'room'],
    ['non-string name', { name: { $gt: '' } }, 'name'],
  ];
  for (const [label, over, field] of invalid) {
    test(`rejects ${label} (400, field=${field})`, async () => {
      const r = await send(enquiry(over));
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.equal(r.json.field, field);
      assert.equal(h.notify!.telegram.length, 0);
    });
  }

  test('long input is capped', async () => {
    await send(enquiry({ name: 'N'.repeat(500), message: 'm'.repeat(5000) }));
    assert.equal((h.notify!.rows[0].name as string).length, 80);
    assert.equal((h.notify!.rows[0].message as string).length, 1000);
  });

  test('per-IP rate limit (5 per 10 minutes)', async () => {
    const rl = await startHarness({ notify: true, rateLimits: true });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await rl.api('POST', '/api/enquiry', enquiry())).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
    } finally {
      await rl.close();
    }
  });
});

describe('Entire homestay / party enquiries', () => {
  test('entire homestay: no room needed, up to 50 guests, booking type + occasion delivered', async () => {
    const r = await send(enquiry({ bookingType: 'entire', room: undefined, guests: 35, occasion: 'Family gathering', message: 'Need the kitchen' }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const text = h.notify!.telegram[0].text;
    assert.match(text, /🏡 <b>New Entire-Homestay Enquiry – Golden Stay<\/b>/);
    assert.match(text, /📋 <b>Booking type:<\/b> Entire homestay/);
    assert.match(text, /👥 <b>Approx. guests:<\/b> 35/);
    assert.match(text, /🎉 <b>Occasion:<\/b> Family gathering/);
    assert.ok(!text.includes('🛏'), 'no room line for group enquiries');
    const row = h.notify!.rows[0];
    assert.equal(row.room, 'Entire homestay');
    assert.equal(row.guests, 35);
    assert.equal(row.message, 'Occasion: Family gathering · Need the kitchen');
  });

  test('party / event without an occasion', async () => {
    const r = await send(enquiry({ bookingType: 'party', room: '', guests: 12, occasion: '', message: '' }));
    assert.equal(r.status, 200);
    assert.match(h.notify!.telegram[0].text, /Booking type:<\/b> Party \/ event/);
    assert.match(h.notify!.telegram[0].text, /Occasion:<\/b> —/);
    assert.equal(h.notify!.rows[0].room, 'Party / event (entire homestay)');
  });

  test('guest limits: 1–50 for groups, 1–8 for room stays; unknown type rejected', async () => {
    assert.equal((await send(enquiry({ bookingType: 'entire', guests: 51 }))).json.field, 'guests');
    assert.equal((await send(enquiry({ bookingType: 'party', guests: 0 }))).json.field, 'guests');
    assert.equal((await send(enquiry({ bookingType: 'room', guests: 9 }))).json.field, 'guests');
    assert.equal((await send(enquiry({ bookingType: 'villa' }))).json.field, 'bookingType');
    assert.equal((await send(enquiry({ bookingType: 'room', room: '' }))).json.field, 'room');
  });

  test('occasion is ignored for room stays and capped for groups', async () => {
    await send(enquiry({ bookingType: 'room', occasion: 'Birthday' }));
    assert.ok(!h.notify!.telegram[0].text.includes('Birthday'));
    h.notify!.telegram.length = 0;
    h.notify!.rows.length = 0;
    await send(enquiry({ bookingType: 'entire', occasion: 'x'.repeat(200) }));
    assert.equal((h.notify!.rows[0].message as string).startsWith('Occasion: ' + 'x'.repeat(80)), true);
    assert.ok(!(h.notify!.rows[0].message as string).includes('x'.repeat(81)));
  });
});

describe('QR payment alert', () => {
  test('submitting a UTR sends the owner a Telegram alert', async () => {
    const b = await h.book({ checkIn: '2026-12-01', checkOut: '2026-12-03' });
    await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '412345678901' }, h.guest(b.json.token));
    await h.settle();
    const alert = h.notify!.telegram.find((m) => m.text.includes('QR payment to verify'));
    assert.ok(alert, 'alert sent');
    assert.match(alert.text, new RegExp(b.json.booking.ref));
    assert.match(alert.text, /<code>412345678901<\/code>/);
    assert.match(alert.text, /₹3,198/);
  });
});
