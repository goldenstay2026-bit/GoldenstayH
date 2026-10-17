// Check-in / check-out control that opens an accessible range calendar
// showing which nights are already booked for the chosen room.

import { lazy, Suspense, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { formatISODate } from '../../shared/validate.ts';
import { useModal } from '../lib/useModal';
import { Spinner } from './ui';

const RangeCalendar = lazy(() => import('./RangeCalendar'));

export type DateRangeFieldProps = {
  idIn: string;
  idOut: string;
  option: string;
  checkIn: string;
  checkOut: string;
  today: string;
  onChange: (checkIn: string, checkOut: string) => void;
  onClose?: () => void;
  /** Render the two triggers; `open` opens the calendar. */
  children: (open: () => void, expanded: boolean) => React.ReactNode;
  title?: string;
};

/** Headless wrapper: you render the triggers, it renders the dialog. */
export function DateRangeField({ option, checkIn, checkOut, today, onChange, onClose, children, title = 'Choose your dates' }: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  return (
    <>
      {children(() => setOpen(true), open)}
      {open && (
        <RangeDialog title={title} onClose={close}>
          <Suspense
            fallback={
              <p className="flex justify-center gap-2 py-16 text-muted">
                <Spinner /> Loading calendar…
              </p>
            }
          >
            <RangeCalendar option={option} checkIn={checkIn} checkOut={checkOut} today={today} onChange={onChange} onDone={close} />
          </Suspense>
          {(checkIn || checkOut) && (
            <div className="mt-3 flex justify-between gap-2">
              <button type="button" onClick={() => onChange('', '')} className="btn h-11 px-4 text-[14px] text-ink hover:bg-card">
                Clear dates
              </button>
              <button type="button" onClick={close} className="btn btn-dark h-11 px-5 text-[14px]">
                Done
              </button>
            </div>
          )}
        </RangeDialog>
      )}
    </>
  );
}

function RangeDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, true, onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[92dvh] w-full max-w-[680px] overflow-y-auto rounded-t-[22px] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl md:w-auto md:rounded-[22px] md:p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close calendar" className="grid size-10 place-items-center rounded-full bg-card">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "14 Nov 2026" or a placeholder. */
export const dateText = (iso: string, placeholder = 'Add date') => (iso ? formatISODate(iso) : placeholder);

export const CalendarIcon = () => <CalendarDays size={16} className="shrink-0 text-muted" aria-hidden="true" />;
