import {
  ArrowLeft,
  CigaretteOff,
  Clock,
  CookingPot,
  IdCard,
  Lightbulb,
  Moon,
  PartyPopper,
  PawPrint,
  UserPlus,
  Users,
  Wine,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { POLICY_DOCS, type RuleIcon } from '../data/policies';
import { policies } from '../data/site';
import { formatISODate } from '../../shared/validate.ts';
import type { PolicyId } from '../lib/router';

const RULE_ICONS: Record<RuleIcon, LucideIcon> = {
  clock: Clock,
  users: Users,
  id: IdCard,
  party: PartyPopper,
  smoking: CigaretteOff,
  alcohol: Wine,
  pets: PawPrint,
  visitors: UserPlus,
  quiet: Moon,
  lights: Lightbulb,
  kitchen: CookingPot,
  damage: Wrench,
};

/** One policy page (Terms, Privacy, Cancellation, House Rules) — readable, printable prose. */
export function PolicyPage({ id }: { id: PolicyId }) {
  const doc = POLICY_DOCS[id];
  const anchor = (clause: string) => `${id}--${clause}`;
  return (
    <div className="policy-page container-x pt-6 md:pt-10">
      <div className="mx-auto max-w-[760px] rounded-[22px] bg-cream px-5 py-7 md:px-10 md:py-10">
        <a href="#home" className="no-print inline-flex items-center gap-1.5 text-[13px] font-semibold link-underline">
          <ArrowLeft size={15} aria-hidden="true" /> Back to Home
        </a>
        <h1 className="heading mt-5 text-[34px] leading-[1.05] md:text-[44px]">{doc.title}</h1>
        <p className="mt-2 text-[13px] text-muted">Last updated: {formatISODate(policies.lastUpdated)}</p>

        {doc.clauses.length > 1 && (
          <nav aria-label="On this page" className="no-print mt-6 rounded-[16px] bg-white p-4 text-[13.5px]">
            <p className="font-semibold">On this page</p>
            <ol className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
              {doc.clauses.map((c) => (
                <li key={c.id}>
                  <a href={`#${anchor(c.id)}`} className="link-underline text-ink/85 hover:text-ink">
                    {c.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {doc.intro && <p className="mt-6 text-[15px] leading-[1.7]">{doc.intro}</p>}

        <div className="mt-6 max-w-[720px] space-y-6">
          {doc.clauses.map((c) => (
            <section key={c.id} aria-labelledby={anchor(c.id)}>
              <h2 id={anchor(c.id)} className="text-[19px] font-semibold tracking-[-0.01em] [scroll-margin-top:140px] lg:[scroll-margin-top:110px]">
                {c.heading}
              </h2>
              {c.paragraphs.map((t) => (
                <p key={t} className="mt-2 text-[15px] leading-[1.7] text-ink/85">
                  {t}
                </p>
              ))}
            </section>
          ))}
        </div>

        {doc.rules && (
          <ul className="mt-6 max-w-[720px] space-y-3">
            {doc.rules.map((r) => {
              const Icon = RULE_ICONS[r.icon];
              return (
                <li key={r.text} className="flex gap-3 text-[15px] leading-[1.6]">
                  <Icon size={18} className="mt-[3px] shrink-0 text-taupe" aria-hidden="true" />
                  <span>{r.text}</span>
                </li>
              );
            })}
          </ul>
        )}
        {doc.outro && <p className="mt-8 text-[15px] font-medium">{doc.outro}</p>}
      </div>
    </div>
  );
}
