// All site content lives here. Edit this file to update details, prices or
// photos — components read from it and contain no business copy of their own.
//
// Honesty rule: only owner-supplied facts. No invented reviews, ratings,
// guest counts, bed types, amenities, distances or coordinates.

import { ROOM_CATALOG, type RoomId } from '../../shared/catalog.ts';

const catalogPrice = (id: RoomId) => ROOM_CATALOG.find((r) => r.id === id)!.pricePaise / 100;

export const business = {
  name: 'Golden Stay',
  tagline: 'Your Comfort Outside Home',
  address: {
    line1: 'House No. 2, Sati Joymati Nagar, BG Colony,',
    line2: 'Maligaon, near Shiv Mandir',
    city: 'Guwahati, Assam',
    short: 'BG Colony, Maligaon, Guwahati, Assam',
    locality: 'Maligaon, Guwahati, Assam',
  },
  phone: {
    display: '+91 91010 87949',
    tel: 'tel:+919101087949',
    wa: '919101087949',
  },
  altPhone: {
    display: '+91 86382 23966',
    tel: 'tel:+918638223966',
  },
  email: 'goldenstay2026@gmail.com',
  directionsUrl: 'https://share.google/dSScqUrmMmO0lIctJ',
  // Replace with the direct "write a review" link from Google Business Profile
  // (Share review form) once available; the listing link works meanwhile.
  reviewUrl: 'https://share.google/dSScqUrmMmO0lIctJ',
  instagram: {
    handle: '@thegoldenstay_',
    url: 'https://www.instagram.com/thegoldenstay_?stkn=bzZ3azZ0b3p6M2R2',
  },
  // Paste the verified "Embed a map" iframe src from the Google listing here.
  // Until then the location panel shows an "Open in Google Maps" button only.
  mapEmbedUrl: '' as string,
  credit: { name: 'Webro Studios', url: 'https://www.webrostudios.space' },
} as const;

export const navLinks = [
  { label: 'About', href: '#about' },
  { label: 'Rooms', href: '#rooms' },
  { label: 'Around Us', href: '#around' },
  { label: 'Reviews', href: '#reviews' },
] as const;

export type { RoomId };

export type Room = {
  id: RoomId;
  name: string;
  /** Default price per night in INR (from shared/catalog.ts). Live prices come from /api/rooms. */
  price: number | null;
  description: string;
  badge: string;
  image: string;
  alt: string;
};

export const rooms: Room[] = [
  {
    id: 'ac-1bhk',
    name: 'AC 1BHK',
    price: catalogPrice('ac-1bhk'),
    description: 'A comfortable air-conditioned 1BHK for a relaxing stay.',
    badge: 'AC',
    image: 'ac-1bhk-01',
    alt: 'AC 1BHK bedroom with a double bed, wooden-look flooring and a sofa chair',
  },
  {
    id: 'nonac-1bhk',
    name: 'Non-AC 1BHK',
    price: catalogPrice('nonac-1bhk'),
    description: 'A practical and comfortable 1BHK for your stay.',
    badge: 'Non-AC',
    image: 'nonac-1bhk-01',
    alt: 'Non-AC 1BHK bedroom with a double bed, yellow bedspread and seating by the window',
  },
  {
    id: '2bhk',
    name: '2BHK (AC + Non-AC)',
    price: catalogPrice('2bhk'),
    description: 'A spacious two-bedroom option for families and groups.',
    badge: 'AC + Non-AC',
    image: '2bhk-composite',
    alt: 'The two bedrooms of the 2BHK side by side: the AC room and the Non-AC room',
  },
];

export const formatINR = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Label used in the form dropdown and in the WhatsApp message */
export const roomLabel = (room: Room) =>
  room.price === null ? `${room.name} — Contact for price` : `${room.name} — ${formatINR(room.price)}/night`;

export const ANY_ROOM = 'any' as const;
export const ANY_ROOM_LABEL = 'Any available room';

export const lowestPrice = Math.min(...rooms.flatMap((r) => (r.price === null ? [] : [r.price])));

// Amenities visible in the photos — owner to confirm before launch.
// Do not add Wi-Fi, parking, meals, hot water or pickup unless confirmed.
export const amenities = [
  { label: 'Comfortable Rooms', icon: 'bed' },
  { label: 'Air Conditioning', icon: 'snowflake' },
  { label: 'Kitchen Facilities', icon: 'kitchen' },
  { label: 'Bathroom Facilities', icon: 'bath' },
  { label: 'Living & Dining Area', icon: 'sofa' },
  { label: 'Family Stay', icon: 'users' },
] as const;

export type AmenityIcon = (typeof amenities)[number]['icon'];

// Distances deliberately omitted until measured from the property pin.
export const attractions = [
  {
    name: 'Kamakhya Temple',
    caption: 'Nilachal Hill · a short drive away',
    art: 'temple',
    mapsQuery: 'Kamakhya Temple, Guwahati',
  },
  {
    name: 'Assam State Museum',
    caption: 'Dighalipukhuri, city centre',
    art: 'museum',
    mapsQuery: 'Assam State Museum, Guwahati',
  },
  {
    name: 'Umananda Temple',
    caption: 'Peacock Island · by ferry',
    art: 'island',
    mapsQuery: 'Umananda Temple, Guwahati',
  },
  {
    name: 'Brahmaputra Riverfront',
    caption: 'Sunset views by the river',
    art: 'river',
    mapsQuery: 'Brahmaputra Riverfront, Guwahati',
  },
] as const;

export type AttractionArt = (typeof attractions)[number]['art'];

export type Photo = { image: string; caption: string; alt: string };

// First seven appear in the grid (in this order); the rest are lightbox extras.
export const gallery: Photo[] = [
  {
    image: 'common-living-04',
    caption: 'Living area',
    alt: 'Living area with a striped sofa, coffee table and an arched door set in a yellow brick-style wall',
  },
  {
    image: 'common-living-03',
    caption: 'Living area',
    alt: 'Living area with a coffee table, wall-mounted TV and doors to the rooms',
  },
  {
    image: 'ac-1bhk-03',
    caption: 'AC 1BHK',
    alt: 'AC 1BHK room with wooden-look flooring, a sofa chair and framed art on the wall',
  },
  {
    image: 'nonac-1bhk-02',
    caption: 'Non-AC 1BHK',
    alt: 'Non-AC 1BHK room with a double bed, yellow bedspread and chairs by an arched window',
  },
  {
    image: 'common-dining-01',
    caption: 'Dining nook',
    alt: 'Dining nook with a small table and chairs under pendant lights and string lights',
  },
  {
    image: 'common-bathroom-collage',
    caption: 'Bathroom',
    alt: 'Three views of the tiled bathroom with a water heater and buckets',
  },
  {
    image: 'ac-1bhk-wall-art',
    caption: 'Details',
    alt: 'Framed bird artwork hanging on a bedroom wall',
  },
  {
    image: 'ac-1bhk-04',
    caption: 'AC 1BHK',
    alt: 'AC 1BHK room with a floral bedsheet on the bed and a sofa chair by the wall',
  },
  {
    image: 'ac-1bhk-05',
    caption: 'AC 1BHK',
    alt: 'AC 1BHK room seen from the bed towards the curtained windows and air conditioner',
  },
  {
    image: 'nonac-1bhk-03',
    caption: 'Non-AC 1BHK',
    alt: 'Non-AC 1BHK room with a double bed, two chairs and wall decorations',
  },
  {
    image: 'nonac-1bhk-04',
    caption: 'Non-AC 1BHK',
    alt: 'Non-AC 1BHK room with a double bed beside a curtained window',
  },
  {
    image: 'nonac-1bhk-05',
    caption: 'Non-AC 1BHK',
    alt: 'Evening view of the Non-AC 1BHK room with the bed and seating',
  },
  {
    image: 'nonac-1bhk-06',
    caption: 'Non-AC 1BHK',
    alt: 'Non-AC 1BHK room showing the bed, chairs and wooden cupboard',
  },
  {
    image: 'common-living-01',
    caption: 'Living area',
    alt: 'Wide view of the living area with an orange sofa, floor lamp and coffee table',
  },
];

export const GALLERY_GRID_COUNT = 7;

export const hero = {
  pills: ['Homestay', 'Comfortable Stay', 'Maligaon'],
  welcome: 'Welcome to Golden Stay. Find a comfortable place to relax, recharge, and enjoy your stay in Maligaon.',
  slides: [
    {
      image: 'common-living-wide-01',
      alt: 'Golden Stay living area with an orange striped sofa, coffee table and arched door',
    },
    {
      image: 'common-living-wide-02',
      alt: 'Another view of the Golden Stay living area with marble-look flooring and a floor lamp',
    },
    { image: 'ac-1bhk-01', alt: 'AC 1BHK bedroom with a double bed and wooden-look flooring' },
  ],
  propertyImage: 'ac-1bhk-02',
  galleryTileImage: 'common-dining-02',
};

export const about = {
  tag: 'Welcome to Golden Stay',
  image: 'common-living-02',
  imageAlt: 'Corner of the living area with an orange sofa, a floor lamp, a potted plant and folk art on the wall',
  paragraph:
    'Golden Stay offers a choice of accommodation options in Maligaon, Guwahati, for guests looking for a comfortable place to stay. Whether you are looking for a 1BHK or a larger 2BHK, get in touch with us to discuss your requirements and confirm availability.',
};

export const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_GUESTS = 2;

// ---------- Couples & entire homestay / parties ----------

export const groupBooking = {
  coupleFriendly: true,
  entireHomestay: true, // the whole property can be booked
  partiesAllowed: true, // parties/events allowed with prior approval
} as const;

export const COUPLE_NOTE = 'Couple-friendly · Valid photo ID required for both guests.';

/** Shown after the room cards. Never priced online — always "Contact for price". */
export const entireHomestay = {
  name: 'Entire Homestay',
  badge: 'Groups & Events',
  description: 'Book the whole property for families, groups, get-togethers or small celebrations.',
  image: 'common-living-wide-01',
  alt: 'The Golden Stay living area with an orange striped sofa, coffee table and arched door — available with the whole homestay',
};

// ---------- Policies ----------
// Owner-decided values. null = not confirmed yet: the sentence or bullet that
// uses it is left out entirely. Never fill these in without the owner.

export const policies = {
  lastUpdated: '2026-10-16',
  checkInTime: null as string | null, // e.g. "12:00 PM"
  checkOutTime: null as string | null, // e.g. "11:00 AM"
  advanceRequired: null as string | null, // e.g. "50% of the first night's tariff"
  freeCancellationHours: null as number | null, // e.g. 48
  lateCancellationCharge: null as string | null, // e.g. "the advance paid is non-refundable"
  refundDays: null as number | null, // e.g. 7
  smoking: null as string | null, // e.g. "not allowed indoors"
  alcohol: null as string | null,
  pets: null as string | null,
  visitors: null as string | null, // e.g. "allowed until 9 PM"
  quietHours: null as string | null, // e.g. "10 PM – 7 AM"
  securityDeposit: null as string | null,
  eventDeposit: null as string | null, // deposit for parties / entire-homestay bookings
};
