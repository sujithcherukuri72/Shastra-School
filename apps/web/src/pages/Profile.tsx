import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import type { FormEvent } from 'react';
import { api, useAction } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Avatar, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, useToast } from '../components/ui.tsx';

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
