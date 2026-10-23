// Guest emails through EmailJS: used instead of the Apps Script when set up,
// sent with the server-side private key, and never recorded as sent when
// EmailJS refuses.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authAs, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness({ notify: true, emailjs: true })));
after(() => h.close());

const owner = authAs('u-owner', 'owner@goldenstay.test');
const admin = (method: string, path: string, body?: unknown) => h.api(method, `/api/admin${path}`, body, owner);
const audits = async (ref: string, action: string) =>
  (await admin('GET', `/bookings/${ref}`)).json.history.filter((x: { action: string }) => x.action === action).length;

describe('guest emails via EmailJS', () => {
  test('owner confirms → the guest is emailed through EmailJS, not the Apps Script', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-03-01', checkOut: '2027-03-03' });
    const ref = b.json.booking.ref;
    const appsScriptBefore = h.notify!.guestEmails.length;
    assert.equal((await admin('POST', `/bookings/${ref}/confirm`, { note: 'Paid by UPI' })).status, 200);
    await h.settle();
    const sent = h.notify!.emailjsSends.find((e) => e.template_params.subject.includes(ref));
    assert.ok(sent, 'sent through EmailJS');
    assert.equal(sent.service_id, 'service_test');
    assert.equal(sent.template_id, 'template_test');
    assert.equal(sent.user_id, 'pub_test');
    assert.equal(sent.template_params.to_email, 'riya@example.com');
    assert.equal(sent.template_params.reply_to, 'owner@goldenstay.test');
    assert.match(sent.template_params.subject, /confirmed/);
    assert.match(sent.template_params.message_html, new RegExp(ref));
    assert.match(sent.template_params.message_text, /Non-AC 1BHK/);
    assert.equal(h.notify!.guestEmails.length, appsScriptBefore, 'Apps Script not used');
    assert.equal(await audits(ref, 'email.guest_confirmed_sent'), 1);
  });

  test('rejecting a booking sends the "not accepted" email', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-03-05', checkOut: '2027-03-06' });
    const ref = b.json.booking.ref;
    await admin('POST', `/bookings/${ref}/reject`, { note: 'Dates not available' });
    await h.settle();
    const sent = h.notify!.emailjsSends.find((e) => e.template_params.subject.includes(ref));
    assert.ok(sent);
    assert.equal(await audits(ref, 'email.guest_rejected_sent'), 1);
  });

  test('EmailJS refusing is recorded as failed, and the owner can send it again', async () => {
    const b = await h.book({ roomId: 'nonac-1bhk', checkIn: '2027-03-10', checkOut: '2027-03-11' });
    const ref = b.json.booking.ref;
    h.notify!.mode.emailjs = 'fail';
    await admin('POST', `/bookings/${ref}/confirm`, { note: 'Confirmed' });
    await h.settle();
    const again = await admin('POST', `/bookings/${ref}/email-guest`, {});
    h.notify!.mode.emailjs = 'ok';
    assert.equal(await audits(ref, 'email.guest_confirmed_sent'), 0);
    assert.equal(await audits(ref, 'email.guest_confirmed_failed'), 2);
    assert.equal(again.status, 502);
    assert.match(again.json.error, /EmailJS refused the email \(HTTP 400\): The template ID is invalid/);
    const ok = await admin('POST', `/bookings/${ref}/email-guest`, {});
    assert.equal(ok.status, 200);
    assert.equal(ok.json.to, 'riya@example.com');
    assert.equal(await audits(ref, 'email.guest_confirmed_sent'), 1);
  });

  test('the private key never reaches the browser', async () => {
    const cfg = await h.api('GET', '/api/config');
    assert.doesNotMatch(JSON.stringify(cfg.json), /emailjs-private-test-key|pub_test|service_test/);
  });
});
