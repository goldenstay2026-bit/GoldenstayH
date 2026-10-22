import type { ReactNode } from 'react';
import { ArrowLeft, CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';
import { Brand } from './Nav';

/** Minimal header/footer used by the checkout, booking and admin pages. */
export function PageShell({ children, right, wide = false }: { children: ReactNode; right?: ReactNode; wide?: boolean }) {
  return (
    <>
      <header className="border-b border-hairline bg-white">
        <div className={`container-x flex h-16 items-center justify-between gap-4 md:h-[72px] ${wide ? '' : 'max-w-[1180px]'}`}>
          <a href="/" aria-label="Golden Stay — home" className="rounded-full">
            <Brand />
          </a>
          {right ?? (
            <a href="/#rooms" className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-ink/80 hover:bg-card">
              <ArrowLeft size={15} aria-hidden="true" />
              Back to site
            </a>
          )}
        </div>
      </header>
      <main id="main" className={`container-x pb-24 pt-8 md:pt-12 ${wide ? '' : 'max-w-[1180px]'}`}>
        {children}
      </main>
    </>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  optional,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold text-ink">
        {label}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] leading-[1.5] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[12px] font-medium text-[#b42318]">
          {error}
        </p>
      )}
    </div>
  );
}

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';

const toneCls: Record<Tone, string> = {
  neutral: 'bg-card text-ink',
  success: 'bg-[#e7f1e9] text-[#24603a]',
  warn: 'bg-[#fbf0dc] text-[#7a4f00]',
  danger: 'bg-[#fbe9e7] text-[#a3261b]',
  info: 'bg-[#ece9e4] text-ink',
};

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none ${toneCls[tone]}`}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  const Icon = tone === 'success' ? CircleCheck : tone === 'danger' || tone === 'warn' ? CircleAlert : Info;
  return (
    <div role={role} className={`flex gap-3 rounded-[14px] p-4 text-[13.5px] leading-[1.55] ${toneCls[tone]}`}>
      <Icon size={18} className="mt-px shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <>
      <LoaderCircle size={size} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

export const STATUS_LABEL = {
  booking: {
    pending_payment: ['Awaiting payment', 'warn'],
    pending_verification: ['Pending verification', 'warn'],
    confirmed: ['Confirmed', 'success'],
    cancelled: ['Cancelled', 'danger'],
    expired: ['Expired', 'neutral'],
    rejected: ['Rejected', 'danger'],
    completed: ['Completed', 'info'],
  },
  payment: {
    pending: ['Pending', 'neutral'],
    pending_verification: ['Pending verification', 'warn'],
    successful: ['Successful', 'success'],
    failed: ['Failed', 'danger'],
    refunded: ['Refunded', 'info'],
  },
} as const satisfies Record<string, Record<string, readonly [string, Tone]>>;

export function BookingChip({ status }: { status: keyof typeof STATUS_LABEL.booking }) {
  const [label, tone] = STATUS_LABEL.booking[status];
  return <Chip tone={tone}>{label}</Chip>;
}

export function PaymentChip({ status }: { status: keyof typeof STATUS_LABEL.payment }) {
  const [label, tone] = STATUS_LABEL.payment[status];
  return <Chip tone={tone}>{label}</Chip>;
}

/** Card surface used across the booking pages. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[22px] bg-card p-5 md:p-7 ${className}`}>{children}</section>;
}
