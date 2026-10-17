import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronRight, LogOut } from 'lucide-react';
import { formatPaise } from '../../shared/catalog.ts';
import type { BookingView } from '../../shared/types.ts';
import { formatISODate, normaliseIndianMobile } from '../../shared/validate.ts';
import { AuthPanel } from '../components/AuthPanel';
import { Alert, BookingChip, Field, PageShell, Panel, PaymentChip, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Account() {
  const auth = useAuth();

  if (!auth.ready) {
    return (
      <PageShell>
        <p className="flex justify-center gap-2 py-24 text-muted" role="status">
          <Spinner /> Loading…
        </p>
      </PageShell>
    );
  }

  if (!auth.user) {
    return (
      <PageShell>
        <div className="mx-auto max-w-[460px]">
          <h1 className="heading h2 mb-6">
            Your <span className="accent">account</span>
          </h1>
          <Panel>
            <AuthPanel intro="Sign in to see your bookings and payment status." />
          </Panel>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="heading h2">
            Your <span className="accent">bookings</span>
          </h1>
          <p className="mt-2 text-[13.5px] text-muted">
            Signed in as <span className="font-semibold text-ink">{auth.user.email}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/book/" className="btn btn-dark h-11 px-5 text-[14px]">
            Book a stay
          </a>
          <button type="button" onClick={() => void auth.signOut()} className="btn btn-outline h-11 px-4 text-[14px]">
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <MyBookings />
        <ProfileCard />
      </div>
    </PageShell>
  );
}

function MyBookings() {
  const { idToken } = useAuth();
  const [list, setList] = useState<BookingView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setList(await api<BookingView[]>('/me/bookings', { idToken: await idToken() }));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [idToken]);

  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!list) {
    return (
      <p className="flex gap-2 py-10 text-muted" role="status">
        <Spinner /> Loading your bookings…
      </p>
    );
  }
  if (list.length === 0) {
    return (
      <Panel>
        <p className="text-[15px] font-semibold">No bookings yet</p>
        <p className="mt-1 text-[13.5px] text-muted">When you book a stay it will appear here, with its payment status.</p>
      </Panel>
    );
  }
  return (
    <ul className="space-y-2.5">
      {list.map((b) => (
        <li key={b.ref}>
          <a
            href={`/booking/?ref=${encodeURIComponent(b.ref)}`}
            className="group flex items-center gap-4 rounded-[18px] border border-hairline bg-white p-4 transition-colors hover:border-ink md:p-5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold tracking-[0.04em]">{b.ref}</span>
                <BookingChip status={b.status} />
                <PaymentChip status={b.paymentStatus} />
              </div>
              <p className="mt-1.5 text-[14px] font-medium">{b.roomName}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                <CalendarDays size={14} aria-hidden="true" />
                {formatISODate(b.checkIn)} → {formatISODate(b.checkOut)} · {b.nights} {b.nights === 1 ? 'night' : 'nights'} · {formatPaise(b.totalPaise)}
              </p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function ProfileCard() {
  const { user, profile, saveProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? user?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPhone(profile.phone);
    }
  }, [profile]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const ten = normaliseIndianMobile(phone);
    if (name.trim().length < 2) return setMsg({ tone: 'danger', text: 'Please enter your full name.' });
    if (!ten) return setMsg({ tone: 'danger', text: 'Enter a 10-digit Indian mobile number.' });
    setBusy(true);
    try {
      await saveProfile({ name, phone: ten });
      setMsg({ tone: 'success', text: 'Saved. We’ll fill these in for your next booking.' });
    } catch {
      setMsg({ tone: 'danger', text: 'Couldn’t save right now. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="rounded-[22px] bg-cream p-5 md:p-6" aria-label="Your details">
      <h2 className="text-[17px] font-semibold">Your details</h2>
      <p className="mt-1 text-[13px] text-muted">Used to pre-fill your bookings.</p>
      <div className="mt-4 space-y-4">
        <Field id="pf-name" label="Full name">
          <input id="pf-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="pf-phone" label="Phone / WhatsApp">
          <input id="pf-phone" className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field id="pf-email" label="Email">
          <input id="pf-email" className="field bg-card" value={user?.email ?? ''} readOnly aria-readonly="true" />
        </Field>
      </div>
      {msg && (
        <div className="mt-4">
          <Alert tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
            {msg.text}
          </Alert>
        </div>
      )}
      <button type="submit" disabled={busy} className="btn btn-outline mt-5 h-11 w-full text-[14px] disabled:opacity-60">
        {busy ? <Spinner label="Saving" /> : 'Save details'}
      </button>
    </form>
  );
}
