import { Phone } from 'lucide-react';
import { business, groupBooking } from '../data/site';
import { waLink } from '../lib/enquiry';
import { H2 } from './Heading';
import { Img } from './Img';
import { WhatsAppIcon } from './icons';

const GROUP_WHATSAPP_TEXT = [
  'Hello Golden Stay,',
  '',
  'I would like to enquire about booking the entire homestay.',
  '',
  'Booking type: Entire homestay',
  'Dates:',
  'Approx. guests:',
  'Occasion:',
  '',
  'Please let me know the availability, price and any conditions. Thank you.',
].join('\n');

/** Home: "Book the entire homestay" — families, friends, small parties (always "contact for price"). */
export function EntireHomestayBlock() {
  if (!groupBooking.entireHomestay) return null;
  return (
    <section aria-labelledby="entire-title" className="section container-x">
      <div className="on-dark grid gap-6 rounded-[22px] bg-ink p-6 text-white md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-center md:gap-10 md:p-10 lg:p-12">
        <div className="max-w-[720px]">
          <H2 id="entire-title" before="Book the" accent="entire homestay" className="text-white" />
          <p className="mt-4 text-[14.5px] leading-[1.65] text-white/80 md:text-[15.5px]">
            Planning a family gathering, a get-together with friends, a small party or celebration? You can book the whole of Golden Stay. Contact us
            for availability and price.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a
              href={waLink(GROUP_WHATSAPP_TEXT)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn h-12 bg-white px-5 text-[14.5px] text-ink hover:bg-cream"
            >
              <WhatsAppIcon size={17} /> Enquire on WhatsApp
            </a>
            <a href={business.phone.tel} className="btn h-12 border border-white/70 px-5 text-[14.5px] text-white hover:bg-white hover:text-ink">
              <Phone size={16} aria-hidden="true" /> Call {business.phone.display}
            </a>
          </div>
          {groupBooking.partiesAllowed && (
            <p className="mt-5 text-[12.5px] leading-[1.6] text-white/65">
              Parties and events need prior approval from Golden Stay. Please share the date, number of guests and occasion.
            </p>
          )}
        </div>
        <div className="relative hidden overflow-hidden rounded-[16px] md:block md:min-h-[300px] md:self-stretch">
          <Img
            name="common-living-03"
            alt="Living area with a coffee table, wall-mounted TV and doors to the rooms"
            sizes="(min-width: 641px) 45vw, 100vw"
            className="absolute inset-0 size-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}
