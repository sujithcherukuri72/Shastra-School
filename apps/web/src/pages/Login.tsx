import { KeyRound, MessageCircle, Phone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
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
  const done = useSignedIn();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/login', { email, password });
      await done();
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
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
