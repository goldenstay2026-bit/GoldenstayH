import { ArrowUpRight } from 'lucide-react';
import { attractions } from '../data/site';
import { SectionHead } from './Heading';
import { LandmarkArt } from './LineArt';

const mapsSearch = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export function AroundUs() {
  return (
    <section aria-labelledby="around-title" className="section container-x">
      <SectionHead
        id="around-title"
        before="Around"
        accent="us"
        lead="Some of Guwahati’s best-known places are within easy reach of Maligaon."
      />
      <ul className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {attractions.map((a) => (
          <li key={a.name}>
            <a
              href={mapsSearch(a.mapsQuery)}
              target="_blank"
              rel="noopener noreferrer"
              className="on-dark group relative isolate block h-[190px] overflow-hidden rounded-[22px] bg-taupe md:h-[262px]"
            >
              <LandmarkArt
                art={a.art}
                className="absolute inset-x-0 top-0 h-[78%] w-full text-white/65 transition-transform duration-700 group-hover:-translate-y-1"
              />
              <span className="tile-arrow absolute right-3 top-3 md:right-4 md:top-4">
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
              <span className="absolute inset-x-3 bottom-3 text-white md:inset-x-4 md:bottom-4">
                <span className="block text-[13px] font-semibold leading-tight md:text-[15px]">{a.name}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/85 md:text-[12px]">{a.caption}</span>
              </span>
              <span className="sr-only"> — view on Google Maps</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
