import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createOwnerLinkToken } from '../ownerLinks.ts';
import { OWNER_LINK_SECRET, startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => (h = await startHarness({ notify: true })));
after(() => h.close());
beforeEach(() => (h.notify!.emails.length = 0));

const verifyEmails = () => h.notify!.emails.filter((e) => String(e.subject).startsWith('💳'));
const tokenFrom = (html: string) => decodeURIComponent(/\/confirm\/\?t=([^"&]+)/.exec(html)![1]);

// Each booking needs its own UTR (a reference can't be reused across bookings).
const freshUtr = () => String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));

async function paid(over: Record<string, unknown>, utr = freshUtr()) {
  const b = await h.book(over);
  const r = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr }, h.guest(b.json.token));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'pending_verification');
  // The verify email is sent in the background; wait until it has arrived.
  for (let i = 0; i < 50 && !verifyEmails().some((e) => String(e.subject).includes(b.json.booking.ref)); i++) await h.settle();
  return { ref: b.json.booking.ref as string, token: b.json.token as string };
}

describe('"I have paid" → owner email with Review & confirm link', () => {
  test('the owner gets a verify email with the amount, the UTR and a link', async () => {
    const { ref } = await paid({ roomId: 'nonac-1bhk', checkIn: '2026-11-20', checkOut: '2026-11-22' }, '412398765432');
    const mails = verifyEmails();
    assert.equal(mails.length, 1);
    assert.equal(mails[0].subject, `💳 Payment to verify – ${ref} · ₹2,598 · Riya Sharma`);
    assert.match(mails[0].html, /Review &amp; confirm booking/);
    assert.match(mails[0].html, /412398765432/);
    assert.match(mails[0].html, /https:\/\/goldenstay\.test\/confirm\/\?t=/);
  });

  test('the link shows the booking, and Confirm confirms it (once)', async () => {
    const { ref, token } = await paid({ roomId: 'ac-1bhk', checkIn: '2026-12-01', checkOut: '2026-12-03' }, '612345678912');
    const t = tokenFrom(verifyEmails()[0].html);
    const info = await h.api('GET', `/api/owner-action/${encodeURIComponent(t)}`);
    assert.equal(info.status, 200);
    assert.equal(info.json.ref, ref);
    assert.equal(info.json.paymentState, 'submitted');
    assert.equal(info.json.amountPaise, 319_800);
    assert.equal(info.json.utr, '612345678912');

    const ok = await h.api('POST', `/api/owner-action/${encodeURIComponent(t)}`, { decision: 'confirm' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.bookingStatus, 'confirmed');
    const v = await h.api('GET', `/api/bookings/${ref}`, undefined, h.guest(token));
    assert.equal(v.json.status, 'confirmed');
    await h.settle();
    assert.equal(h.notify!.emails.filter((e) => String(e.subject).startsWith('✅')).length, 1, 'confirmation email follows');

    const again = await h.api('POST', `/api/owner-action/${encodeURIComponent(t)}`, { decision: 'confirm' });
    assert.equal(again.status, 409);
    assert.equal((await h.api('GET', `/api/owner-action/${encodeURIComponent(t)}`)).json.paymentState, 'verified');
  });

  test('Reject cancels the booking and frees the room', async () => {
    const { ref } = await paid({ roomId: '2bhk', checkIn: '2027-01-10', checkOut: '2027-01-11' });
    const t = tokenFrom(verifyEmails()[0].html);
    const r = await h.api('POST', `/api/owner-action/${encodeURIComponent(t)}`, { decision: 'reject', reason: 'No payment found' });
    assert.equal(r.json.bookingStatus, 'cancelled');
    await h.login();
    const d = await h.api('GET', `/api/admin/bookings/${ref}`);
    assert.ok(
      d.json.history.some(
        (x: { action: string; actor: string; details: string }) => x.action === 'payment.qr_rejected' && x.actor === 'owner-email-link' && x.details.includes('No payment found'),
      ),
    );
    h.clearCookie();
    assert.equal((await h.book({ roomId: 'ac-1bhk', checkIn: '2027-01-10', checkOut: '2027-01-11' })).status, 201);
  });

  test('tampered, foreign or expired links are refused', async () => {
    await paid({ roomId: 'nonac-1bhk', checkIn: '2027-02-10', checkOut: '2027-02-11' });
    const t = tokenFrom(verifyEmails()[0].html);
    const [id, exp, sig] = t.split('.');
    assert.equal((await h.api('GET', `/api/owner-action/${encodeURIComponent(`${Number(id) + 1}.${exp}.${sig}`)}`)).status, 404);
    assert.equal((await h.api('GET', `/api/owner-action/${encodeURIComponent(createOwnerLinkToken('some-other-secret', Number(id), h.clock.ms))}`)).status, 404);
    assert.equal((await h.api('GET', '/api/owner-action/garbage')).status, 404);
    const expired = createOwnerLinkToken(OWNER_LINK_SECRET, Number(id), h.clock.ms - 8 * 86_400_000);
    assert.equal((await h.api('GET', `/api/owner-action/${encodeURIComponent(expired)}`)).status, 410);
    assert.equal((await h.api('POST', `/api/owner-action/${encodeURIComponent(t)}`, { decision: 'maybe' })).status, 400);
  });

  test('an invalid UTR is still rejected; a valid one is kept', async () => {
    const b = await h.book({ roomId: 'ac-1bhk', checkIn: '2027-03-01', checkOut: '2027-03-02' });
    const bad = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '123' }, h.guest(b.json.token));
    assert.equal(bad.status, 400);
    const good = await h.api('POST', `/api/bookings/${b.json.booking.ref}/pay/qr`, { utr: '7123 4567 8912' }, h.guest(b.json.token));
    assert.equal(good.json.lastPayment.reference, '712345678912');
  });
});
