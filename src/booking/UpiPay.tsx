import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Download, MessageCircle } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import type { BookingView, PublicConfig } from '../../shared/types.ts';
import { normaliseUtr } from '../../shared/validate.ts';
import { Alert, Field, Panel, Spinner } from '../components/ui';
import { waLink } from '../lib/enquiry';
import { isPhone } from '../lib/upi';

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

/** Full-width copy button (phones). */
function CopyBig({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 2000)), () => undefined)}
      className="btn btn-dark h-12 px-3 text-[14px]"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
    >
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {done ? 'Copied' : `Copy ${label}`}
    </button>
  );
}

/** The owner's PhonePe merchant QR, exactly as provided (scaled only). */
function MerchantQr({ src, label }: { src: string; label: string }) {
  return <img src={src} alt={label} width={1200} height={1600} className="mx-auto w-full max-w-[250px] rounded-[16px] border border-hairline bg-white" />;
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
  const qrLabel = `UPI QR code: PhonePe merchant QR for ${config.qr.payeeLabel} (UPI ID ${config.qr.upiId})`;
  const rupees = (booking.payNowPaise / 100).toFixed(booking.payNowPaise % 100 ? 2 : 0);

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

  const steps = (first: string, second: string) => (
    <ol className="space-y-1.5 text-[13.5px] leading-[1.55]">
      <li>
        <span className="font-semibold">1.</span> {first}
      </li>
      <li>
        <span className="font-semibold">2.</span> {second}
      </li>
      <li>
        <span className="font-semibold">3.</span> Enter <strong className="tabular-nums">{amount}</strong> and pay. Add <strong>{booking.ref}</strong> as the note
        if your app allows. Then come back here and tap <strong>I’ve paid</strong>.
      </li>
    </ol>
  );

  return (
    <Panel>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{secondary ? 'Or pay with any UPI app' : 'Pay with any UPI app'}</h2>

      <div className="mt-4 rounded-[16px] bg-white p-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Amount to pay</p>
        <p className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-[32px] font-bold leading-none tabular-nums tracking-[-0.02em]">{amount}</span>
          <CopyBtn text={rupees} label="amount" />
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline pt-3 text-[12.5px] text-muted">
          <span>
            To <span className="font-semibold text-ink">{config.qr.payeeLabel}</span> · {config.qr.upiId}
          </span>
          <CopyBtn text={config.qr.upiId} label="UPI ID" />
          <span>
            Booking ID <span className="font-semibold text-ink">{booking.ref}</span>
          </span>
        </div>
      </div>

      {/* Paying inside the UPI app (scan or UPI ID) is an ordinary payment. Links that open the app
          from a website with a shop UPI ID get flagged as risky, so there are none. */}
      {phone ? (
        <div className="mt-5">
          <MerchantQr src={config.qr.imageUrl} label={qrLabel} />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <a href={config.qr.imageUrl} download="golden-stay-upi-qr.jpg" className="btn h-12 border border-ink/80 bg-white px-3 text-[14px]">
              <Download size={16} aria-hidden="true" /> Save QR
            </a>
            <CopyBig text={config.qr.upiId} label="UPI ID" />
          </div>
          <div className="mt-4">
            {steps(
              'Take a screenshot of the QR (or tap Save QR), or copy the UPI ID.',
              'Open PhonePe, Google Pay or Paytm → Scan → choose the QR from your gallery. Or use “Pay to UPI ID” and paste the ID.',
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 grid items-center gap-5 md:grid-cols-[250px_minmax(0,1fr)]">
          <MerchantQr src={config.qr.imageUrl} label={qrLabel} />
          <div>
            {steps('Open PhonePe, Google Pay, Paytm or any UPI app on your phone.', 'Tap Scan and scan this QR — or use “Pay to UPI ID” with the ID above.')}
          </div>
        </div>
      )}

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

      <p className="mt-4 text-center text-[13px] text-muted">
        Payment not going through?{' '}
        <a
          href={waLink(`Hello Golden Stay, I need help paying for booking ${booking.ref} (${amount}).`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-2"
        >
          <MessageCircle size={14} aria-hidden="true" /> WhatsApp us
        </a>{' '}
        with your booking ID and we’ll help you complete it.
      </p>
    </Panel>
  );
}
