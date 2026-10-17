import { useEffect, useState } from 'react';
import { business } from '../data/site';
import { Brand } from './Nav';

const links = [
  { label: 'Rooms', href: '#rooms' },
  { label: 'Around Us', href: '#around' },
  { label: 'Reviews', href: '#reviews' },
  { label: 'Instagram', href: business.instagram.url, external: true },
];

const policyLinks = [
  { label: 'Terms & Conditions', href: '#terms' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'Cancellation & Refund', href: '#cancellation' },
  { label: 'House Rules', href: '#house-rules' },
];

export function Footer() {
  // Build year in the prerendered HTML, corrected to the visitor's year after hydration.
  const [year, setYear] = useState(__BUILD_YEAR__);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return (
    <footer className="no-print mt-16 border-t border-hairline md:mt-24">
      <div className="container-x flex flex-col items-center gap-4 pt-8 text-center lg:flex-row lg:justify-between lg:text-left">
        <a href="#home" aria-label="Golden Stay — home" className="rounded">
          <Brand size="footer" />
        </a>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px]">
            {links.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  className="link-underline"
                  {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-[12px] text-muted">
          © {year} {business.name} · Website by{' '}
          <a href={business.credit.url} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
            {business.credit.name}
          </a>
        </p>
      </div>
      <nav aria-label="Policies" className="container-x mt-5 border-t border-hairline pb-28 pt-4 md:pb-8">
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12.5px] text-muted lg:justify-start">
          <li className="font-semibold text-ink">Policies</li>
          {policyLinks.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="link-underline hover:text-ink">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
