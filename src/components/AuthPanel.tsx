import { useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { authErrorMessage, useAuth } from '../lib/auth';
import { Alert, Field, Spinner } from './ui';

type Mode = 'signin' | 'signup' | 'reset';

/** Email + password sign-in / create account / reset password, in the site's style. */
export function AuthPanel({ intro }: { intro?: string }) {
  const { signIn, signUp, resetPassword, configured } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchTo = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
  };

  const submit = async (e?: SyntheticEvent) => {
    e?.preventDefault();
    setError('');
    setNotice('');
    if (mode === 'signup' && name.trim().length < 2) return setError('Please enter your full name.');
    if (!email.trim()) return setError('Please enter your email address.');
    if (mode !== 'reset' && password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') await signUp({ name, email, password });
      else {
        await resetPassword(email);
        setNotice('If an account exists for that email, we’ve sent a link to reset your password.');
      }
    } catch (err) {
      // Don't reveal whether an email is registered when resetting.
      if (mode === 'reset') setNotice('If an account exists for that email, we’ve sent a link to reset your password.');
      else setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <Alert tone="warn" title="Online booking sign-in isn’t available yet">
        Please send an enquiry or message us on WhatsApp and we’ll confirm your booking.
      </Alert>
    );
  }

  const title = { signin: 'Sign in to book', signup: 'Create your account', reset: 'Reset your password' }[mode];
  const cta = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];

  // Rendered as a form-like region (not a <form>) so it can sit inside the checkout form.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div role="form" aria-label={title} onKeyDown={onKeyDown}>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {intro && mode !== 'reset' && <p className="mt-1 text-[13.5px] leading-[1.55] text-muted">{intro}</p>}

      <div className="mt-4 space-y-4">
        {mode === 'signup' && (
          <Field id="au-name" label="Full name">
            <input id="au-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field id="au-email" label="Email">
          <input
            id="au-email"
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {mode !== 'reset' && (
          <Field id="au-password" label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
            <input
              id="au-password"
              className="field"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
      </div>

      <div aria-live="polite" className="mt-4 space-y-3 empty:mt-0">
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {notice && <Alert tone="info">{notice}</Alert>}
      </div>

      <button type="button" onClick={submit} disabled={busy} className="btn btn-dark mt-5 h-12 w-full text-[14.5px] disabled:opacity-60">
        {busy ? <Spinner label="Please wait" /> : cta}
      </button>

      <div className="mt-4 flex flex-wrap justify-between gap-2 text-[13px]">
        {mode === 'signin' ? (
          <>
            <button type="button" className="link-underline font-semibold" onClick={() => switchTo('signup')}>
              New here? Create an account
            </button>
            <button type="button" className="link-underline text-muted" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className="link-underline font-semibold" onClick={() => switchTo('signin')}>
            {mode === 'signup' ? 'Already have an account? Sign in' : 'Back to sign in'}
          </button>
        )}
      </div>
    </div>
  );
}
