import { Phone } from 'lucide-react';
import { business } from '../data/site';
import { GENERIC_WA_TEXT, waLink } from '../lib/enquiry';
import { WhatsAppIcon } from './icons';

/** Mobile only: floating Call / WhatsApp bar, always one tap away. */
export function MobileActionBar() {
  return (
    <div aria-label="Quick actions" role="region" className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 md:hidden">
      <div className="grid grid-cols-2 gap-1.5 rounded-full border border-hairline bg-white/95 p-1.5 shadow-[0_10px_30px_-10px_rgba(23,23,23,0.35)] backdrop-blur">
        <a href={business.phone.tel} className="btn h-11 text-[13px] text-ink hover:bg-card min-[360px]:text-[14px]">
          <Phone size={16} aria-hidden="true" />
          Call
          <span className="sr-only"> {business.phone.display}</span>
        </a>
        <a
          href={waLink(GENERIC_WA_TEXT)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-dark h-11 gap-1.5 px-2 text-[13px] min-[360px]:gap-2 min-[360px]:text-[14px]"
        >
          <WhatsAppIcon size={16} />
          WhatsApp Enquiry
        </a>
      </div>
    </div>
  );
}
