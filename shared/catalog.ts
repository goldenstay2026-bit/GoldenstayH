// Room catalogue shared by the website and the server.
//
// The server seeds its database from this list on first run; after that the
// DATABASE is the source of truth for prices (editable in the admin). The
// website uses these values only as the prerendered default and then loads
// live prices from /api/rooms.

/** Physical rooms that can be occupied on a given night. */
export const UNITS = ['ac', 'nonac'] as const;
export type Unit = (typeof UNITS)[number];

export type RoomId = 'ac-1bhk' | 'nonac-1bhk' | '2bhk';

export type CatalogRoom = {
  id: RoomId;
  name: string;
  /** Default nightly price in paise (₹1 = 100 paise). */
  pricePaise: number;
  /**
   * Physical rooms this booking occupies. The 2BHK is the AC 1BHK and the
   * Non-AC 1BHK together (owner confirmed), so it holds both units.
   */
  units: Unit[];
};

export const ROOM_CATALOG: CatalogRoom[] = [
  { id: 'ac-1bhk', name: 'AC 1BHK', pricePaise: 159_900, units: ['ac'] },
  { id: 'nonac-1bhk', name: 'Non-AC 1BHK', pricePaise: 129_900, units: ['nonac'] },
  { id: '2bhk', name: '2BHK (AC + Non-AC)', pricePaise: 259_900, units: ['ac', 'nonac'] },
];

export const isRoomId = (v: unknown): v is RoomId => ROOM_CATALOG.some((r) => r.id === v);

/** What the owner can book or block in the admin: the rooms, plus the whole property. */
export type OptionId = RoomId | 'entire';
export type BookingOption = { id: OptionId; name: string; units: Unit[] };
export const BOOKING_OPTIONS: BookingOption[] = [
  ...ROOM_CATALOG.map((r) => ({ id: r.id, name: r.name, units: r.units })),
  // The whole homestay = every physical room. Never priced online ("Contact for price").
  { id: 'entire', name: 'Entire Homestay', units: ['ac', 'nonac'] },
];
export const isOptionId = (v: unknown): v is OptionId => BOOKING_OPTIONS.some((o) => o.id === v);
export const optionById = (id: OptionId) => BOOKING_OPTIONS.find((o) => o.id === id)!;

/** Short unit labels (calendar markers) and the room each unit is. */
export const UNIT_LABEL: Record<Unit, string> = { ac: 'AC', nonac: 'Non-AC' };
export const UNIT_ROOM_NAME: Record<Unit, string> = { ac: 'AC 1BHK', nonac: 'Non-AC 1BHK' };

/** "₹1,599" from 159900 paise (drops ".00", keeps real paise). */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
