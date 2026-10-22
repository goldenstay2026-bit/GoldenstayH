// UPI links: exactly the shop QR's contents. A website-set amount, note or
// transaction reference makes UPI apps flag the payment as risky.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPI_APPS, upiLink } from '../../src/lib/upi.ts';

const SHOP_QR = 'upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02&purpose=00';

test('the generic link is the shop QR itself', () => {
  assert.equal(upiLink(SHOP_QR), SHOP_QR);
});

test('app links carry the shop QR fields and nothing else', () => {
  for (const app of UPI_APPS) {
    const q = new URLSearchParams(app.link(SHOP_QR).split('?')[1]);
    assert.deepEqual([...q.keys()], ['pa', 'pn', 'mc', 'mode', 'purpose'], app.id);
    assert.equal(q.get('pa'), 'Q089453569@ybl', app.id);
  }
});
