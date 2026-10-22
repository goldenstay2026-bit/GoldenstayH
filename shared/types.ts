// JSON shapes exchanged between the website and the server API.

import type { OptionId, RoomId } from './catalog.ts';

/** rejected = the owner declined a pending booking; completed = the stay is over. */
export type BookingStatus = 'pending_payment' | 'pending_verification' | 'confirmed' | 'cancelled' | 'expired' | 'rejected' | 'completed';

/** Payment statuses as shown to guests and in the admin. */
export type PaymentStatus = 'pending' | 'pending_verification' | 'successful' | 'failed' | 'refunded';

/** manual = a payment the owner recorded (cash, UPI, bank transfer) for an owner-entered booking. */
export type PaymentMethod = 'gateway' | 'qr' | 'manual';

export type PriceLine = { label: string; amountPaise: number };

export type Quote = {
  roomId: RoomId;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyPaise: number;
  lines: PriceLine[];
  totalPaise: number;
  /** What the guest pays online now (full amount under the current policy). */
  payNowPaise: number;
  available: boolean;
};

export type PublicRoom = { id: RoomId; name: string; pricePaise: number; bookable: boolean };

export type PublicConfig = {
  gatewayEnabled: boolean;
  /** payload: the shop QR's exact contents; amount links add only am/cu/tn to it. */
  qr: { upiId: string; payeeLabel: string; imageUrl: string; payload: string };
  holdMinutes: number;
};

/** What the guest's booking page sees. Never includes other guests' data or secrets. */
export type BookingView = {
  ref: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  roomId: OptionId;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  guestName: string;
  lines: PriceLine[];
  totalPaise: number;
  payNowPaise: number;
  amountPaidPaise: number;
  holdExpiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** Latest payment attempt, summarised. */
  lastPayment: {
    method: PaymentMethod;
    state: string;
    reference: string | null;
    updatedAt: string;
  } | null;
};

export type ApiError = { error: string; code?: string; field?: string };

/** Stay details and house rules the owner edits in Admin → Settings (null/'' = not shown). */
export type PropertySettings = {
  checkInTime: string | null;
  checkOutTime: string | null;
  advanceRequired: string | null;
  freeCancellationHours: number | null;
  lateCancellationCharge: string | null;
  refundDays: number | null;
  smoking: string | null;
  alcohol: string | null;
  pets: string | null;
  visitors: string | null;
  quietHours: string | null;
  securityDeposit: string | null;
  eventDeposit: string | null;
};
