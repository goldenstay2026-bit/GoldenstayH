// UPI payment: the guest pays inside their own UPI app — by scanning the shop
// QR (shown on screen, or saved and picked from the gallery) or by entering
// the UPI ID — and types the amount shown on the page. That is an ordinary
// payment. Links that open a UPI app from a website with a shop (merchant) UPI
// ID, especially with a website-set amount, are flagged by the apps as risky,
// so the site uses none.

/** Content of the on-screen QR: exactly the shop QR's contents. */
export const upiLink = (payload: string) => payload;

export const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
