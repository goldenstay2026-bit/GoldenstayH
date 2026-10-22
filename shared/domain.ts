// The website's public address. Used for search-engine tags (canonical, Open
// Graph, JSON-LD), the sitemap, and links in the owner's emails. SITE_URL
// (an https:// address) overrides it, e.g. for a staging copy.
export const SITE_ORIGIN = 'https://www.goldenstay.space';

/** SITE_URL if it is a proper https address, otherwise the real site address. */
export function siteOrigin(fromEnv: string | undefined): string {
  const v = (fromEnv ?? '').trim().replace(/\/$/, '');
  return /^https:\/\/[^/]+$/.test(v) ? v : SITE_ORIGIN;
}
