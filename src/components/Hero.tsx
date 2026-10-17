import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, MapPin } from 'lucide-react';
import { business, hero } from '../data/site';
import { GENERIC_WA_TEXT, waLink } from '../lib/enquiry';
import { Img } from './Img';
import { LandmarkArt } from './LineArt';
import { QuickEnquiry } from './QuickEnquiry';

const SLIDE_MS = 6000;

function HeroPanel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reduceMotion = useRef(false);

  useEffect(() => {
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Slides 2–3 mount after the page has loaded so they don't delay the first photo.
    if (document.readyState === 'complete') setLoaded(true);
    else {
      const onLoad = () => setLoaded(true);
      window.addEventListener('load', onLoad, { once: true });
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  useEffect(() => {
    if (paused || !loaded || reduceMotion.current) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % hero.slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [paused, loaded]);

  return (
    <div
      className="relative isolate min-h-[520px] overflow-hidden rounded-[22px] bg-ink md:min-h-[560px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {hero.slides.slice(0, loaded ? undefined : 1).map((s, i) => (
        <div
          key={s.image}
          className={`absolute inset-0 -z-10 transition-opacity duration-[1200ms] ease-out ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={i !== index}
        >
          <Img
            name={s.image}
            alt={s.alt}
            sizes="(min-width: 1101px) 67vw, 100vw"
            priority={i === 0}
            className="size-full object-cover"
          />
        </div>
      ))}
      {/* Contrast overlays — top for pills, bottom for the headline */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[55%] bg-gradient-to-t from-black/65 via-black/25 to-transparent" />

      <ul className="absolute left-4 top-4 flex max-w-[250px] flex-wrap gap-2 md:left-5 md:top-5" aria-label="Highlights">
        {hero.pills.map((p) => (
          <li
            key={p}
            className="rounded-full border border-white/80 px-3.5 py-[5px] text-[12.5px] font-medium text-white backdrop-blur-[2px]"
          >
            {p}
          </li>
        ))}
      </ul>

      <div className="absolute right-5 top-5 hidden w-[290px] rounded-[16px] bg-white p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] md:block">
        <p className="text-[13px] leading-[1.5] text-ink">{hero.welcome}</p>
        <a
          href={waLink(GENERIC_WA_TEXT)}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-3 flex h-11 items-center justify-between rounded-full border border-field pl-4 pr-1.5 text-[13px] text-muted transition-colors hover:border-ink hover:text-ink"
        >
          Chat on WhatsApp
          <span className="grid size-8 place-items-center rounded-full bg-ink text-white transition-transform group-hover:translate-x-0.5">
            <ArrowRight size={15} aria-hidden="true" />
          </span>
          <span className="sr-only"> (opens WhatsApp)</span>
        </a>
      </div>

      <h1 className="heading absolute bottom-11 left-5 whitespace-nowrap text-[min(50px,11.6vw)] leading-[0.98] text-white md:bottom-8 md:left-8 md:text-[64px] lg:bottom-9 lg:left-9 lg:text-[76px]">
        Your <span className="accent">Comfort</span>
        <br />
        Outside Home
      </h1>

      <div className="absolute bottom-3 left-3.5 flex gap-1 md:bottom-8 md:left-auto md:right-8 md:gap-1.5" role="group" aria-label="Hero photos">
        {hero.slides.map((s, i) => (
          <button
            key={s.image}
            type="button"
            className="on-dark grid size-6 place-items-center rounded-full"
            aria-label={`Show photo ${i + 1} of ${hero.slides.length}`}
            aria-current={i === index}
            onClick={() => {
              setLoaded(true);
              setIndex(i);
            }}
          >
            <span
              className={`block size-[7px] rounded-full border border-white transition-colors ${
                i === index ? 'bg-white' : 'bg-transparent'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function PropertyCard() {
  return (
    <a
      href={business.directionsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="on-dark group relative isolate block min-h-[196px] overflow-hidden rounded-[22px] bg-ink lg:h-[196px]"
    >
      <Img
        name={hero.propertyImage}
        alt="AC 1BHK bedroom at Golden Stay"
        sizes="(min-width: 1101px) 24vw, (min-width: 641px) 50vw, 100vw"
        className="zoom-img absolute inset-0 -z-10 size-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/15 to-black/10" />
      <span className="tile-arrow absolute right-3.5 top-3.5">
        <ArrowUpRight size={15} aria-hidden="true" />
      </span>
      <div className="absolute inset-x-4 bottom-3.5 text-white">
        <p className="heading text-[30px] leading-none">{business.name}</p>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px]">
          <span className="flex items-center gap-1 text-white/90">
            <MapPin size={12} aria-hidden="true" />
            {business.address.locality}
          </span>
          <span className="link-underline font-medium">Directions</span>
        </div>
      </div>
      <span className="sr-only"> — get directions on Google Maps</span>
    </a>
  );
}

function HeroTiles() {
  return (
    <div className="grid grid-cols-2 gap-[14px] md:col-span-2 lg:col-span-1">
      <a
        href="#around"
        className="on-dark group relative isolate block min-h-[180px] overflow-hidden rounded-[22px] bg-taupe md:min-h-[200px]"
      >
        <LandmarkArt art="house" className="absolute inset-0 size-full text-white/70" />
        <span className="tile-arrow absolute right-3 top-3">
          <ArrowUpRight size={14} aria-hidden="true" />
        </span>
        <span className="absolute bottom-3.5 left-3.5 text-[13px] font-medium text-white">Around Us</span>
      </a>
      <a
        href="#gallery"
        className="on-dark group relative isolate block min-h-[180px] overflow-hidden rounded-[22px] bg-ink md:min-h-[200px]"
      >
        <Img
          name={hero.galleryTileImage}
          alt=""
          sizes="(min-width: 1101px) 12vw, 50vw"
          className="zoom-img absolute inset-0 -z-10 size-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/60 to-transparent" />
        <span className="tile-arrow absolute right-3 top-3">
          <ArrowUpRight size={14} aria-hidden="true" />
        </span>
        <span className="absolute bottom-3.5 left-3.5 text-[13px] font-medium text-white">Gallery</span>
      </a>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-label="Welcome" className="container-x pt-1">
      <div className="grid gap-[14px] lg:grid-cols-[2.84fr_1fr]">
        <HeroPanel />
        <div className="grid gap-[14px] md:grid-cols-2 lg:grid-cols-1 lg:grid-rows-[196px_auto_1fr]">
          <PropertyCard />
          <QuickEnquiry />
          <HeroTiles />
        </div>
      </div>
    </section>
  );
}
