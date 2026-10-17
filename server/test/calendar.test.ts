import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authAs, startHarness, type Harness } from './helpers.ts';

// Harness clock: 11 Oct 2026 (IST). Owner = owner@goldenstay.test (ADMIN_EMAILS).
let h: Harness;
before(async () => (h = await startHarness({ notify: true })));
after(() => h.close());

const owner = authAs('u-owner', 'owner@goldenstay.test');
const admin = (method: string, path: string, body?: unknown) => h.api(method, `/api/admin${path}`, body, owner);
const manual = (over: Record<string, unknown> = {}) =>
  admin('POST', '/manual-bookings', {
    optionId: 'ac-1bhk',
    checkIn: '2026-11-22',
    checkOut: '2026-11-24',
    guestName: 'Arjun Das',
    guestPhone: '98640 12345',
    guests: 2,
    source: 'phone',
    ...over,
  });
const enquiry = (over: Record<string, unknown> = {}) =>
  h.api('POST', '/api/enquiry', {
    name: 'Meera Bora',
    phone: '+91 98765 11111',
    checkIn: '2026-12-01',
    checkOut: '2026-12-03',
    guests: 2,
    room: 'ac-1bhk',
    message: '',
    website: '',
    ...over,
  });
const booked = async (option: string, from: string, to: string) =>
  (await h.api('GET', `/api/availability?option=${option}&from=${from}&to=${to}`)).json.booked as string[];

describe('admin access', () => {
  test('signed out → 401; /me says not authenticated', async () => {
    assert.equal((await h.api('GET', '/api/admin/calendar?from=2026-11-01&to=2026-12-01')).status, 401);
    const me = await h.api('GET', '/api/admin/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.authenticated, false);
  });

  test('a signed-in guest who is not on ADMIN_EMAILS gets "no access"', async () => {
    const r = await h.api('GET', '/api/admin/requests', undefined, authAs('u-riya', 'riya@example.com'));
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'NOT_ADMIN');
    const me = await h.api('GET', '/api/admin/me', undefined, authAs('u-riya', 'riya@example.com'));
    assert.deepEqual([me.json.authenticated, me.json.isAdmin, me.json.code], [true, false, 'NOT_ADMIN']);
  });

  test('the owner email must be verified', async () => {
    const r = await h.api('GET', '/api/admin/requests', undefined, { Authorization: 'Bearer test:u-owner:owner@goldenstay.test:unverified' });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'EMAIL_NOT_VERIFIED');
  });

  test('the owner is in', async () => {
    const me = await admin('GET', '/me');
    assert.equal(me.json.isAdmin, true);
    assert.equal(me.json.email, 'owner@goldenstay.test');
  });
});

describe('owner bookings, blocks and overlaps', () => {
  test('a manual booking holds its nights; an overlapping one is rejected with a clear message', async () => {
    const a = await manual();
    assert.equal(a.status, 201);
    const clash = await manual({ checkIn: '2026-11-23', checkOut: '2026-11-25', guestName: 'Someone Else' });
    assert.equal(clash.status, 409);
    assert.equal(clash.json.code, 'DATES_TAKEN');
    assert.equal(clash.json.error, 'AC 1BHK is already booked on 23 Nov.');
    const live = await admin('GET', '/check?optionId=ac-1bhk&checkIn=2026-11-21&checkOut=2026-11-25');
    assert.equal(live.json.ok, false);
    assert.equal(live.json.message, 'AC 1BHK is already booked on 22–23 Nov.');
  });

  test('the database itself refuses overlapping nights (UNIQUE unit+night)', () => {
    const id = (h.ctx.db.prepare('SELECT booking_id FROM booking_nights WHERE unit = ? AND night = ?').get('ac', '2026-11-22') as { booking_id: number }).booking_id;
    assert.throws(() => h.ctx.db.prepare('INSERT INTO booking_nights (booking_id, unit, night) VALUES (?, ?, ?)').run(id + 1000, 'ac', '2026-11-22'), /UNIQUE/);
  });

  test('the check-out day stays bookable', async () => {
    const r = await manual({ checkIn: '2026-11-24', checkOut: '2026-11-25', guestName: 'Next Guest' });
    assert.equal(r.status, 201);
    assert.deepEqual(await booked('ac-1bhk', '2026-11-20', '2026-11-27'), ['2026-11-22', '2026-11-23', '2026-11-24']);
  });

  test('the 2BHK blocks both 1BHKs, and the other room stays free', async () => {
    assert.equal((await manual({ optionId: 'nonac-1bhk', checkIn: '2026-11-22', checkOut: '2026-11-23', guestName: 'Non AC Guest' })).status, 201);
    const twoBhk = await manual({ optionId: '2bhk', checkIn: '2026-11-22', checkOut: '2026-11-23' });
    assert.equal(twoBhk.status, 409);
    assert.match(twoBhk.json.error, /AC 1BHK is already booked on 22 Nov\. Non-AC 1BHK is already booked on 22 Nov\./);

    assert.equal((await manual({ optionId: '2bhk', checkIn: '2026-11-28', checkOut: '2026-11-30', guestName: 'Family' })).status, 201);
    assert.deepEqual(await booked('ac-1bhk', '2026-11-27', '2026-12-01'), ['2026-11-28', '2026-11-29']);
    assert.deepEqual(await booked('nonac-1bhk', '2026-11-27', '2026-12-01'), ['2026-11-28', '2026-11-29']);
    const single = await manual({ optionId: 'nonac-1bhk', checkIn: '2026-11-29', checkOut: '2026-11-30' });
    assert.equal(single.status, 409);
    assert.equal(single.json.error, 'Non-AC 1BHK is already booked on 29 Nov.');
  });

  test('the Entire Homestay blocks everything; a block uses the same rules', async () => {
    assert.equal((await manual({ optionId: 'entire', checkIn: '2026-12-10', checkOut: '2026-12-12', guestName: 'Birthday Party', guests: 25 })).status, 201);
    for (const option of ['ac-1bhk', 'nonac-1bhk', '2bhk', 'entire', 'any']) {
      assert.deepEqual(await booked(option, '2026-12-09', '2026-12-13'), ['2026-12-10', '2026-12-11'], option);
    }
    const block = await admin('POST', '/manual-bookings', { kind: 'block', optionId: 'nonac-1bhk', checkIn: '2026-12-11', checkOut: '2026-12-13', reason: 'Painting' });
    assert.equal(block.status, 409);
    const ok = await admin('POST', '/manual-bookings', { kind: 'block', optionId: 'nonac-1bhk', checkIn: '2026-12-12', checkOut: '2026-12-14', reason: 'Painting' });
    assert.equal(ok.status, 201);
    const detail = await admin('GET', `/bookings/${ok.json.ref}`);
    assert.equal(detail.json.kind, 'block');
    assert.equal(detail.json.notes, 'Painting');
  });

  test('editing moves the nights; cancelling frees them', async () => {
    const a = await manual({ optionId: 'ac-1bhk', checkIn: '2027-01-05', checkOut: '2027-01-07', guestName: 'Edit Me' });
    const moved = await admin('PUT', `/manual-bookings/${a.json.ref}`, { optionId: 'ac-1bhk', checkIn: '2027-01-06', checkOut: '2027-01-08', guestName: 'Edit Me', guestPhone: '+44 7700 900123', guests: 3, source: 'whatsapp' });
    assert.equal(moved.status, 200);
    assert.deepEqual(await booked('ac-1bhk', '2027-01-01', '2027-01-10'), ['2027-01-06', '2027-01-07']);
    const d = await admin('GET', `/bookings/${a.json.ref}`);
    assert.equal(d.json.guestPhone, '+447700900123');
    assert.equal(d.json.whatsapp, '447700900123');
    assert.equal((await admin('POST', `/bookings/${a.json.ref}/cancel`, { note: 'Guest cancelled by phone' })).status, 200);
    assert.deepEqual(await booked('ac-1bhk', '2027-01-01', '2027-01-10'), []);
  });

  test('an online booking cannot take nights the owner booked', async () => {
    const r = await h.book({ roomId: 'ac-1bhk', checkIn: '2026-11-23', checkOut: '2026-11-24' });
    assert.equal(r.status, 409);
  });

  test('invalid input → 400 with the field', async () => {
    const r = await manual({ guestName: '', checkIn: '2027-02-01', checkOut: '2027-02-02' });
    assert.equal(r.status, 400);
    assert.equal(r.json.field, 'guestName');
    const bad = await manual({ checkIn: '2027-02-03', checkOut: '2027-02-02' });
    assert.equal(bad.json.field, 'checkOut');
  });

  test('admin calendar lists bookings, blocks and pending requests for the month', async () => {
    const r = await admin('GET', '/calendar?from=2026-11-01&to=2026-12-01');
    assert.equal(r.status, 200);
    const names = r.json.bookings.map((b: { guestName: string }) => b.guestName);
    assert.ok(names.includes('Arjun Das'));
    assert.ok(r.json.bookings.every((b: { state: string }) => ['booked', 'block', 'pending'].includes(b.state)));
  });

  test('bookings list: views, room filter and phone search', async () => {
    const up = await admin('GET', '/bookings?view=upcoming&unit=nonac');
    assert.ok(up.json.length > 0);
    assert.ok(up.json.every((b: { optionId: string }) => ['nonac-1bhk', '2bhk', 'entire'].includes(b.optionId)));
    const byPhone = await admin('GET', '/bookings?q=98640');
    assert.ok(byPhone.json.some((b: { guestName: string }) => b.guestName === 'Arjun Das'));
    assert.equal((await admin('GET', '/bookings?view=past')).json.length, 0);
  });
});

describe('public availability never leaks guest details', () => {
  test('/api/availability returns nights only', async () => {
    const r = await h.api('GET', '/api/availability?option=ac-1bhk&from=2026-11-01&to=2026-12-01');
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.json);
    for (const secret of ['Arjun', '98640', 'Das', 'phone', 'guest']) assert.ok(!text.includes(secret), secret);
    assert.deepEqual(Object.keys(r.json).sort(), ['booked', 'from', 'option', 'to']);
  });

  test('/api/availability/options says which options are free', async () => {
    const r = await h.api('GET', '/api/availability/options?checkIn=2026-11-22&checkOut=2026-11-23');
    assert.deepEqual(r.json.available, { 'ac-1bhk': false, 'nonac-1bhk': false, '2bhk': false, entire: false });
    const free = await h.api('GET', '/api/availability/options?checkIn=2027-03-01&checkOut=2027-03-02');
    assert.deepEqual(free.json.available, { 'ac-1bhk': true, 'nonac-1bhk': true, '2bhk': true, entire: true });
    assert.ok(!JSON.stringify(r.json).includes('Arjun'));
  });

  test('bad ranges are refused', async () => {
    assert.equal((await h.api('GET', '/api/availability?option=ac-1bhk&from=2026-11-01&to=2027-11-01')).status, 400);
    assert.equal((await h.api('GET', '/api/availability?option=villa&from=2026-11-01&to=2026-12-01')).status, 400);
  });
});

describe('website requests', () => {
  test('a request for booked nights is rejected and nobody is notified', async () => {
    const before = h.notify!.telegram.length;
    const r = await enquiry({ checkIn: '2026-11-22', checkOut: '2026-11-24' });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'DATES_TAKEN');
    assert.equal(r.json.error, 'Some of these nights are already booked. Please choose different dates.');
    assert.equal(h.notify!.telegram.length, before);
  });

  test('"any room" is refused only when no single room is free', async () => {
    // 24 Nov: AC booked, Non-AC free → OK
    assert.equal((await enquiry({ room: 'any', checkIn: '2026-11-24', checkOut: '2026-11-25' })).status, 200);
    // 28–29 Nov: 2BHK holds both → refused
    assert.equal((await enquiry({ room: 'any', checkIn: '2026-11-28', checkOut: '2026-11-29' })).status, 409);
  });

  test('group enquiries need the whole homestay free', async () => {
    const r = await enquiry({ bookingType: 'party', guests: 20, checkIn: '2026-11-24', checkOut: '2026-11-25', room: '' });
    assert.equal(r.status, 409);
  });

  test('requests list: pending first; approve creates a website_request booking', async () => {
    const r = await enquiry({ name: 'Approve Me', checkIn: '2026-12-01', checkOut: '2026-12-03' });
    assert.equal(r.status, 200);
    const list = await admin('GET', '/requests');
    assert.equal(list.json[0].guestName, 'Approve Me');
    assert.equal(list.json[0].status, 'pending');
    assert.equal(list.json[0].whatsapp, '919876511111');
    const ok = await admin('POST', `/requests/${r.json.requestId}/approve`, {});
    assert.equal(ok.status, 200);
    const b = await admin('GET', `/bookings/${ok.json.ref}`);
    assert.equal(b.json.source, 'website_request');
    assert.equal(b.json.status, 'confirmed');
    assert.deepEqual(await booked('ac-1bhk', '2026-12-01', '2026-12-03'), ['2026-12-01', '2026-12-02']);
    assert.equal((await admin('POST', `/requests/${r.json.requestId}/approve`, {})).status, 409, 'only once');
  });

  test('a pending request whose dates were since booked is flagged as a conflict', async () => {
    const r = await enquiry({ name: 'Too Late', room: 'nonac-1bhk', checkIn: '2027-01-20', checkOut: '2027-01-21' });
    await manual({ optionId: 'nonac-1bhk', checkIn: '2027-01-20', checkOut: '2027-01-21', guestName: 'Phone Guest' });
    const req = (await admin('GET', '/requests')).json.find((x: { id: number }) => x.id === r.json.requestId);
    assert.equal(req.conflict, true);
    assert.equal(req.conflictMessage, 'Non-AC 1BHK is already booked on 20 Jan.');
    assert.equal((await admin('POST', `/requests/${r.json.requestId}/approve`, {})).status, 409);
  });

  test('"any room" approval asks the owner to choose a room', async () => {
    const r = await enquiry({ name: 'Any Room', room: 'any', checkIn: '2027-02-10', checkOut: '2027-02-11' });
    const first = await admin('POST', `/requests/${r.json.requestId}/approve`, {});
    assert.equal(first.status, 400);
    assert.equal(first.json.code, 'CHOOSE_OPTION');
    assert.equal((await admin('POST', `/requests/${r.json.requestId}/approve`, { optionId: 'nonac-1bhk' })).status, 200);
  });

  test('decline; pending requests expire after their check-in date', async () => {
    const d = await enquiry({ name: 'Decline Me', checkIn: '2027-03-01', checkOut: '2027-03-02' });
    assert.equal((await admin('POST', `/requests/${d.json.requestId}/decline`, {})).status, 200);
    const e = await enquiry({ name: 'Expire Me', checkIn: '2026-10-12', checkOut: '2026-10-13' });
    const saved = h.clock.ms;
    h.clock.ms = Date.parse('2026-10-13T06:00:00Z');
    const list = (await admin('GET', '/requests')).json;
    h.clock.ms = saved;
    assert.equal(list.find((x: { id: number }) => x.id === d.json.requestId).status, 'declined');
    assert.equal(list.find((x: { id: number }) => x.id === e.json.requestId).status, 'expired');
    assert.equal(list.findIndex((x: { status: string }) => x.status !== 'pending') >= list.filter((x: { status: string }) => x.status === 'pending').length, true, 'pending first');
  });

  test('owner bookings appear in the Sheet as "Added by owner"', async () => {
    await h.settle();
    const rows = [...h.notify!.bookingRows.values()];
    const arjun = rows.find((r) => r.guestName === 'Arjun Das')!;
    assert.equal(arjun.status, 'Confirmed');
    assert.equal(arjun.method, 'Added by owner · Phone');
    assert.ok(rows.some((r) => r.status === 'Blocked' && r.guestName === ''));
  });
});

describe('live updates (SSE)', () => {
  test('an admin stream receives a change event when a booking is made', async () => {
    const ac = new AbortController();
    const res = await fetch(`${h.base}/api/admin/events`, { headers: owner, signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    await manual({ optionId: 'ac-1bhk', checkIn: '2027-04-01', checkOut: '2027-04-02', guestName: 'Live Update' });
    while (!text.includes('"topic":"bookings"')) text += dec.decode((await reader.read()).value);
    ac.abort();
  });

  test('the stream requires admin access', async () => {
    assert.equal((await h.api('GET', '/api/admin/events')).status, 401);
  });
});
