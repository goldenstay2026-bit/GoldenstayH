// JSON shapes exchanged between the website and the server API.

import type { OptionId, RoomId } from './catalog.ts';

export type BookingStatus = 'pending_payment' | 'pending_verification' | 'confirmed' | 'cancelled' | 'expired';

/** Payment statuses as shown to guests and in the admin. */
export type PaymentStatus = 'pending' | 'pending_verification' | 'successful' | 'failed' | 'refunded';

export type PaymentMethod = 'gateway' | 'qr';

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
  qr: { upiId: string; payeeLabel: string; imageUrl: string };
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
