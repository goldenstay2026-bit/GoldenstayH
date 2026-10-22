// The on-screen QR is exactly the shop QR's contents. A website-set amount,
// note or transaction reference makes UPI apps flag the payment as risky.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upiLink } from '../../src/lib/upi.ts';

const SHOP_QR = 'upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02&purpose=00';

test('the QR content is the shop QR itself', () => {
  assert.equal(upiLink(SHOP_QR), SHOP_QR);
  const q = new URLSearchParams(upiLink(SHOP_QR).split('?')[1]);
  assert.deepEqual([...q.keys()], ['pa', 'pn', 'mc', 'mode', 'purpose']);
});
