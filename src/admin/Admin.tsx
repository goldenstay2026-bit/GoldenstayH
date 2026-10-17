// Golden Stay admin (/admin): owner sign-in with Firebase (email + password,
// allow-listed by ADMIN_EMAILS on the server), then Calendar · Requests ·
// Bookings · More, with live updates. Mobile-first, large type.

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, ClipboardList, Inbox, LogOut, Menu, Plus } from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import { Alert, Field, Spinner } from '../components/ui';
import { Brand } from '../components/Nav';
import { api } from '../lib/api';
import { AuthProvider, authErrorMessage, useAuth } from '../lib/auth';
import { firebaseConfigured } from '../lib/firebase';
import { BookingDrawer } from './BookingDrawer';
import { BookingForm, type FormInit } from './BookingForm';
import { BookingsList } from './BookingsList';
import { CalendarView } from './Calendar';
import { AdminProvider, addDaysISO, useAdmin, type Me, type RequestItem } from './lib';
import { RequestsView } from './Requests';
import { AuditTab, RoomsTab } from './Settings';
import { todayInIndia } from '../../shared/validate.ts';

export function Admin() {
  return firebaseConfigured ? (
    <AuthProvider>
      <FirebaseGate />
    </AuthProvider>
  ) : (
    <PasswordGate />
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-white text-[16px]">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center px-4">
          <Brand />
          <span className="ml-3 text-[14px] font-semibold text-muted">Admin</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[440px] px-4 py-8">
        {children}
      </main>
    </div>
  );
}

const Loading = () => (
  <Screen>
    <p className="flex justify-center gap-2 py-24 text-muted" role="status">
      <Spinner /> Loading…
    </p>
  </Screen>
);

// ---------- Firebase sign-in ----------

function FirebaseGate() {
  const auth = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [probeError, setProbeError] = useState('');

  const probe = useCallback(
    async (forceRefresh = false) => {
      setProbeError('');
      try {
        // Signed out of Firebase: an existing admin-password session (legacy) still works.
        const token = auth.user ? await auth.user.getIdToken(forceRefresh) : null;
        setMe(await api<Me>('/admin/me', { idToken: token }));
      } catch (e) {
        setProbeError((e as Error).message);
      }
    },
    [auth.user],
  );
  useEffect(() => {
    setMe(null);
    void probe();
  }, [probe]);

  const getToken = useCallback(async () => (auth.user ? auth.user.getIdToken() : null), [auth.user]);

  if (!auth.ready) return <Loading />;
  if (!auth.user && me?.isAdmin) {
    const leave = () => api('/admin/logout', { method: 'POST', body: {} }).finally(() => setMe({ authenticated: false, isAdmin: false }));
    return (
      <AdminProvider me={me} getToken={getToken} onAuthLost={() => probe()} signOut={leave}>
        <Dashboard />
      </AdminProvider>
    );
  }
  if (!auth.user) return me ? <LoginScreen /> : <Loading />;
  if (probeError)
    return (
      <Screen>
        <Alert tone="danger" role="alert">
          {probeError}
        </Alert>
        <button onClick={() => probe()} className="btn btn-dark mt-4 h-12 w-full text-[16px]">
          Try again
        </button>
      </Screen>
    );
  if (!me) return <Loading />;
  if (!me.isAdmin) {
    if (me.code === 'EMAIL_NOT_VERIFIED') return <VerifyEmail onChecked={() => probe(true)} />;
    return (
      <Screen>
        <h1 className="text-[26px] font-bold">You don’t have access.</h1>
        <p className="mt-2 text-muted">
          You’re signed in as <strong className="text-ink">{auth.user.email}</strong>, which isn’t an admin account for Golden Stay.
        </p>
        <button onClick={() => auth.signOut()} className="btn btn-dark mt-6 h-12 w-full gap-2 text-[16px]">
          <LogOut size={18} aria-hidden="true" /> Log out
        </button>
      </Screen>
    );
  }
  return (
    <AdminProvider me={me} getToken={getToken} onAuthLost={() => probe(true)} signOut={() => auth.signOut()}>
      <Dashboard />
    </AdminProvider>
  );
}

function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await auth.signIn(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    setError('');
    setInfo('');
    if (!email.trim()) return setError('Enter your email above first, then tap “Forgot password”.');
    try {
      await auth.resetPassword(email);
      setInfo(`If ${email.trim()} has an account, a password reset link is on its way. Check your inbox.`);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <Screen>
      <form onSubmit={submit} noValidate>
        <h1 className="text-[28px] font-bold">Owner sign in</h1>
        <div className="mt-6 space-y-4">
          <Field id="a-email" label="Email">
            <input id="a-email" type="email" autoComplete="username" className="field h-12 text-[16px]" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field id="a-pw" label="Password">
            <input id="a-pw" type="password" autoComplete="current-password" className="field h-12 text-[16px]" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        {error && (
          <div className="mt-4">
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          </div>
        )}
        {info && (
          <div className="mt-4">
            <Alert tone="success" role="status">
              {info}
            </Alert>
          </div>
        )}
        <button className="btn btn-dark mt-5 h-12 w-full text-[16px] disabled:opacity-60" disabled={busy || !email || !password}>
          {busy ? <Spinner label="Signing in" /> : 'Sign in'}
        </button>
        <button type="button" onClick={forgot} className="mt-4 w-full py-2 text-[15px] font-semibold underline underline-offset-4">
          Forgot password?
        </button>
      </form>
    </Screen>
  );
}

function VerifyEmail({ onChecked }: { onChecked: () => void }) {
  const auth = useAuth();
  const [msg, setMsg] = useState('');
  return (
    <Screen>
      <h1 className="text-[26px] font-bold">Verify your email</h1>
      <p className="mt-2 text-muted">
        For security, the admin opens only after <strong className="text-ink">{auth.user?.email}</strong> is verified. Open the link we emailed you, then tap “I’ve verified”.
      </p>
      {msg && (
        <div className="mt-4">
          <Alert tone="success" role="status">
            {msg}
          </Alert>
        </div>
      )}
      <button
        onClick={async () => {
          await auth.user?.reload();
          onChecked();
        }}
        className="btn btn-dark mt-6 h-12 w-full text-[16px]"
      >
        I’ve verified
      </button>
      <button
        onClick={() =>
          auth.user &&
          sendEmailVerification(auth.user)
            .then(() => setMsg('Verification email sent.'))
            .catch((e) => setMsg(authErrorMessage(e)))
        }
        className="btn btn-outline mt-2 h-12 w-full text-[16px]"
      >
        Send the email again
      </button>
      <button onClick={() => auth.signOut()} className="mt-4 w-full py-2 text-[15px] font-semibold underline underline-offset-4">
        Log out
      </button>
    </Screen>
  );
}

// ---------- legacy: admin password (only when Firebase isn't configured) ----------

function PasswordGate() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const check = useCallback(() => {
    api<Me>('/admin/me')
      .then((m) => setMe(m.isAdmin ? m : null))
      .catch(() => setMe(null));
  }, []);
  useEffect(check, [check]);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const getToken = useCallback(async () => null, []);
  if (me === 'loading') return <Loading />;
  if (me)
    return (
      <AdminProvider me={me} getToken={getToken} onAuthLost={() => setMe(null)} signOut={() => api('/admin/logout', { method: 'POST', body: {} }).finally(() => setMe(null))}>
        <Dashboard />
      </AdminProvider>
    );
  return (
    <Screen>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await api('/admin/login', { method: 'POST', body: { password: pw } });
            check();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h1 className="text-[28px] font-bold">Owner sign in</h1>
        <div className="mt-6">
          <Field id="a-pw" label="Admin password" error={error}>
            <input id="a-pw" type="password" autoComplete="current-password" className="field h-12 text-[16px]" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
        </div>
        <button className="btn btn-dark mt-5 h-12 w-full text-[16px]" disabled={!pw}>
          Sign in
        </button>
      </form>
    </Screen>
  );
}

// ---------- signed in ----------

type Tab = 'calendar' | 'requests' | 'bookings' | 'more';
const TABS: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'requests', label: 'Requests', icon: Inbox },
  { id: 'bookings', label: 'Bookings', icon: ClipboardList },
  { id: 'more', label: 'More', icon: Menu },
];
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'calendar';
};

function Dashboard() {
  const { call, version, live, me, signOut } = useAdmin();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [form, setForm] = useState<FormInit | null>(null);
  const [requests, setRequests] = useState<RequestItem[] | null>(null);
  const [reqError, setReqError] = useState('');

  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const on = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Requests drive the badge, so they load here (and refresh on live updates).
  useEffect(() => {
    call<RequestItem[]>('/requests')
      .then((r) => {
        setRequests(r);
        setReqError('');
      })
      .catch((e) => setReqError((e as Error).message));
  }, [call, version.requests, version.bookings]);
  const pending = requests?.filter((r) => r.status === 'pending').length ?? 0;

  const newBooking = (init?: Partial<FormInit>) => {
    const today = todayInIndia();
    setForm({ checkIn: today, checkOut: addDaysISO(today, 1), ...init });
  };

  return (
    <div className="min-h-dvh bg-white pb-[calc(76px+env(safe-area-inset-bottom))] text-[16px]">
      <header className="sticky top-0 z-30 border-b border-hairline bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1100px] items-center gap-3 px-4">
          <a href="/" aria-label="Golden Stay website" className="rounded-full">
            <Brand />
          </a>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted" title={live ? 'Live updates on' : 'Reconnecting…'}>
            <span className={`size-2 rounded-full ${live ? 'bg-[#2f8a4c]' : 'bg-[#c9c2ba]'}`} aria-hidden="true" />
            <span className="sr-only md:not-sr-only">{live ? 'Live' : 'Offline'}</span>
          </span>
          <button onClick={() => newBooking()} className="btn btn-dark ml-auto h-11 gap-1.5 px-4 text-[15px]">
            <Plus size={18} aria-hidden="true" /> New
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1100px] px-4 pt-5">
        {tab === 'calendar' && <CalendarView onOpenBooking={setOpenRef} onNewBooking={(i) => newBooking(i)} />}
        {tab === 'requests' && <RequestsView items={requests} error={reqError} onOpenBooking={setOpenRef} />}
        {tab === 'bookings' && <BookingsList onOpen={setOpenRef} />}
        {tab === 'more' && (
          <div className="space-y-8">
            <section className="rounded-[18px] bg-card p-5">
              <p className="text-[15px] text-muted">Signed in as</p>
              <p className="break-all text-[17px] font-semibold">{me.email ?? 'Admin (password)'}</p>
              <p className="mt-2 text-[14px] text-muted">
                Online payment gateway: {me.gatewayEnabled ? `on (${me.phonepeEnv})` : 'off — guests pay by UPI QR'}
              </p>
              <button onClick={signOut} className="btn btn-outline mt-4 h-12 w-full gap-2 text-[16px] md:w-auto md:px-6">
                <LogOut size={18} aria-hidden="true" /> Log out
              </button>
            </section>
            <section>
              <h2 className="mb-3 text-[20px] font-bold">Rooms &amp; prices</h2>
              <RoomsTab />
            </section>
            <section>
              <h2 className="mb-3 text-[20px] font-bold">Audit log</h2>
              <AuditTab />
            </section>
          </div>
        )}
      </main>

      <nav aria-label="Admin sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid h-[68px] max-w-[640px] grid-cols-4">
          {TABS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-1 text-[13px] font-semibold ${tab === id ? 'text-ink' : 'text-muted'}`}
              >
                <span className="relative">
                  <Icon size={24} strokeWidth={tab === id ? 2.4 : 1.9} aria-hidden="true" />
                  {id === 'requests' && pending > 0 && (
                    <span className="absolute -right-3 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#a3261b] px-1 text-[11.5px] font-bold text-white">
                      {pending}
                      <span className="sr-only"> pending</span>
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {openRef && <BookingDrawer refId={openRef} onClose={() => setOpenRef(null)} onEdit={(init) => { setOpenRef(null); setForm(init); }} />}
      {form && <BookingForm init={form} onClose={() => setForm(null)} onSaved={() => undefined} />}
    </div>
  );
}
