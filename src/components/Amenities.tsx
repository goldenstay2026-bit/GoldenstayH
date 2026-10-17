import { Bath, BedDouble, ChefHat, Snowflake, Sofa, Users, type LucideIcon } from 'lucide-react';
import { amenities, type AmenityIcon } from '../data/site';
import { SectionHead } from './Heading';

const ICONS: Record<AmenityIcon, LucideIcon> = {
  bed: BedDouble,
  snowflake: Snowflake,
  kitchen: ChefHat,
  bath: Bath,
  sofa: Sofa,
  users: Users,
};

/** The amenity pills; `only` limits them to a subset (Home highlights). */
export function AmenityPills({ only, large = false }: { only?: readonly string[]; large?: boolean }) {
  const list = only ? amenities.filter((a) => only.includes(a.label)) : amenities;
  return (
    <ul className={`flex flex-wrap gap-2 md:gap-2.5 ${large ? '' : 'justify-center'}`}>
      {list.map(({ label, icon }) => {
        const Icon = ICONS[icon];
        return (
          <li
            key={label}
            className={`pill-outline text-ink ${large ? 'h-12 px-5 text-[14.5px]' : 'h-9 px-3.5 text-[12px] md:h-10 md:px-4 md:text-[13px]'}`}
          >
            <Icon size={large ? 18 : 15} strokeWidth={1.7} className="text-taupe" aria-hidden="true" />
            {label}
          </li>
        );
      })}
    </ul>
  );
}

const HIGHLIGHTS = ['Comfortable Rooms', 'Air Conditioning', 'Living & Dining Area', 'Family Stay'] as const;

/** Home: a short strip of 4 amenities with a link to the Amenities tab. */
export function HighlightsStrip() {
  return (
    <section aria-label="Highlights" className="container-x mt-[18px] md:mt-6">
      <AmenityPills only={HIGHLIGHTS} />
      <p className="mt-3 text-center text-[12.5px]">
        <a href="#amenities" className="link-underline font-semibold">
          See all amenities
        </a>
      </p>
    </section>
  );
}

/** Amenities tab. */
export function Amenities() {
  return (
    <section aria-labelledby="amenities-title" className="section container-x">
      <SectionHead id="amenities-title" before="Our" accent="amenities" lead="What you’ll find at Golden Stay. Ask us if you need anything specific." />
      <AmenityPills large />
    </section>
  );
}
