// UPI amount links: the shop QR's own fields, plus only amount, currency and note.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPI_APPS, upiLink } from '../../src/lib/upi.ts';

const SHOP_QR = 'upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02&purpose=00';

test('amount link = shop QR fields + am/cu/tn, no transaction reference', () => {
  const link = upiLink({ payload: SHOP_QR, amountPaise: 319800, note: 'Golden Stay GS-ABC123' });
  assert.equal(link, 'upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02&purpose=00&am=3198.00&cu=INR&tn=Golden%20Stay%20GS-ABC123');
  const q = new URLSearchParams(link.split('?')[1]);
  assert.equal(q.get('tr'), null);
});

test('app links carry the same fields', () => {
  const p = { payload: SHOP_QR, amountPaise: 159900, note: 'Golden Stay GS-X' };
  for (const app of UPI_APPS) {
    const q = new URLSearchParams(app.link(p).split('?')[1]);
    assert.equal(q.get('pa'), 'Q089453569@ybl', app.id);
    assert.equal(q.get('mc'), '0000', app.id);
    assert.equal(q.get('am'), '1599.00', app.id);
  }
});
