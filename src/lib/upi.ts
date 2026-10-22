// UPI payment links that open the guest's UPI app with Golden Stay chosen as
// the payee. The link is exactly the shop QR's contents: no amount, note or
// transaction reference. UPI apps flag website-set amounts to a merchant UPI ID
// as a risky payment; paying the shop QR and typing the amount is an ordinary
// payment. The guest enters the amount shown on the page.

/** Generic link — Android shows a chooser of installed UPI apps. Also the content of the on-screen QR. */
export const upiLink = (payload: string) => payload;

const params = (payload: string) => payload.slice(payload.indexOf('?') + 1);

/** App-specific links (needed on iPhone, where upi:// has no chooser). */
export const UPI_APPS = [
  { id: 'phonepe', name: 'PhonePe', color: '#5f259f', link: (payload: string) => `phonepe://pay?${params(payload)}` },
  { id: 'gpay', name: 'Google Pay', color: '#1a73e8', link: (payload: string) => `tez://upi/pay?${params(payload)}` },
  { id: 'paytm', name: 'Paytm', color: '#00baf2', link: (payload: string) => `paytmmp://pay?${params(payload)}` },
  { id: 'bhim', name: 'BHIM / other', color: '#ff7a00', link: upiLink },
] as const;

export const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
