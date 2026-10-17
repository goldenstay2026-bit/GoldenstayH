// New / edit booking (or a date block), as a full-height sheet on phones.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleCheck, MessageCircle, X } from 'lucide-react';
import { BOOKING_OPTIONS, isOptionId, optionById, type OptionId } from '../../shared/catalog.ts';
import { GROUP_MAX_GUESTS, nightsBetween, parseISODate } from '../../shared/validate.ts';
import { Alert, Field, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { useModal } from '../lib/useModal';
import { addDaysISO, confirmationMessage, nightsLabel, useAdmin, waUrl } from './lib';

export type FormInit = {
  ref?: string;
  kind?: 'booking' | 'block';
  optionId?: OptionId;
  checkIn: string;
  checkOut: string;
  guestName?: string;
  guestPhone?: string;
  guests?: number;
  occasion?: string;
  source?: string;
  notes?: string;
};

const SOURCES = [
  ['phone', 'Phone call'],
  ['whatsapp', 'WhatsApp'],
  ['walk_in', 'Walk-in'],
  ['website_request', 'Website enquiry'],
  ['other', 'Other'],
] as const;

type Saved = { ref: string; whatsapp: string | null; message: string | null; block: boolean };

export function BookingForm({ init, onClose, onSaved }: { init: FormInit; onClose: () => void; onSaved: (ref: string) => void }) {
  const { call } = useAdmin();
  const editing = Boolean(init.ref);
  const [v, setV] = useState({
    kind: init.kind ?? 'booking',
    optionId: init.optionId ?? ('ac-1bhk' as OptionId),
    checkIn: init.checkIn,
    checkOut: init.checkOut,
    guestName: init.guestName ?? '',
    guestPhone: init.guestPhone ?? '',
    guests: String(init.guests ?? 2),
    occasion: init.occasion ?? '',
    source: init.source && init.source !== 'block' ? init.source : 'phone',
    notes: init.notes ?? '',
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'ok' | 'taken'; message?: string }>({ state: 'idle' });
  const [saved, setSaved] = useState<Saved | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useModal(panel, true, onClose);

  const block = v.kind === 'block';
  const datesValid = parseISODate(v.checkIn) !== null && parseISODate(v.checkOut) !== null && v.checkOut > v.checkIn;
  const nights = datesValid ? nightsBetween(v.checkIn, v.checkOut) : 0;

  // Live availability check as the owner changes room or dates.
  useEffect(() => {
    if (!datesValid) return setCheck({ state: 'idle' });
    setCheck({ state: 'checking' });
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      call<{ ok: boolean; message: string | null }>(
        `/check?optionId=${v.optionId}&checkIn=${v.checkIn}&checkOut=${v.checkOut}${init.ref ? `&exclude=${init.ref}` : ''}`,
        { signal: ctrl.signal },
      )
        .then((r) => setCheck(r.ok ? { state: 'ok' } : { state: 'taken', message: r.message ?? '' }))
        .catch(() => setCheck({ state: 'idle' }));
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [v.optionId, v.checkIn, v.checkOut, datesValid, init.ref, call]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!datesValid) errs.checkOut = 'Check-out must be after check-in.';
    if (!block) {
      if (v.guestName.trim().length < 2) errs.guestName = 'Enter the guest’s name.';
      const g = Number(v.guests);
      if (!Number.isInteger(g) || g < 1 || g > GROUP_MAX_GUESTS) errs.guests = `1 to ${GROUP_MAX_GUESTS} guests.`;
    }
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    const body = block
      ? { kind: 'block', optionId: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut, reason: v.notes }
      : { kind: 'booking', optionId: v.optionId, checkIn: v.checkIn, checkOut: v.checkOut, guestName: v.guestName, guestPhone: v.guestPhone, guests: Number(v.guests), occasion: v.occasion, source: v.source, notes: v.notes };
    try {
      const r = editing
        ? await call<{ ref: string }>(`/manual-bookings/${init.ref}`, { method: 'PUT', body })
        : await call<{ ref: string }>('/manual-bookings', { method: 'POST', body });
      const detail = await call<{ whatsapp: string }>(`/bookings/${r.ref}`);
      setSaved({
        ref: r.ref,
        block,
        whatsapp: detail.whatsapp || null,
        message: block ? null : confirmationMessage({ name: v.guestName.trim(), optionName: optionById(v.optionId).name, checkIn: v.checkIn, checkOut: v.checkOut, guests: Number(v.guests) }),
      });
      onSaved(r.ref);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'DATES_TAKEN') setCheck({ state: 'taken', message: e2.message });
      if (e2.field) setErrors({ [e2.field]: e2.message });
      else setFormError(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const title = editing ? (block ? 'Edit block' : 'Edit booking') : block ? 'Block dates' : 'New booking';

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center md:items-center md:p-6">
      <div className="absolute inset-0 hidden bg-ink/40 md:block" onClick={onClose} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="relative flex w-full max-w-[560px] flex-col bg-white md:max-h-[92vh] md:rounded-[22px] md:shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h2 className="text-[20px] font-bold">{saved ? (saved.block ? 'Dates blocked' : 'Booking saved') : title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-11 place-items-center rounded-full bg-card">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {saved ? (
          <div className="flex-1 overflow-y-auto px-5 py-6 text-[16px]">
            <p className="flex items-center gap-2 font-semibold text-[#24603a]">
              <CircleCheck size={20} aria-hidden="true" /> Saved · {saved.ref}
            </p>
            {saved.message && (
              <>
                <p className="mt-4 text-muted">Send the guest a confirmation:</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-[14px] bg-card p-4 font-sans text-[15px] leading-[1.55]">{saved.message}</pre>
                {saved.whatsapp ? (
                  <a href={waUrl(saved.whatsapp, saved.message)} target="_blank" rel="noopener noreferrer" className="btn btn-dark mt-4 h-12 w-full gap-2 text-[16px]">
                    <MessageCircle size={18} aria-hidden="true" /> Open WhatsApp
                  </a>
                ) : (
                  <p className="mt-3 text-[14px] text-muted">Add the guest’s phone number to send this on WhatsApp.</p>
                )}
              </>
            )}
            <button onClick={onClose} className="btn btn-outline mt-3 h-12 w-full text-[16px]">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {!editing && (
                <label className="flex items-center justify-between gap-3 rounded-[14px] bg-card px-4 py-3 text-[16px] font-semibold">
                  Block dates only
                  <input type="checkbox" role="switch" checked={block} onChange={(e) => set('kind', e.target.checked ? 'block' : 'booking')} className="size-6 accent-ink" />
                </label>
              )}

              <Field id="f-option" label={block ? 'What to block' : 'Room'}>
                <select id="f-option" className="field h-12 text-[16px]" value={v.optionId} onChange={(e) => isOptionId(e.target.value) && set('optionId', e.target.value)}>
                  {BOOKING_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field id="f-in" label="Check-in" error={errors.checkIn}>
                  <input
                    id="f-in"
                    type="date"
                    className="field h-12 text-[16px]"
                    value={v.checkIn}
                    onChange={(e) => {
                      const ci = e.target.value;
                      setV((s) => ({ ...s, checkIn: ci, checkOut: s.checkOut > ci ? s.checkOut : ci ? addDaysISO(ci, 1) : s.checkOut }));
                    }}
                  />
                </Field>
                <Field id="f-out" label="Check-out" error={errors.checkOut}>
                  <input id="f-out" type="date" className="field h-12 text-[16px]" min={v.checkIn ? addDaysISO(v.checkIn, 1) : undefined} value={v.checkOut} onChange={(e) => set('checkOut', e.target.value)} />
                </Field>
              </div>
              <div aria-live="polite" className="min-h-[24px] text-[15px]">
                {nights > 0 && <span className="font-semibold">{nightsLabel(nights)}</span>}
                {check.state === 'checking' && <span className="ml-2 text-muted">Checking…</span>}
                {check.state === 'ok' && <span className="ml-2 text-[#24603a]">· Available</span>}
              </div>
              {check.state === 'taken' && (
                <Alert tone="danger" role="alert">
                  {check.message}
                </Alert>
              )}

              {block ? (
                <Field id="f-reason" label="Reason" optional>
                  <input id="f-reason" className="field h-12 text-[16px]" value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Repairs, family visit" maxLength={300} />
                </Field>
              ) : (
                <>
                  <Field id="f-name" label="Guest name" error={errors.guestName}>
                    <input id="f-name" className="field h-12 text-[16px]" value={v.guestName} onChange={(e) => set('guestName', e.target.value)} autoComplete="off" maxLength={80} />
                  </Field>
                  <Field id="f-phone" label="Phone" optional error={errors.guestPhone} hint="10-digit Indian mobile, or +country code for other countries.">
                    <input id="f-phone" type="tel" inputMode="tel" className="field h-12 text-[16px]" value={v.guestPhone} onChange={(e) => set('guestPhone', e.target.value)} autoComplete="off" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="f-guests" label="Guests" error={errors.guests}>
                      <input id="f-guests" type="number" inputMode="numeric" min={1} max={GROUP_MAX_GUESTS} className="field h-12 text-[16px]" value={v.guests} onChange={(e) => set('guests', e.target.value)} />
                    </Field>
                    <Field id="f-source" label="Booked via">
                      <select id="f-source" className="field h-12 text-[16px]" value={v.source} onChange={(e) => set('source', e.target.value)}>
                        {SOURCES.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field id="f-occasion" label="Occasion" optional>
                    <input id="f-occasion" className="field h-12 text-[16px]" value={v.occasion} onChange={(e) => set('occasion', e.target.value)} placeholder="e.g. Birthday, anniversary" maxLength={80} />
                  </Field>
                  <Field id="f-notes" label="Notes" optional>
                    <textarea id="f-notes" className="field h-auto min-h-[88px] py-3 text-[16px]" value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} />
                  </Field>
                </>
              )}
              {formError && (
                <Alert tone="danger" role="alert">
                  {formError}
                </Alert>
              )}
            </div>
            <div className="flex gap-2 border-t border-hairline px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
              <button type="button" onClick={onClose} className="btn btn-outline h-12 flex-1 text-[16px]">
                Close
              </button>
              <button disabled={busy || check.state === 'taken'} className="btn btn-dark h-12 flex-[2] text-[16px] disabled:opacity-50">
                {busy ? <Spinner label="Saving" /> : block ? 'Block dates' : 'Save booking'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
