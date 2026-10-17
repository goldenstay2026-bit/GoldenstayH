import type { ReactNode } from 'react';

type HeadingProps = {
  /** Text before the accent word */
  before?: string;
  /** The single Instrument Serif Italic accent word/phrase */
  accent: string;
  after?: string;
  id?: string;
  className?: string;
};

export function H2({ before, accent, after, id, className = '' }: HeadingProps) {
  return (
    <h2 id={id} className={`heading h2 ${className}`}>
      {before && <>{before} </>}
      <span className="accent">{accent}</span>
      {after && <> {after}</>}
    </h2>
  );
}

type SectionHeadProps = HeadingProps & { lead?: ReactNode; dark?: boolean };

/** H2 on the left, short supporting text on the right (stacks on mobile). */
export function SectionHead({ lead, ...heading }: SectionHeadProps) {
  return (
    <div className="mb-[26px] flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-10">
      <H2 {...heading} />
      {lead && <p className="max-w-[310px] text-[13px] leading-[1.5] text-muted">{lead}</p>}
    </div>
  );
}
