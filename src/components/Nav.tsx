import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { UserRound } from 'lucide-react';
import { business } from '../data/site';
import { TABS, useRouter } from '../lib/router';

const logoSrc = `${import.meta.env.BASE_URL}images/opt/logo-96.webp`;

/** Wordmark: the name in the sans, capitals, lightly tracked. */
export function Brand({ size = 'nav' }: { size?: 'nav' | 'footer' }) {
  return (
    <span className="flex items-center gap-2.5">
      {size === 'nav' && <img src={logoSrc} alt="" width={40} height={40} className="size-9 rounded-full lg:size-10" />}
      <span className={`wordmark text-ink ${size === 'nav' ? 'text-[17px] lg:text-[19px]' : 'text-[18px]'}`}>{business.name}</span>
    </span>
  );
}

/**
 * Sticky header = the tab bar. Desktop (>1100px): tabs centred in the bar.
 * Below that: a horizontally scrollable tab strip under the logo. One tablist
 * either way (WAI-ARIA tabs pattern: arrow keys, Home/End, roving tabindex).
 */
export function Nav() {
  const { route, navigate } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeTab = TABS.some((t) => t.id === route) ? route : null;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the active tab visible in the scrollable strip.
  useEffect(() => {
    const strip = stripRef.current;
    const el = activeTab ? document.getElementById(`tab-${activeTab}`) : null;
    if (!strip || !el || strip.scrollWidth <= strip.clientWidth) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [activeTab]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => `tab-${t.id}` === (document.activeElement as HTMLElement | null)?.id);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const tab = TABS[(next + TABS.length) % TABS.length];
    // Focus moves with the arrow immediately; it stays on the tab after the switch too.
    document.getElementById(`tab-${tab.id}`)?.focus();
    navigate(tab.id, () => document.getElementById(`tab-${tab.id}`)?.focus());
  };

  return (
    <header
      className={`sticky top-0 z-40 bg-white transition-shadow duration-200 ${
        scrolled ? 'shadow-[0_1px_0_var(--color-hairline),0_6px_24px_-12px_rgba(23,23,23,0.18)]' : ''
      }`}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="container-x relative">
        <div className="flex h-16 items-center justify-between gap-4 md:h-[72px] lg:h-[84px]">
          <a href="#home" aria-label="Golden Stay — home" className="shrink-0 rounded-full">
            <Brand />
          </a>
          <a
            href="/account/"
            className="flex items-center gap-1.5 rounded-full bg-card px-3 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-beige lg:bg-transparent lg:hover:bg-card"
            aria-label="My account"
          >
            <UserRound size={17} aria-hidden="true" />
            <span className="hidden md:inline">My account</span>
          </a>
        </div>

        <div
          ref={stripRef}
          role="tablist"
          aria-label="Sections"
          onKeyDown={onKeyDown}
          className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8 lg:absolute lg:left-1/2 lg:top-0 lg:mx-0 lg:h-[84px] lg:-translate-x-1/2 lg:items-center lg:overflow-visible lg:p-0"
        >
          {TABS.map((t) => {
            const selected = t.id === activeTab;
            return (
              <a
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                href={`#${t.id}`}
                aria-selected={selected}
                aria-controls={`panel-${t.id}`}
                aria-current={selected ? 'page' : undefined}
                tabIndex={selected || (!activeTab && t.id === 'home') ? 0 : -1}
                className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full px-3.5 text-[14px] font-medium transition-colors lg:min-h-[40px] lg:px-3 lg:text-[13.5px] ${
                  selected ? 'bg-taupe text-white' : 'text-ink/80 hover:bg-card hover:text-ink'
                }`}
              >
                {t.label}
              </a>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
