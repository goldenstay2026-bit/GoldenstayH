import { Mail, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { business } from '../data/site';
import { GENERIC_WA_TEXT, waLink } from '../lib/enquiry';
import { H2 } from './Heading';
import { WhatsAppIcon } from './icons';
import { LocationPanel } from './LocationPanel';

function Item({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[3px] text-white/85">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/50">{label}</p>
        <div className="mt-0.5 text-[14px] leading-[1.5] text-white">{children}</div>
      </div>
    </li>
  );
}

const linkCls = 'link-underline break-words decoration-white/60 hover:decoration-white';

export function ContactPanel() {
  return (
    <div className="on-dark flex flex-col rounded-[22px] bg-ink p-5 text-white md:p-8">
      <H2 id="contact-title" before="Send us" accent="your dates" className="text-white" />
      <p className="mt-3 max-w-[420px] text-[13.5px] leading-[1.6] text-white/70">
        Planning a stay? Share your details and contact Golden Stay directly to confirm availability.
      </p>

      <ul className="mt-7 space-y-4">
        <Item icon={<WhatsAppIcon size={15} />} label="WhatsApp / Phone">
          <a href={waLink(GENERIC_WA_TEXT)} target="_blank" rel="noopener noreferrer" className={linkCls}>
            {business.phone.display}
            <span className="sr-only"> (WhatsApp)</span>
          </a>
          <span className="text-white/40"> · </span>
          <a href={business.phone.tel} className={`${linkCls} text-[13px] text-white/80`}>
            Call
          </a>
        </Item>
        <Item icon={<Phone size={15} aria-hidden="true" />} label="Alternate contact">
          <a href={business.altPhone.tel} className={linkCls}>
            {business.altPhone.display}
          </a>
        </Item>
        <Item icon={<Mail size={15} aria-hidden="true" />} label="Email">
          <a href={`mailto:${business.email}`} className={linkCls}>
            {business.email}
          </a>
        </Item>
        <Item icon={<MapPin size={15} aria-hidden="true" />} label="Address">
          <a href={business.directionsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
            <address className="not-italic">
              {business.address.line1}
              <br />
              {business.address.line2}, {business.address.city}
            </address>
          </a>
        </Item>
      </ul>

      <div className="mt-8 md:mt-auto md:pt-8">
        <LocationPanel />
      </div>
    </div>
  );
}
