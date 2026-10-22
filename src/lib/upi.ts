// UPI payment links with the amount pre-filled (NPCI "UPI linking" format).
// Tapping one on a phone opens the UPI app with payee, amount and note set.
// The link is the shop QR's own contents (payee, name, merchant code, mode)
// plus only the amount, currency and note: apps decline merchant payments
// whose link doesn't match the merchant's QR, and a transaction reference (tr)
// is reserved for orders the merchant's bank created. The original shop QR
// stays available as a fallback.

export type UpiParams = { payload: string; amountPaise: number; note: string };

function query(p: UpiParams) {
  const q = new URLSearchParams(p.payload.slice(p.payload.indexOf('?') + 1));
  q.set('am', (p.amountPaise / 100).toFixed(2));
  q.set('cu', 'INR');
  q.set('tn', p.note.slice(0, 50));
  // UPI apps expect %20 rather than + for spaces, and a plain @ in the UPI ID.
  return q.toString().replace(/\+/g, '%20').replace(/%40/g, '@');
}

/** Generic link — Android shows a chooser of installed UPI apps. Also the content of the amount QR. */
export const upiLink = (p: UpiParams) => `upi://pay?${query(p)}`;

/** App-specific links (needed on iPhone, where upi:// has no chooser). */
export const UPI_APPS = [
  { id: 'phonepe', name: 'PhonePe', color: '#5f259f', link: (p: UpiParams) => `phonepe://pay?${query(p)}` },
  { id: 'gpay', name: 'Google Pay', color: '#1a73e8', link: (p: UpiParams) => `tez://upi/pay?${query(p)}` },
  { id: 'paytm', name: 'Paytm', color: '#00baf2', link: (p: UpiParams) => `paytmmp://pay?${query(p)}` },
  { id: 'bhim', name: 'BHIM / other', color: '#ff7a00', link: upiLink },
] as const;

export const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
