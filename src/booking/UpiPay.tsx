import { useEffect, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Copy, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { formatPaise } from '../../shared/catalog.ts';
import type { BookingView, PublicConfig } from '../../shared/types.ts';
import { normaliseUtr } from '../../shared/validate.ts';
import { Alert, Field, Panel, Spinner } from '../components/ui';
import { UPI_APPS, isPhone, upiLink, type UpiParams } from '../lib/upi';

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 2000)), () => undefined)}
      className="inline-flex items-center gap-1.5 rounded-full border border-field bg-white px-3 py-1.5 text-[12.5px] font-medium hover:border-ink"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Amount QR (UPI link with the amount set), rendered locally as an SVG. */
function AmountQr({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } }).then(setSvg, () => setSvg(''));
  }, [value]);
  if (!svg) return <div className="grid aspect-square w-full place-items-center rounded-[16px] bg-white"><Spinner /></div>;
  return <div role="img" aria-label={label} className="aspect-square w-full rounded-[16px] border border-hairline bg-white p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type Props = {
  booking: BookingView;
  config: PublicConfig;
  secondary: boolean;
  /** Submits "I've paid" (UTR optional). */
  onPaid: (utr: string) => Promise<void>;
};

export function UpiPay({ booking, config, secondary, onPaid }: Props) {
  const [phone, setPhone] = useState(false);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPhone(isPhone()), []);

  const amount = formatPaise(booking.payNowPaise);
  const params: UpiParams = { payload: config.qr.payload, amountPaise: booking.payNowPaise, note: `Golden Stay ${booking.ref}` };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (utr.trim() && !normaliseUtr(utr)) {
      setError('That doesn’t look like a UPI reference — it’s 12 digits. You can also leave it empty.');
      document.getElementById('qr-utr')?.focus();
      return;
    }
    setBusy(true);
    try {
      await onPaid(utr);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const appButtons = (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {UPI_APPS.map((app) => (
        <a
          key={app.id}
          href={app.link(params)}
          className="group flex flex-col items-center gap-2 rounded-[16px] border border-hairline bg-white px-2 py-3.5 text-center transition-colors hover:border-ink"
        >
          <span
            className="grid size-11 place-items-center rounded-[12px] text-[15px] font-bold text-white shadow-sm"
            style={{ background: app.color }}
            aria-hidden="true"
          >
            {app.name[0]}
          </span>
          <span className="text-[13px] font-semibold leading-tight">{app.name}</span>
          <span className="sr-only"> — pay {amount}</span>
        </a>
      ))}
    </div>
  );

  return (
    <Panel>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{secondary ? 'Or pay with any UPI app' : 'Pay with any UPI app'}</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[16px] bg-white p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Amount</p>
          <p className="text-[32px] font-bold leading-none tabular-nums tracking-[-0.02em]">{amount}</p>
        </div>
        <div className="text-[12.5px] leading-[1.5] text-muted">
          To <span className="font-semibold text-ink">{config.qr.payeeLabel}</span> · {config.qr.upiId}
          <br />
          Note: <span className="font-semibold text-ink">{booking.ref}</span>
        </div>
      </div>

      {phone ? (
        <>
          <p className="mt-5 flex items-center gap-2 text-[13.5px] font-semibold">
            <Smartphone size={16} aria-hidden="true" /> Tap your app — the amount is filled in for you
          </p>
          <div className="mt-3">{appButtons}</div>
          <details className="mt-4 rounded-[14px] border border-hairline bg-white p-3 text-[13px]">
            <summary className="flex cursor-pointer items-center justify-between font-semibold">
              Paying from another phone? Show the QR <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="mx-auto mt-3 max-w-[240px]">
              <AmountQr value={upiLink(params)} label={`UPI QR code to pay ${amount} to ${config.qr.payeeLabel}`} />
            </div>
          </details>
        </>
      ) : (
        <div className="mt-5 grid items-center gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[240px]">
            <AmountQr value={upiLink(params)} label={`UPI QR code to pay ${amount} to ${config.qr.payeeLabel}`} />
          </div>
          <div className="text-[13.5px] leading-[1.6]">
            <p className="font-semibold">Scan with PhonePe, Google Pay, Paytm or any UPI app.</p>
            <p className="mt-1 text-muted">
              The amount <strong className="text-ink">{amount}</strong> and booking ID are filled in automatically — just approve the payment.
            </p>
            <p className="mt-3 text-[12.5px] text-muted">On your phone? Open this page there to get one-tap buttons for your UPI app.</p>
          </div>
        </div>
      )}

      <details className="mt-3 rounded-[14px] border border-hairline bg-white p-3 text-[13px]">
        <summary className="flex cursor-pointer items-center justify-between font-semibold">
          Amount didn’t fill in? Use our shop QR <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
          {/* Original merchant QR, unmodified (scaled only). */}
          <img
            src={config.qr.imageUrl}
            alt={`PhonePe merchant UPI QR code for ${config.qr.payeeLabel} (UPI ID ${config.qr.upiId})`}
            width={1200}
            height={1600}
            loading="lazy"
            className="mx-auto w-full max-w-[200px] rounded-[12px] border border-hairline"
          />
          <div className="space-y-2">
            <p>
              Scan it and type <strong>{amount}</strong> yourself. Add <strong>{booking.ref}</strong> as the note if your app allows.
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Amount</span> <strong className="tabular-nums">{amount}</strong> <CopyBtn text={(booking.payNowPaise / 100).toFixed(0)} label="amount" />
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted">UPI ID</span> <strong>{config.qr.upiId}</strong> <CopyBtn text={config.qr.upiId} label="UPI ID" />
            </p>
          </div>
        </div>
      </details>

      <form onSubmit={submit} noValidate className="mt-6 border-t border-hairline pt-5">
        <p className="text-[14px] font-semibold">After paying, tell us here</p>
        <div className="mt-3">
          <Field
            id="qr-utr"
            label="UPI reference (UTR)"
            optional
            error={error}
            hint="12 digits from your payment receipt — helps us confirm faster."
          >
            <input
              id="qr-utr"
              className="field tabular-nums"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 412345678901"
              maxLength={16}
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'qr-utr-error' : 'qr-utr-hint'}
            />
          </Field>
        </div>
        <button type="submit" disabled={busy} className="btn btn-dark mt-4 h-[52px] w-full text-[15px] disabled:opacity-60">
          {busy ? (
            <>
              <Spinner label="Sending" /> Sending…
            </>
          ) : (
            <>I’ve paid {amount}</>
          )}
        </button>
        <p className="mt-2.5 text-center text-[11.5px] text-muted">Golden Stay checks the payment and confirms your booking — you’ll see it here.</p>
        {error && !utr && (
          <div className="mt-3">
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          </div>
        )}
      </form>
    </Panel>
  );
}
