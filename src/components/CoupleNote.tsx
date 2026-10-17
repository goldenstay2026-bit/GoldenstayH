import { ShieldCheck } from 'lucide-react';
import { COUPLE_NOTE, groupBooking } from '../data/site';

/** "Couple-friendly · Valid photo ID required for both guests." */
export function CoupleNote({ className = '' }: { className?: string }) {
  if (!groupBooking.coupleFriendly) return null;
  return (
    <p className={`flex items-center gap-2 text-[13.5px] text-ink/85 ${className}`}>
      <ShieldCheck size={16} className="shrink-0 text-taupe" aria-hidden="true" />
      {COUPLE_NOTE}
    </p>
  );
}
