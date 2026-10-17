// Policy page text, built from the owner-decided values in site.ts (`policies`).
// RULE: a sentence or bullet that needs a value which is still null is left
// out entirely — never a blank, "TBD" or placeholder.

import type { PolicyId } from '../lib/router';
import { business, groupBooking, policies as p } from './site';

export type Clause = { id: string; heading: string; paragraphs: string[] };
export type Rule = { icon: RuleIcon; text: string };
export type RuleIcon = 'clock' | 'users' | 'id' | 'party' | 'smoking' | 'alcohol' | 'pets' | 'visitors' | 'quiet' | 'lights' | 'kitchen' | 'damage';
export type PolicyDoc = { id: PolicyId; title: string; intro?: string; clauses: Clause[]; rules?: Rule[]; outro?: string };

/** Joins the non-null sentences of a paragraph; null when nothing is left. */
const para = (...parts: (string | null | false | undefined)[]) => {
  const kept = parts.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return kept.length ? kept.join(' ') : null;
};
const clause = (id: string, heading: string, ...paragraphs: (string | null)[]): Clause | null => {
  const kept = paragraphs.filter((x): x is string => x !== null);
  return kept.length ? { id, heading, paragraphs: kept } : null;
};
const clauses = (...c: (Clause | null)[]) => c.filter((x): x is Clause => x !== null);

const address = 'House No. 2, Sati Joymati Nagar, BG Colony, Maligaon, Guwahati, Assam';
const contactLine = `${business.phone.display} · ${business.altPhone.display} · ${business.email}`;

const terms: PolicyDoc = {
  id: 'terms',
  title: 'Terms & Conditions',
  clauses: clauses(
    clause('about', 'About these terms', `These terms apply to enquiries and stays at Golden Stay, ${address}. By enquiring or staying, guests agree to them.`),
    clause(
      'enquiries',
      'Enquiries are not bookings',
      para(
        'Submitting the enquiry form sends your details to Golden Stay so we can reply to you; you can also send them to us on WhatsApp.',
        `A booking is confirmed only when Golden Stay confirms it directly by WhatsApp or phone${p.advanceRequired ? `, and the advance of ${p.advanceRequired} is received` : ''}.`,
        'Bookings made online on this website are confirmed only after Golden Stay has verified your payment.',
      ),
    ),
    clause(
      'prices',
      'Prices',
      'Prices shown on the website are per night and may change. Golden Stay will confirm the final price before booking, and the price confirmed at booking applies to that stay.',
    ),
    clause(
      'check-in',
      'Check-in and check-out',
      para(
        p.checkInTime && `Check-in is from ${p.checkInTime}.`,
        p.checkOutTime && `Check-out is by ${p.checkOutTime}.`,
        'Early check-in or late check-out depends on availability and should be requested in advance.',
      ),
    ),
    clause(
      'identification',
      'Identification',
      'All adult guests, including couples, must show a valid government-issued photo ID at check-in. Foreign nationals must provide their passport and visa, as required by Indian law. Golden Stay may refuse check-in if valid ID is not provided.',
    ),
    groupBooking.entireHomestay
      ? clause(
          'entire-homestay',
          'Entire homestay and party bookings',
          para(
            'The whole property can be booked for groups, gatherings and small celebrations.',
            groupBooking.partiesAllowed && 'Parties and events need prior approval from Golden Stay.',
            'The guest count, occasion, timings and any special conditions must be agreed before the booking is confirmed. The number of guests must not exceed what was agreed.',
            p.eventDeposit && `A deposit of ${p.eventDeposit} may be collected for these bookings.`,
            'The organiser is responsible for all guests’ conduct and for any damage.',
          ),
        )
      : null,
    clause(
      'responsibility',
      'Guest responsibility',
      para(
        'Guests are responsible for any damage to the property or its contents caused during their stay, and may be charged for repair or replacement.',
        p.securityDeposit && `A refundable security deposit of ${p.securityDeposit} may be collected at check-in.`,
      ),
    ),
    clause(
      'conduct',
      'Conduct',
      'Guests must follow the House Rules and local laws. Golden Stay may end a stay without refund in cases of serious disturbance to neighbours, damage, unapproved events or illegal activity.',
    ),
    clause('belongings', 'Belongings', 'Guests are responsible for their own belongings. Golden Stay is not liable for loss or theft of personal items left unattended.'),
    clause(
      'changes',
      'Changes and interruptions',
      'In rare cases, such as power or water supply problems, repairs, or events outside our control, Golden Stay will try to offer a suitable alternative or a refund for the affected nights.',
    ),
    clause('website', 'Website', 'Photos show the actual property, though furnishings may change slightly. Room details are described as accurately as possible.'),
    clause('law', 'Governing law', 'These terms are governed by the laws of India. Any disputes are subject to the courts of Guwahati, Assam.'),
    clause('contact', 'Contact', contactLine),
  ),
};

// Kept accurate to how this website actually works: enquiries reach the owner
// (Telegram + Google Sheet), online bookings are stored on our booking system,
// guest accounts use Google Firebase. Update this page if that changes.
const privacy: PolicyDoc = {
  id: 'privacy',
  title: 'Privacy Policy',
  clauses: clauses(
    clause(
      'what',
      'What we collect',
      'When you send an enquiry, your details (name, phone, dates, guests, booking type, room preference, occasion and message) are saved securely so Golden Stay can reply and manage your booking. They are also placed into a WhatsApp message on your device.',
      'When you book online, we also keep your account email, your booking details and the payment reference (UPI UTR) you give us. We never ask for or store UPI PINs, card numbers or bank passwords.',
    ),
    clause(
      'where',
      'Where it is kept',
      'Your details are kept on the Golden Stay booking system and in our booking records (Google Sheets). Guest accounts are managed with Google Firebase. New enquiries and bookings are also sent to the owner by Telegram and email.',
    ),
    clause('use', 'How we use it', 'Only to reply to your enquiry and manage your booking.'),
    clause(
      'retention',
      'How long we keep it',
      'Enquiry and booking records are kept only as long as needed to manage bookings and meet legal requirements, and can be deleted on request.',
    ),
    clause('check-in', 'At check-in', 'We collect ID details as required by law, and use them only for that purpose.'),
    clause('sharing', 'Sharing', 'We do not sell or share your personal information, except where the law requires it.'),
    clause(
      'third-parties',
      'Third parties',
      'WhatsApp, Telegram, Google (Maps, Sheets, Gmail and Firebase), PhonePe and Instagram are governed by those companies’ own privacy policies.',
    ),
    clause(
      'cookies',
      'Cookies',
      'This website does not use tracking or advertising cookies. If you sign in, your browser keeps you signed in using its own storage, and the owner’s admin login uses one essential cookie.',
    ),
    clause(
      'rights',
      'Your rights',
      `You may ask us to access, correct or delete your information by emailing ${business.email}, in line with India’s Digital Personal Data Protection Act, 2023.`,
    ),
  ),
};

const cancellationValuesKnown = p.freeCancellationHours !== null || p.lateCancellationCharge !== null || p.refundDays !== null;

const cancellation: PolicyDoc = {
  id: 'cancellation',
  title: 'Cancellation & Refund Policy',
  intro: cancellationValuesKnown
    ? undefined
    : `For cancellations or changes to your booking, please contact us on WhatsApp at ${business.phone.display} as early as possible.`,
  clauses: clauses(
    cancellationValuesKnown && p.freeCancellationHours !== null
      ? clause('free', 'Free cancellation', `Cancel at least ${p.freeCancellationHours} hours before check-in for a full refund of any advance paid.`)
      : null,
    cancellationValuesKnown && p.freeCancellationHours !== null && p.lateCancellationCharge !== null
      ? clause(
          'late',
          'Late cancellation',
          `For cancellations within ${p.freeCancellationHours} hours of check-in, and for no-shows, ${p.lateCancellationCharge}.`,
        )
      : null,
    cancellationValuesKnown ? clause('early-departure', 'Early departure', 'Unused nights after check-in are not refundable unless agreed with Golden Stay.') : null,
    cancellationValuesKnown && p.refundDays !== null
      ? clause('refunds', 'Refunds', `Approved refunds are made to the original payment method within ${p.refundDays} working days.`)
      : null,
    groupBooking.entireHomestay
      ? clause('entire-homestay', 'Entire homestay and party bookings', 'Cancellation terms for these bookings are agreed individually at the time of booking.')
      : null,
    clause('changes', 'Changes', 'Date changes depend on availability, so please contact us as early as possible.'),
    clause('we-cancel', 'If we cancel', 'If Golden Stay has to cancel a confirmed booking, any advance paid is fully refunded.'),
  ),
};

const checkInOut = para(p.checkInTime && `Check-in from ${p.checkInTime}`, p.checkOutTime && `Check-out by ${p.checkOutTime}`)?.replace(/ (Check-out)/, ' · $1');

const houseRules: PolicyDoc = {
  id: 'house-rules',
  title: 'House Rules',
  clauses: [],
  rules: (
    [
      checkInOut && { icon: 'clock', text: checkInOut },
      groupBooking.coupleFriendly && { icon: 'users', text: 'Couples are welcome; valid photo ID is required for both guests' },
      { icon: 'id', text: 'Valid photo ID required for all adult guests' },
      groupBooking.partiesAllowed && {
        icon: 'party',
        text: 'Parties and events are allowed only with prior approval, and only for the agreed number of guests and timings',
      },
      p.smoking && { icon: 'smoking', text: `Smoking: ${p.smoking}` },
      p.alcohol && { icon: 'alcohol', text: `Alcohol: ${p.alcohol}` },
      p.pets && { icon: 'pets', text: `Pets: ${p.pets}` },
      p.visitors && { icon: 'visitors', text: `Visitors: ${p.visitors}` },
      p.quietHours && { icon: 'quiet', text: `Quiet hours: ${p.quietHours}. Please be considerate of neighbours, especially during gatherings.` },
      { icon: 'lights', text: 'Please switch off lights, fans and AC when leaving the room' },
      { icon: 'kitchen', text: 'Please keep the kitchen and shared areas clean after use' },
      { icon: 'damage', text: 'Report any damage or problems to the host right away' },
    ] as (Rule | false | null | undefined | '')[]
  ).filter((r): r is Rule => Boolean(r)),
  outro: 'Thank you for helping us keep Golden Stay comfortable for every guest.',
};

export const POLICY_DOCS: Record<PolicyId, PolicyDoc> = { terms, privacy, cancellation, 'house-rules': houseRules };

/** Values still null — listed in the README for the owner to confirm before launch. */
export const missingPolicyValues = () => Object.entries(p).filter(([, v]) => v === null).map(([k]) => k);
