import { KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, useAction } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Avatar, Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, useToast } from '../components/ui.tsx';

export default function Profile() {
  const { me, logout } = useAuth();
  const toast = useToast();
  const change = useAction((b: any) => api.post('/auth/password', b));
  const everywhere = useAction(() => api.post('/auth/logout-everywhere'));
  const staff = me!.user.role === 'principal' || me!.user.role === 'office' || me!.user.role === 'teacher';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) return toast('The new passwords do not match', 'bad');
    await change.mutateAsync({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') });
    form.reset();
    toast('Password changed. Other devices have been signed out.');
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Profile & security" />
      <Card className="flex items-center gap-4 p-5">
        <Avatar name={me!.user.full_name} className="size-14 text-lg" />
        <div>
          <div className="text-lg font-bold">{me!.user.full_name}</div>
          <div className="text-sm text-navy-400 capitalize">{me!.user.role} · {me!.user.email ?? me!.user.phone}</div>
        </div>
      </Card>
      {staff && (
        <Card>
          <CardHeader title="Change password" icon={<KeyRound className="size-5" />} subtitle="At least 10 characters, with letters and numbers" />
          <form onSubmit={submit} className="space-y-3 px-5 pb-5">
            <Field label="Current password"><Input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
            <Field label="New password"><Input name="newPassword" type="password" autoComplete="new-password" minLength={10} required /></Field>
            <Field label="Repeat new password"><Input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
            <ErrorBox error={change.error} />
            <Button type="submit" loading={change.isPending}>Update password</Button>
          </form>
        </Card>
      )}
      {me!.mfa && <TwoStepCard />}
      <Card>
        <CardHeader title="Sessions" icon={<ShieldCheck className="size-5" />} subtitle="Lost a phone? Sign out of Shastra Connect on every device." />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <Button variant="secondary" loading={everywhere.isPending} onClick={async () => { await everywhere.mutateAsync(undefined); window.location.assign('/login'); }}>Sign out everywhere</Button>
          <Button variant="ghost" onClick={logout}><LogOut className="size-4" /> Sign out</Button>
        </div>
      </Card>
    </div>
  );
}

function TwoStepCard() {
  const { me, refresh } = useAuth();
  const [codes, setCodes] = useState<string[] | null>(null);
  const regen = useAction((code: string) => api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code }));
  const m = me!.mfa!;
  return (
    <Card>
      <CardHeader
        title="Two-step login"
        icon={<Smartphone className="size-5" />}
        subtitle="Every sign-in needs your password and a code from your authenticator app"
        action={<Badge tone={m.enabled ? 'good' : 'warn'}>{m.enabled ? 'On' : 'Off'}</Badge>}
      />
      <div className="space-y-3 px-5 pb-5 text-sm">
        <p className="text-navy-500">
          Recovery codes left: <b className={m.recovery_left <= 3 ? 'text-bad' : ''}>{m.recovery_left}</b> of 10.
          {m.recovery_left <= 3 && ' Create new ones soon.'}
        </p>
        {codes ? (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-navy-100 p-3 font-mono font-bold">{codes.map((c) => <div key={c}>{c}</div>)}</div>
            <p className="text-xs text-navy-400">Your old codes no longer work. Save these somewhere safe.</p>
            <Button size="sm" variant="secondary" onClick={() => { setCodes(null); refresh(); }}>Done</Button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get('code') ?? '');
              const r = await regen.mutateAsync(code).catch(() => null); // error shown below
              if (r) setCodes(r.recoveryCodes);
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Field label="Code from your app">
              <Input name="code" inputMode="numeric" maxLength={6} required pattern="\d{6}" className="w-32 text-center font-bold tracking-widest" />
            </Field>
            <Button type="submit" variant="secondary" loading={regen.isPending}>New recovery codes</Button>
            <div className="w-full"><ErrorBox error={regen.error} /></div>
          </form>
        )}
        <p className="text-xs text-navy-400">New phone? Ask the Principal to reset your two-step login, then set it up again at your next sign-in.</p>
      </div>
    </Card>
  );
}