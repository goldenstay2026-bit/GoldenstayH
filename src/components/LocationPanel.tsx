import { ArrowUpRight, MapPin } from 'lucide-react';
import { business } from '../data/site';

/**
 * Location card. Shows a decorative map texture (not a real map) and an
 * "Open in Google Maps" button. Once a verified embed URL is set in
 * `business.mapEmbedUrl`, a real Google Maps iframe is shown instead.
 */
export function LocationPanel() {
  if (business.mapEmbedUrl) {
    return (
      <div className="overflow-hidden rounded-[16px] border border-white/10">
        <iframe
          src={business.mapEmbedUrl}
          title={`Map showing ${business.name}, ${business.address.short}`}
          className="block h-[240px] w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <div className="flex items-center justify-between gap-3 bg-[#222] p-4">
          <p className="text-[13px] text-white/70">{business.address.short}</p>
          <OpenInMaps />
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate overflow-hidden rounded-[16px] bg-[#232323] p-4 md:p-5">
      {/* Abstract grid texture — decorative only, no coordinates implied */}
      <svg
        className="absolute inset-0 -z-10 size-full text-white/[0.07]"
        preserveAspectRatio="none"
        viewBox="0 0 400 140"
        aria-hidden="true"
      >
        <g stroke="currentColor" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke">
          <path d="M0 46h400M0 96h400M90 0v140M200 0v140M300 0v140" />
          <path d="M0 120c80-20 140-70 220-66s120 20 180-10" strokeWidth="1.5" />
        </g>
      </svg>
      <div className="flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white">
          <MapPin size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white">{business.name}</p>
          <p className="text-[12px] text-white/60">{business.address.short}</p>
          <div className="mt-3">
            <OpenInMaps />
          </div>
        </div>
      </div>
    </div>
  );
}

function OpenInMaps() {
  return (
    <a
      href={business.directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="btn h-9 border border-white/80 px-4 text-[12.5px] text-white hover:bg-white hover:text-ink"
    >
      Open in Google Maps
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}
