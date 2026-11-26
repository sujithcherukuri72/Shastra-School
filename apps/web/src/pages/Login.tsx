import { KeyRound, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useApi } from '../lib/api.ts';
import { Logo } from '../components/layouts.tsx';
import { Button, ErrorBox, Field, Input, Tabs } from '../components/ui.tsx';

export default function Login() {
  const [mode, setMode] = useState<'family' | 'staff'>('family');
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-800 lg:block">
        <div className="stripe absolute inset-x-0 top-0 h-2" />
        <div className="flex h-full flex-col justify-between p-12">
          <Logo light />
          <div>
            <div className="mb-4 inline-block rounded bg-brand-gold px-3 py-1 text-xs font-extrabold tracking-[0.2em] text-navy-800">SHASTRA THE NEW AGE SCHOOL</div>
            <h1 className="font-display text-5xl leading-[1.05] font-semibold text-white">
              One app for the <span className="italic text-brand-gold">whole school.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg text-navy-200">
              Every update a teacher makes reaches the parent the same day. No lost diaries. No missed notices. No surprise fee calls.
            </p>
          </div>
          <div className="text-sm text-navy-300">Suryapet · IIT-JEE &amp; NEET Foundation · Sports · Discipline · Values</div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="font-display text-3xl font-semibold">Welcome</h2>
          <p className="mt-1 mb-6 text-sm text-navy-400">Sign in to Shastra Connect</p>
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'family', label: 'Parent / Student' },
              { value: 'staff', label: 'School staff' },
            ]}
          />
          <div className="mt-6">{mode === 'family' ? <FamilyLogin /> : <StaffLogin />}</div>
          <p className="mt-8 text-xs text-navy-400">
            Protected sign-in. Never share your login code or password — school staff will never ask for it.
          </p>
        </div>
      </div>
    </div>
  );
}

function useSignedIn() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['/auth/session'] });
  };
}

function StaffLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<'verify' | 'enroll' | null>(null);
  const done = useSignedIn();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ mfa?: 'verify' | 'enroll' }>('/auth/login', { email, password });
      if (r.mfa) {
        setPassword('');
        setMfa(r.mfa);
      } else await done();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  if (mfa === 'verify') return <MfaVerify onBack={() => setMfa(null)} />;
  if (mfa === 'enroll') return <MfaEnroll onBack={() => setMfa(null)} />;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shastra.school" />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorBox error={err} />
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        <KeyRound className="size-4" /> Sign in
      </Button>
    </form>
  );
}

function FamilyLogin() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useSignedIn();

  const request = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/otp/request', { phone });
      setSent(true);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/otp/verify', { phone, code });
      await done();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  if (!sent)
    return (
      <form onSubmit={request} className="space-y-4">
        <Field label="Mobile number registered with the school">
          <div className="relative">
            <Phone className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-navy-300" />
            <Input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="pl-9" />
          </div>
        </Field>
        <ErrorBox error={err} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <MessageCircle className="size-4" /> Send code on WhatsApp
        </Button>
      </form>
    );

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="rounded-xl bg-green-50 px-3 py-2 text-sm text-good">If {phone} is registered, a 6-digit code has been sent on WhatsApp.</div>
      <Field label="6-digit code">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center text-xl font-bold tracking-[0.5em]"
        />
      </Field>
      <ErrorBox error={err} />
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Verify &amp; sign in
      </Button>
      <div className="flex justify-between text-xs">
        <button type="button" className="font-semibold text-navy-500 hover:underline" onClick={() => setSent(false)}>
          Change number
        </button>
        <button type="button" className="font-semibold text-navy-500 hover:underline" onClick={() => request()}>
          Resend code
        </button>
      </div>
    </form>
  );
}

// ── Two-step login (Principal & Office) ─────────────────────────────────────
function MfaVerify({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useSignedIn();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/mfa/verify', { code });
      await done();
    } catch (x) {
      setErr(x);
      setCode('');
      if (x instanceof ApiError && x.status === 401) setTimeout(onBack, 1500);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-navy-50 p-3 text-sm text-navy-600">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-navy-800" />
        {recovery ? 'Enter one of your saved recovery codes (like 7KQ4-M2XD). Each code works once.' : 'Open your authenticator app and enter the 6-digit code for Shastra Connect.'}
      </div>
      <Field label={recovery ? 'Recovery code' : '6-digit code'}>
        <Input
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={recovery ? 9 : 6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
          className="text-center text-xl font-bold tracking-[0.4em]"
          aria-label={recovery ? 'Recovery code' : 'Authenticator code'}
        />
      </Field>
      <ErrorBox error={err} />
      <Button type="submit" size="lg" className="w-full" loading={busy}>Verify &amp; sign in</Button>
      <div className="flex justify-between text-xs">
        <button type="button" className="font-semibold text-navy-500 hover:underline" onClick={onBack}>Back</button>
        <button type="button" className="font-semibold text-navy-500 hover:underline" onClick={() => { setRecovery(!recovery); setCode(''); }}>
          {recovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>
      </div>
    </form>
  );
}

function MfaEnroll({ onBack }: { onBack: () => void }) {
  const setup = useApi<{ secret: string; qr: string }>('/auth/mfa/setup', { staleTime: Infinity, retry: false });
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useSignedIn();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enroll', { code });
      setCodes(r.recoveryCodes);
    } catch (x) {
      setErr(x);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (codes)
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-good">Two-step login is on.</div>
        <div>
          <div className="text-sm font-bold">Save your recovery codes</div>
          <p className="text-xs text-navy-400">If you lose your phone, each code lets you sign in once. Keep them somewhere safe — they are shown only now.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-navy-100 bg-white p-3 font-mono text-sm font-bold" data-testid="recovery-codes">
          {codes.map((c) => <div key={c}>{c}</div>)}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([`Shastra Connect recovery codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' }));
              a.download = 'shastra-connect-recovery-codes.txt';
              a.click();
            }}
          >
            Download
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="accent-navy-800" /> I have saved these codes
        </label>
        <Button size="lg" className="w-full" disabled={!saved} onClick={() => void done()}>Continue to Shastra Connect</Button>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-5" /> Set up two-step login</div>
        <p className="mt-1 text-xs text-navy-400">
          Required for Principal and Office accounts. Install <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> on your phone, tap <b>+</b>, and scan this code.
        </p>
      </div>
      {setup.error ? (
        <ErrorBox error={setup.error} />
      ) : !setup.data ? (
        <div className="h-[220px] animate-pulse rounded-xl bg-navy-50" />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-navy-100 bg-white p-3">
          <img src={setup.data.qr} alt="QR code for your authenticator app" width={220} height={220} />
          <div className="text-center text-[11px] text-navy-400">
            Can’t scan? Enter this key in the app:
            <div className="mt-0.5 font-mono text-xs font-bold text-navy-700" data-testid="mfa-secret">{setup.data.secret}</div>
          </div>
        </div>
      )}
      <Field label="Then enter the 6-digit code the app shows">
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-xl font-bold tracking-[0.4em]" aria-label="Authenticator code" />
      </Field>
      <ErrorBox error={err} />
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!setup.data}>Turn on two-step login</Button>
      <button type="button" className="text-xs font-semibold text-navy-500 hover:underline" onClick={onBack}>Back</button>
    </form>
  );
}