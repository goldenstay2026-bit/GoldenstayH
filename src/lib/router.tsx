// Hash routing for the tabbed homepage: #home, #rooms, … plus policy pages
// (#terms, #privacy, #cancellation, #house-rules). The URL is the source of
// truth, so Back/Forward move between tabs and direct links work. Every panel
// stays in the DOM (hidden), so all content is crawlable and form state is kept.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'around', label: 'Around Us' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'contact', label: 'Contact' },
] as const;

export const POLICY_PAGES = {
  terms: 'Terms & Conditions',
  privacy: 'Privacy Policy',
  cancellation: 'Cancellation & Refund Policy',
  'house-rules': 'House Rules',
} as const;

export type TabId = (typeof TABS)[number]['id'];
export type PolicyId = keyof typeof POLICY_PAGES;
export type RouteId = TabId | PolicyId;

const DEFAULT_TITLE = 'Golden Stay | Comfortable Homestay in Maligaon, Guwahati';
const isTab = (v: string): v is TabId => TABS.some((t) => t.id === v);
export const isPolicy = (v: string): v is PolicyId => v in POLICY_PAGES;

/** Old single-page anchors still land in the right place. */
const LEGACY: Record<string, { route: RouteId; anchor?: string }> = {
  top: { route: 'home' },
  about: { route: 'home', anchor: 'about' },
  enquiry: { route: 'contact' },
};

/** "#rooms" → rooms; "#terms--prices" → terms page, scrolled to that clause; unknown/empty → home. */
export function parseHash(hash: string): { route: RouteId; anchor?: string } | null {
  const raw = decodeURIComponent(hash.replace(/^#/, ''));
  if (raw === 'main') return null; // skip link — not a route
  const [page, clause] = raw.split('--');
  if (isTab(page) || isPolicy(page)) return { route: page, anchor: clause ? raw : undefined };
  return LEGACY[raw] ?? { route: 'home' };
}

type Router = {
  route: RouteId;
  /** Switch tab via the URL (adds a history entry). `then` runs once the panel is shown. */
  navigate: (to: RouteId, then?: () => void) => void;
};

const Ctx = createContext<Router | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  // Same initial value on the server (prerender) and in the browser → no hydration mismatch.
  const [state, setState] = useState<{ route: RouteId; anchor?: string; n: number }>({ route: 'home', n: 0 });
  const pendingThen = useRef<(() => void) | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const apply = () => {
      const parsed = parseHash(window.location.hash);
      if (parsed) setState((s) => ({ ...parsed, n: s.n + 1 }));
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // After a route change: scroll, move focus to the panel heading, set the title.
  useLayoutEffect(() => {
    if (state.n === 0) return;
    const panel = document.getElementById(`panel-${state.route}`);
    const target = state.anchor ? document.getElementById(state.anchor) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'instant' });

    document.title = isPolicy(state.route) ? `${POLICY_PAGES[state.route]} | Golden Stay` : DEFAULT_TITLE;

    const then = pendingThen.current;
    pendingThen.current = null;
    if (then) then();
    else if (!firstRender.current && panel) {
      // Move focus to the section heading so keyboard / screen-reader users land in the new content.
      const heading = (target ?? panel.querySelector<HTMLElement>('h1, h2')) as HTMLElement | null;
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }
    firstRender.current = false;
  }, [state]);

  const navigate = useCallback((to: RouteId, then?: () => void) => {
    pendingThen.current = then ?? null;
    if (window.location.hash === `#${to}`) setState((s) => ({ route: to, n: s.n + 1 }));
    else window.location.hash = to;
  }, []);

  const value = useMemo(() => ({ route: state.route, navigate }), [state.route, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter(): Router {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRouter must be used inside <RouterProvider>');
  return c;
}
