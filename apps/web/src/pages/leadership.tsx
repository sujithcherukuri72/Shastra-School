import clsx from 'clsx';
import {
  AlertTriangle, BellRing, Cake, CalendarCheck, Download, IndianRupee, Megaphone, MessageCircle, Plus, RefreshCw, Search, Send, Trash2, Upload, UserPlus,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, download, useAction, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { fmtDate, fmtDateLong, fmtDateTime, pct, rupees, todayISO } from '../lib/format.ts';
import { Async, Avatar, Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Stat, Table, Tabs, Td, Textarea, useToast } from '../components/ui.tsx';

const useMeta = () => useApi<{ classes: any[]; sections: any[]; subjects: any[]; years: any[] }>('/school/meta', { staleTime: 5 * 60_000 });

const heatColour = (v: number | null) =>
  v == null ? 'bg-navy-50 text-navy-300' : v >= 75 ? 'bg-green-600 text-white' : v >= 65 ? 'bg-green-300 text-navy-800' : v >= 55 ? 'bg-amber-300 text-navy-800' : v >= 45 ? 'bg-orange-400 text-white' : 'bg-red-600 text-white';

// ── Principal dashboard ─────────────────────────────────────────────────────
export function PrincipalDashboard() {
  const q = useApi('/dashboard/principal', { refetchInterval: 60_000 });
  return (
    <Async q={q}>
      {(d: any) => {
        const subjects = [...new Set(d.heatmap.map((h: any) => h.subject))] as string[];
        const classes = [...new Map(d.heatmap.map((h: any) => [h.class_id, h.class_name])).entries()];
        const cell = (cid: number, s: string) => d.heatmap.find((h: any) => h.class_id === cid && h.subject === s)?.avg_pct ?? null;
        const weakest = [...d.heatmap].sort((a: any, b: any) => a.avg_pct - b.avg_pct)[0];
        const feeTotal = Number(d.fees.paid) + Number(d.fees.part_paid) + Number(d.fees.not_paid) || 1;
        return (
          <div className="space-y-5">
            <PageHeader eyebrow={fmtDateLong(d.today)} title="How is the school today?" subtitle={`${d.counts.students} students · ${d.counts.teachers} teachers · ${d.counts.sections} sections`} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Attendance today" value={pct(d.attendance.pct)} sub={`${d.attendance.present} present · ${d.attendance.absent} absent`} tone={d.attendance.pct != null && d.attendance.pct < 85 ? 'warn' : 'good'} icon={<CalendarCheck className="size-4" />} />
              <Stat label="Sections not marked" value={d.attendance.unmarked.length} sub={d.attendance.unmarked.length ? 'Waiting for class teachers' : 'All done'} tone={d.attendance.unmarked.length ? 'warn' : 'good'} icon={<AlertTriangle className="size-4" />} />
              <Stat label="Term fee collected" value={rupees(d.fees.collected)} sub={`of ${rupees(d.fees.billed)} due so far`} icon={<IndianRupee className="size-4" />} />
              <Stat label="WhatsApp today" value={d.messages.sent} sub={`${d.messages.pending} queued · ${d.messages.failed} failed`} tone={Number(d.messages.failed) ? 'bad' : undefined} icon={<MessageCircle className="size-4" />} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Attendance · last 4 weeks" subtitle="School-wide % present per day" />
                <div className="h-60 px-2 pb-3">
                  <ResponsiveContainer>
                    <LineChart data={d.trend.map((t: any) => ({ ...t, label: fmtDate(t.day) }))} margin={{ left: -16, right: 12, top: 4 }}>
                      <CartesianGrid stroke="#E2E6EF" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5B6478' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis domain={[70, 100]} tick={{ fontSize: 11, fill: '#5B6478' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Line type="monotone" dataKey="pct" name="Present" stroke="#14213D" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <CardHeader title="Term fee status" subtitle="Students with fees due so far" />
                <div className="space-y-3 px-5 pb-5">
                  {[
                    ['Paid', d.fees.paid, 'bg-good'],
                    ['Part paid', d.fees.part_paid, 'bg-brand-gold'],
                    ['Not paid', d.fees.not_paid, 'bg-bad'],
                  ].map(([l, n, c]) => (
                    <div key={l}>
                      <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{l}</span><span className="text-navy-400">{n} students</span></div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-navy-50"><div className={clsx('h-full rounded-full', c)} style={{ width: `${(Number(n) / feeTotal) * 100}%` }} /></div>
                    </div>
                  ))}
                  <Link to="/fees" className="block pt-1 text-xs font-semibold text-navy-500">Open fees →</Link>
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Where help is needed" subtitle="Average score by class and subject, last 60 days" action={weakest && <Badge tone="bad">Lowest: {weakest.class_name} {weakest.subject} · {pct(weakest.avg_pct)}</Badge>} />
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full border-separate border-spacing-1 text-center text-xs">
                  <thead>
                    <tr>
                      <th />
                      {subjects.map((s) => <th key={s} className="px-1 pb-1 font-semibold text-navy-400">{s}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map(([cid, name]) => (
                      <tr key={cid as number}>
                        <th className="pr-2 text-left font-semibold whitespace-nowrap">{name as string}</th>
                        {subjects.map((s) => {
                          const v = cell(cid as number, s);
                          return <td key={s} className={clsx('h-10 min-w-16 rounded-lg font-bold', heatColour(v))}>{v == null ? '—' : `${Math.round(v)}%`}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader title="Not marked yet" subtitle="Today’s attendance" />
                {d.attendance.unmarked.length ? (
                  <ul className="divide-y divide-navy-50 pb-2">
                    {d.attendance.unmarked.map((s: any) => (
                      <li key={s.id} className="flex justify-between px-5 py-2 text-sm"><span className="font-semibold">{s.class_name} – {s.section_name}</span><span className="text-navy-400">{s.class_teacher ?? 'No class teacher'}</span></li>
                    ))}
                  </ul>
                ) : <Empty title="All sections marked ✓" />}
              </Card>
              <Card>
                <CardHeader title="Upcoming events" action={<Link to="/events" className="text-xs font-semibold text-navy-500">Manage</Link>} />
                {d.events.length ? (
                  <ul className="divide-y divide-navy-50 pb-2">
                    {d.events.map((e: any) => <li key={e.id} className="px-5 py-2 text-sm"><div className="font-semibold">{e.title}</div><div className="text-xs text-navy-400">{fmtDateTime(e.starts_at)}</div></li>)}
                  </ul>
                ) : <Empty title="No upcoming events" />}
              </Card>
              <Card>
                <CardHeader title="Announcements" action={<Link to="/notices" className="text-xs font-semibold text-navy-500">New</Link>} />
                <ul className="divide-y divide-navy-50 pb-2">
                  {d.notices.map((n: any) => <li key={n.id} className="px-5 py-2 text-sm"><div className="font-semibold">{n.title}</div><div className="text-xs text-navy-400">{fmtDateTime(n.created_at)}</div></li>)}
                </ul>
                <Link to="/birthdays" className="mx-5 mb-4 flex items-center gap-2 rounded-xl bg-brand-gold-soft px-3 py-2 text-sm font-semibold">
                  <Cake className="size-4" /> {d.birthdaysToday} birthday{d.birthdaysToday === 1 ? '' : 's'} today — wishes go out automatically
                </Link>
              </Card>
            </div>
          </div>
        );
      }}
    </Async>
  );
}

// ── Office: fees desk ───────────────────────────────────────────────────────
export function OfficeDesk() {
  const dash = useApi('/dashboard/office', { refetchInterval: 60_000 });
  const [term, setTerm] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const search = useApi(`/fees/search?q=${encodeURIComponent(term)}${onlyDue ? '&due=1' : ''}`);
  const [student, setStudent] = useState<any>(null);
  const toast = useToast();
  const remind = useAction(() => api.post('/fees/remind', {}), ['/messages', '/dashboard']);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fees desk"
        subtitle="Find any student, see every fee item, record counter payments. Online payments land here automatically."
        actions={
          <Button variant="gold" loading={remind.isPending} onClick={async () => {
            if (!confirm('Send a fee reminder (app + WhatsApp) to every family with dues?')) return;
            const r = await remind.mutateAsync(undefined);
            toast(`Reminded ${r.students} families · ${r.whatsapp} WhatsApp messages queued`);
          }}>
            <BellRing className="size-4" /> Remind all with dues
          </Button>
        }
      />
      <Async q={dash}>
        {(d: any) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Collected today" value={rupees(d.collected.amount)} sub={`${d.collected.payments} payments · ${rupees(d.collected.online)} online`} tone="good" />
            <Stat label="Due within 7 days" value={rupees(d.dueSoon.amount)} sub={`${d.dueSoon.students} students`} tone="warn" />
            <Stat label="Birthdays today" value={d.birthdays.length} sub={<Link to="/birthdays" className="font-semibold">Wishes →</Link>} />
            <Stat label="Failed WhatsApp (7 days)" value={d.failedMessages} tone={d.failedMessages ? 'bad' : undefined} sub={<Link to="/messages" className="font-semibold">Message log →</Link>} />
          </div>
        )}
      </Async>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <div className="flex items-center gap-2 p-4">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-navy-300" />
              <Input placeholder="Search name or admission no." value={term} onChange={(e) => setTerm(e.target.value)} className="pl-9" autoFocus />
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-navy-500">
              <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} className="accent-navy-800" /> With dues
            </label>
          </div>
          <Async q={search}>
            {(rows: any[]) => (
              <ul className="max-h-[60vh] divide-y divide-navy-50 overflow-y-auto">
                {rows.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setStudent(s)} className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-navy-50', student?.id === s.id && 'bg-brand-gold-soft/50')}>
                      <Avatar name={s.full_name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{s.full_name}</div>
                        <div className="text-xs text-navy-400">{s.admission_no} · {s.class_name}-{s.section_name}</div>
                      </div>
                      {Number(s.balance) > 0 ? <span className="text-sm font-bold text-bad">{rupees(s.balance)}</span> : <Badge tone="good">Paid</Badge>}
                    </button>
                  </li>
                ))}
                {!rows.length && <Empty title="No students found" />}
              </ul>
            )}
          </Async>
        </Card>
        {student ? <StudentLedger student={student} /> : <Card><Empty title="Choose a student" icon={<IndianRupee className="size-8" />}>Their fee items, payments and receipts appear here.</Empty></Card>}
      </div>
    </div>
  );
}

function StudentLedger({ student }: { student: any }) {
  const q = useApi(`/fees/students/${student.id}`);
  const [payOpen, setPayOpen] = useState(false);
  return (
    <Card>
      <CardHeader title={student.full_name} subtitle={`${student.admission_no} · ${student.class_name}-${student.section_name}`} action={<Button size="sm" onClick={() => setPayOpen(true)}><Plus className="size-4" /> Record payment</Button>} />
      <Async q={q}>
        {(d: any) => (
          <>
            <div className="grid grid-cols-3 gap-2 px-5 pb-3 text-center">
              <div className="rounded-xl bg-navy-50 p-2"><div className="text-xs text-navy-400">Total</div><div className="font-bold">{rupees(d.totals.amount)}</div></div>
              <div className="rounded-xl bg-green-50 p-2"><div className="text-xs text-good">Paid</div><div className="font-bold">{rupees(d.totals.paid)}</div></div>
              <div className="rounded-xl bg-red-50 p-2"><div className="text-xs text-bad">Balance</div><div className="font-bold">{rupees(d.totals.balance)}</div></div>
            </div>
            <Table head={['Item', 'Due', 'Amount', 'Paid', 'Status']}>
              {d.items.map((i: any) => (
                <tr key={i.id}>
                  <Td className="font-semibold">{i.term} · {i.title}</Td>
                  <Td className="text-navy-400">{fmtDate(i.due_on)}</Td>
                  <Td>{rupees(i.amount)}</Td>
                  <Td>{rupees(i.paid)}</Td>
                  <Td><Badge tone={{ paid: 'good', part_paid: 'gold', overdue: 'bad', due: 'neutral' }[i.status as string]}>{i.status.replace('_', ' ')}</Badge></Td>
                </tr>
              ))}
            </Table>
            <div className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-navy-400">Receipts</div>
            <ul className="divide-y divide-navy-50 pb-3">
              {d.payments.map((p: any) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <div className="flex-1">
                    <span className="font-semibold">{rupees(p.amount)}</span> <span className="text-navy-400">· {p.method}{p.provider ? ' (online)' : ''} · {fmtDate(p.paid_at)}</span>
                    <div className="text-xs text-navy-400">{p.receipt_no}{p.recorded_by ? ` · by ${p.recorded_by}` : ''}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => download(`/fees/payments/${p.id}/receipt.pdf`)}><Download className="size-3.5" /></Button>
                </li>
              ))}
              {!d.payments.length && <li className="px-5 py-2 text-sm text-navy-400">No payments yet</li>}
            </ul>
            <RecordPayment open={payOpen} onClose={() => setPayOpen(false)} studentId={student.id} items={d.items.filter((i: any) => i.balance > 0)} />
          </>
        )}
      </Async>
    </Card>
  );
}

function RecordPayment({ open, onClose, studentId, items }: { open: boolean; onClose: () => void; studentId: string; items: any[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const toast = useToast();
  const pay = useAction((b: any) => api.post('/fees/payments', b), ['/fees', '/dashboard']);
  const total = items.filter((i) => sel.includes(i.id)).reduce((a, i) => a + Number(i.balance), 0);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = Number(f.get('amount'));
    const r = await pay.mutateAsync({ student_id: studentId, fee_item_ids: sel, method: f.get('method'), amount: amount || undefined, reference: f.get('reference') || null });
    toast(`Payment recorded · receipt ${r.receipt_no}`);
    setSel([]);
    onClose();
    download(`/fees/payments/${r.id}/receipt.pdf`).catch(() => {});
  };
  return (
    <Modal open={open} onClose={onClose} title="Record counter payment">
      {items.length ? (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            {items.map((i) => (
              <label key={i.id} className="flex items-center gap-3 rounded-xl border border-navy-100 p-2.5 text-sm">
                <input type="checkbox" checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} className="accent-navy-800" />
                <span className="flex-1 font-semibold">{i.term} · {i.title}</span>
                <span className="font-bold">{rupees(i.balance)}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <Select name="method" defaultValue="cash">
                <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="netbanking">Bank transfer</option>
              </Select>
            </Field>
            <Field label="Amount" hint={`Full: ${rupees(total)}`}><Input name="amount" type="number" min={1} max={total || undefined} step="0.01" placeholder={String(total)} /></Field>
          </div>
          <Field label="Reference (cheque / UPI no.)"><Input name="reference" maxLength={80} /></Field>
          <ErrorBox error={pay.error} />
          <Button type="submit" className="w-full" disabled={!sel.length} loading={pay.isPending}>Save &amp; print receipt</Button>
        </form>
      ) : (
        <Empty title="Nothing due for this student" />
      )}
    </Modal>
  );
}

// ── Fee setup & reports ─────────────────────────────────────────────────────
export function FeesAdmin() {
  const meta = useMeta();
  const sum = useApi('/fees/summary');
  const recent = useApi('/fees/payments/recent');
  const toast = useToast();
  const create = useAction((b: any) => api.post('/fees/items', b), ['/fees']);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const target = String(f.get('target'));
    const [kind, id] = target.split(':');
    const r = await create.mutateAsync({
      ...(kind === 'class' ? { class_id: Number(id) } : { section_id: Number(id) }),
      term: f.get('term'),
      title: f.get('title'),
      amount: Number(f.get('amount')),
      due_on: f.get('due_on'),
    });
    toast(`Created ${r.created} fee items`);
    form.reset();
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Fee setup & reports" subtitle="Set next term’s fees ahead of time. Parents see them instantly in the app." />
      <Async q={sum}>
        {(s: any) => (
          <Card>
            <CardHeader title="This academic year by term" />
            <div className="h-56 px-3 pb-3">
              <ResponsiveContainer>
                <BarChart data={s.terms} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="#E2E6EF" vertical={false} />
                  <XAxis dataKey="term" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `₹${Math.round(v / 100000)}L`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => rupees(v as number)} />
                  <Bar dataKey="collected" name="Collected" stackId="a" fill="#14213D" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="outstanding" name="Outstanding" stackId="a" fill="#FFB81C" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </Async>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 font-bold">Add a fee for a class or section</h3>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Who pays">
              <Select name="target" required>
                {meta.data?.classes.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    <option value={`class:${c.id}`}>All of {c.name}</option>
                    {meta.data!.sections.filter((s) => s.class_id === c.id).map((s) => <option key={s.id} value={`section:${s.id}`}>{c.name} – {s.name} only</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Term"><Input name="term" required placeholder="Term 3" maxLength={40} /></Field>
              <Field label="Fee"><Input name="title" required placeholder="Tuition fee" maxLength={80} /></Field>
              <Field label="Amount (₹)"><Input name="amount" type="number" min={1} required /></Field>
              <Field label="Due on"><Input name="due_on" type="date" required /></Field>
            </div>
            <ErrorBox error={create.error} />
            <Button type="submit" className="w-full" loading={create.isPending}>Create fee items</Button>
            <p className="text-[11px] text-navy-400">Families get automatic reminders 7 days and 1 day before the due date.</p>
          </form>
        </Card>
        <Card>
          <CardHeader title="Latest payments" />
          <Async q={recent}>
            {(rows: any[]) => (
              <ul className="max-h-96 divide-y divide-navy-50 overflow-y-auto">
                {rows.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                    <div><div className="font-semibold">{p.student}</div><div className="text-xs text-navy-400">{p.receipt_no} · {p.method}{p.provider ? ' · online' : ''} · {fmtDateTime(p.paid_at)}</div></div>
                    <span className="font-bold">{rupees(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
      </div>
    </div>
  );
}

// ── Students ────────────────────────────────────────────────────────────────
export function StudentsPage() {
  const { me } = useAuth();
  const meta = useMeta();
  const [sectionId, setSectionId] = useState('');
  const [search, setSearch] = useState('');
  const q = useApi(`/students?limit=500${sectionId ? `&section_id=${sectionId}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = me!.user.role !== 'teacher';
  const cls = (id: number) => meta.data?.classes.find((c) => c.id === id)?.name;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Students"
        subtitle={q.data ? `${q.data.total} students` : undefined}
        actions={canEdit && (
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import CSV</Button>
            <Button onClick={() => setEdit({})}><UserPlus className="size-4" /> Add student</Button>
          </>
        )}
      />
      <Card>
        <div className="flex flex-wrap gap-2 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-navy-300" />
            <Input placeholder="Search name or admission no." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-48">
            <option value="">All sections</option>
            {meta.data?.sections.map((s) => <option key={s.id} value={s.id}>{cls(s.class_id)} – {s.name}</option>)}
          </Select>
        </div>
        <Async q={q}>
          {(d: any) => (
            <Table head={['Roll', 'Name', 'Admission', 'Class', 'Date of birth', 'Parent', '']}>
              {d.rows.map((s: any) => (
                <tr key={s.id} className="hover:bg-navy-50/50">
                  <Td className="text-navy-400">{s.roll_no}</Td>
                  <Td className="font-semibold">{s.full_name}</Td>
                  <Td className="text-navy-400">{s.admission_no}</Td>
                  <Td>{s.class_name}-{s.section_name}</Td>
                  <Td className="text-navy-400">{fmtDate(s.dob, { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                  <Td className="text-xs">{s.guardians?.map((g: any) => <div key={g.phone}>{g.name} · {g.phone}</div>)}</Td>
                  <Td>{canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
      {edit && <StudentForm student={edit} onClose={() => setEdit(null)} sections={meta.data?.sections ?? []} classes={meta.data?.classes ?? []} />}
      <ImportStudents open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function StudentForm({ student, onClose, sections, classes }: { student: any; onClose: () => void; sections: any[]; classes: any[] }) {
  const isNew = !student.id;
  const toast = useToast();
  const save = useAction((b: any) => (isNew ? api.post('/students', b) : api.patch(`/students/${student.id}`, b)), ['/students', '/fees/search']);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: any = {
      admission_no: f.admission_no,
      full_name: f.full_name,
      dob: f.dob || null,
      gender: f.gender || null,
      section_id: f.section_id ? Number(f.section_id) : null,
      roll_no: f.roll_no ? Number(f.roll_no) : null,
      address: f.address || null,
    };
    if (f.parent_phone) body.guardians = [{ full_name: f.parent_name || 'Parent', phone: f.parent_phone, relation: f.relation || 'parent', is_primary: true }];
    await save.mutateAsync(body);
    toast(isNew ? 'Student added' : 'Student updated');
    onClose();
  };
  const g = student.guardians?.[0];
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add student' : `Edit · ${student.full_name}`} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input name="full_name" required defaultValue={student.full_name} maxLength={150} /></Field>
        <Field label="Admission no."><Input name="admission_no" required defaultValue={student.admission_no} maxLength={30} /></Field>
        <Field label="Class & section">
          <Select name="section_id" defaultValue={student.section_id ?? ''}>
            <option value="">—</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{classes.find((c) => c.id === s.class_id)?.name} – {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Roll no."><Input name="roll_no" type="number" min={1} defaultValue={student.roll_no ?? ''} /></Field>
        <Field label="Date of birth" hint="Used for automatic birthday wishes"><Input name="dob" type="date" defaultValue={student.dob ?? ''} /></Field>
        <Field label="Gender">
          <Select name="gender" defaultValue={student.gender ?? ''}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select>
        </Field>
        <Field label="Address"><Input name="address" defaultValue={student.address ?? ''} maxLength={500} /></Field>
        <div />
        <div className="sm:col-span-2 mt-1 text-xs font-bold uppercase tracking-wider text-navy-400">Parent (login + WhatsApp)</div>
        <Field label="Parent name"><Input name="parent_name" defaultValue={g?.name ?? ''} maxLength={150} /></Field>
        <Field label="Parent mobile" hint="Parents sign in with a WhatsApp code to this number"><Input name="parent_phone" type="tel" defaultValue={g?.phone ?? ''} placeholder="98765 43210" /></Field>
        <Field label="Relation">
          <Select name="relation" defaultValue={g?.relation ?? 'parent'}><option value="father">Father</option><option value="mother">Mother</option><option value="guardian">Guardian</option><option value="parent">Parent</option></Select>
        </Field>
        <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
        <div className="sm:col-span-2"><Button type="submit" className="w-full" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

const CSV_HEADERS = ['admission_no', 'full_name', 'dob', 'gender', 'class_name', 'section', 'roll_no', 'parent_name', 'parent_phone', 'relation'];

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function ImportStudents({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  const imp = useAction((b: any) => api.post('/students/import', b), ['/students']);
  const onFile = async (file: File) => {
    setErr('');
    const data = parseCsv(await file.text());
    const head = data[0]?.map((h) => h.trim().toLowerCase());
    if (!head || !CSV_HEADERS.every((h) => head.includes(h))) return setErr(`The first row must contain: ${CSV_HEADERS.join(', ')}`);
    setRows(
      data.slice(1).map((r) => {
        const o: any = Object.fromEntries(head.map((h, i) => [h, r[i]?.trim() ?? '']));
        return { ...o, dob: o.dob || null, gender: o.gender?.toLowerCase() || null, roll_no: o.roll_no ? Number(o.roll_no) : null, relation: o.relation?.toLowerCase() || 'parent' };
      }),
    );
  };
  const template = () => {
    const blob = new Blob([CSV_HEADERS.join(',') + '\nSHS3001,Ravi Teja,2013-05-14,male,Class 8,A,19,Srinivas Teja,9876543210,father\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'students-template.csv';
    a.click();
  };
  return (
    <Modal open={open} onClose={() => { setRows(null); onClose(); }} title="Import students from CSV" wide>
      <div className="space-y-3">
        <p className="text-sm text-navy-500">One row per student. Existing admission numbers are updated; parents are matched by phone so siblings share one login.</p>
        <Button variant="secondary" size="sm" onClick={template}><Download className="size-4" /> Download template</Button>
        <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="py-2" />
        {err && <div className="text-sm text-bad">{err}</div>}
        {rows && (
          <>
            <div className="text-sm font-semibold">{rows.length} rows ready</div>
            <ErrorBox error={imp.error} />
            <Button className="w-full" loading={imp.isPending} onClick={async () => {
              const r = await imp.mutateAsync({ rows });
              toast(`Imported: ${r.created} new, ${r.updated} updated`);
              setRows(null);
              onClose();
            }}>Import {rows.length} students</Button>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Attendance overview (Principal) ─────────────────────────────────────────
export function AttendanceOverview() {
  const q = useApi('/dashboard/principal');
  const meta = useMeta();
  return (
    <div className="space-y-4">
      <PageHeader title="Attendance" subtitle="Class teachers mark attendance each morning. You can correct any section." />
      <Async q={q}>
        {(d: any) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {meta.data?.sections.map((s) => {
              const pending = d.attendance.unmarked.some((u: any) => u.id === s.id);
              return (
                <Link key={s.id} to={`/teacher/attendance/${s.id}`}>
                  <Card className="p-4 hover:border-navy-300">
                    <div className="flex items-center justify-between">
                      <div className="font-bold">{meta.data!.classes.find((c) => c.id === s.class_id)?.name} – {s.name}</div>
                      {pending ? <Badge tone="warn">Pending</Badge> : <Badge tone="good">Marked</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-navy-400">{s.class_teacher ?? 'No class teacher'} · {s.students} students</div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </Async>
    </div>
  );
}

// ── Exams & results (Principal) ─────────────────────────────────────────────
export function ResultsPage() {
  const meta = useMeta();
  const [classId, setClassId] = useState('');
  const q = useApi(`/academics/exams${classId ? `?class_id=${classId}` : ''}`);
  const toast = useToast();
  const publish = useAction((id: number) => api.post(`/academics/exams/${id}/publish`), ['/academics']);
  return (
    <div className="space-y-4">
      <PageHeader title="Exams & results" subtitle="Parents see marks only after a test is published." actions={
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-44">
          <option value="">All classes</option>
          {meta.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      } />
      <Card>
        <Async q={q}>
          {(rows: any[]) => (
            <Table head={['Test', 'Class', 'Date', 'Out of', 'Status', '']}>
              {rows.map((e) => (
                <tr key={e.id}>
                  <Td className="font-semibold">{e.name}</Td>
                  <Td>{e.class_name}</Td>
                  <Td className="text-navy-400">{fmtDate(e.exam_date)}</Td>
                  <Td>{e.max_marks}</Td>
                  <Td>{e.published_at ? <Badge tone="good">Published</Badge> : <Badge>Draft</Badge>}</Td>
                  <Td>{!e.published_at && <Button size="sm" variant="gold" onClick={() => publish.mutateAsync(e.id).then(() => toast('Published'))}>Publish</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
    </div>
  );
}

// ── Announcements ───────────────────────────────────────────────────────────
export function NoticesAdmin() {
  const { me } = useAuth();
  const meta = useMeta();
  const q = useApi('/notices');
  const toast = useToast();
  const create = useAction((b: any) => api.post('/notices', b), ['/notices', '/messages']);
  const del = useAction((id: string) => api.del(`/notices/${id}`), ['/notices']);
  const isPrincipal = me!.user.role === 'principal';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await create.mutateAsync({
      title: f.get('title'),
      body: f.get('body'),
      priority: f.get('priority'),
      audience: f.get('audience'),
      class_id: f.get('class_id') ? Number(f.get('class_id')) : null,
      send_whatsapp: f.get('send_whatsapp') === 'on',
    });
    toast(r.whatsapp ? `Posted · WhatsApp to ${r.whatsapp} parents` : 'Announcement posted');
    form.reset();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,400px)_1fr]">
      {isPrincipal && (
        <div>
          <PageHeader title="Announcements" />
          <Card className="p-5">
            <form onSubmit={submit} className="space-y-3">
              <Field label="Title"><Input name="title" required maxLength={200} /></Field>
              <Field label="Message"><Textarea name="body" rows={5} required maxLength={4000} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Audience"><Select name="audience"><option value="everyone">Everyone</option><option value="families">Families only</option><option value="staff">Staff only</option></Select></Field>
                <Field label="Priority"><Select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></Select></Field>
              </div>
              <Field label="Class">
                <Select name="class_id"><option value="">Whole school</option>{meta.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              </Field>
              <label className="flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm font-semibold text-good">
                <input type="checkbox" name="send_whatsapp" className="accent-green-700" /> Also send on WhatsApp to parents
              </label>
              <ErrorBox error={create.error} />
              <Button type="submit" className="w-full" loading={create.isPending}><Megaphone className="size-4" /> Post announcement</Button>
            </form>
          </Card>
        </div>
      )}
      <div className={clsx(!isPrincipal && 'lg:col-span-2')}>
        {!isPrincipal && <PageHeader title="Announcements" />}
        <Async q={q}>
          {(rows: any[]) => (
            <div className="space-y-3">
              {rows.map((n) => (
                <Card key={n.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{n.title}</span>
                    {n.priority !== 'normal' && <Badge tone={n.priority === 'urgent' ? 'bad' : 'gold'}>{n.priority}</Badge>}
                    <Badge>{n.class_name ?? 'Whole school'} · {n.audience}</Badge>
                    {n.send_whatsapp && <Badge tone="good">WhatsApp</Badge>}
                    {isPrincipal && <button onClick={() => confirm('Delete this announcement?') && del.mutate(n.id)} className="ml-auto text-navy-300 hover:text-bad" aria-label="Delete"><Trash2 className="size-4" /></button>}
                  </div>
                  <div className="text-xs text-navy-400">{fmtDateTime(n.created_at)} · {n.created_by}</div>
                  <p className="mt-2 text-sm whitespace-pre-line text-navy-600">{n.body}</p>
                </Card>
              ))}
              {!rows.length && <Card><Empty title="No announcements yet" /></Card>}
            </div>
          )}
        </Async>
      </div>
    </div>
  );
}

// ── Events ──────────────────────────────────────────────────────────────────
export function EventsAdmin() {
  const { me } = useAuth();
  const meta = useMeta();
  const q = useApi('/events');
  const toast = useToast();
  const create = useAction((b: any) => api.post('/events', b), ['/events']);
  const del = useAction((id: string) => api.del(`/events/${id}`), ['/events']);
  const isPrincipal = me!.user.role === 'principal';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const at = (d: FormDataEntryValue | null, t: FormDataEntryValue | null) => (d ? `${d}T${t || '09:00'}:00+05:30` : null);
    await create.mutateAsync({
      title: f.get('title'),
      description: f.get('description') || null,
      kind: f.get('kind'),
      starts_at: at(f.get('date'), f.get('start')),
      ends_at: f.get('end') ? at(f.get('date'), f.get('end')) : null,
      location: f.get('location') || null,
      class_id: f.get('class_id') ? Number(f.get('class_id')) : null,
    });
    toast('Event added — families have been notified');
    form.reset();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,400px)_1fr]">
      {isPrincipal && (
        <div>
          <PageHeader title="Events" />
          <Card className="p-5">
            <form onSubmit={submit} className="space-y-3">
              <Field label="Title"><Input name="title" required maxLength={200} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><Select name="kind">{['exhibition', 'meeting', 'sports', 'exam', 'holiday', 'celebration', 'other'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
                <Field label="Class"><Select name="class_id"><option value="">Whole school</option>{meta.data?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                <Field label="Date"><Input name="date" type="date" required min={todayISO()} /></Field>
                <Field label="Location"><Input name="location" maxLength={200} /></Field>
                <Field label="Starts"><Input name="start" type="time" defaultValue="09:00" /></Field>
                <Field label="Ends"><Input name="end" type="time" /></Field>
              </div>
              <Field label="Details"><Textarea name="description" rows={3} maxLength={4000} /></Field>
              <ErrorBox error={create.error} />
              <Button type="submit" className="w-full" loading={create.isPending}>Add event</Button>
            </form>
          </Card>
        </div>
      )}
      <div className={clsx(!isPrincipal && 'lg:col-span-2')}>
        {!isPrincipal && <PageHeader title="Events" />}
        <Async q={q}>
          {(rows: any[]) => (
            <Card>
              <ul className="divide-y divide-navy-50">
                {rows.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{e.title}</span><Badge>{e.kind}</Badge>{e.class_name && <Badge tone="info">{e.class_name}</Badge>}</div>
                      <div className="text-xs text-navy-400">{fmtDateTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</div>
                    </div>
                    {isPrincipal && <button onClick={() => confirm('Delete this event?') && del.mutate(e.id)} className="text-navy-300 hover:text-bad" aria-label="Delete"><Trash2 className="size-4" /></button>}
                  </li>
                ))}
                {!rows.length && <Empty title="No upcoming events" />}
              </ul>
            </Card>
          )}
        </Async>
      </div>
    </div>
  );
}

// ── Birthday wishes (Principal & Office only) ───────────────────────────────
export function BirthdaysPage() {
  const q = useApi('/birthdays');
  const toast = useToast();
  const save = useAction((b: any) => api.put('/birthdays/settings', b), ['/birthdays']);
  const sendNow = useAction(() => api.post('/birthdays/send-now'), ['/birthdays', '/messages']);
  return (
    <Async q={q}>
      {(d: any) => {
        const today = d.upcoming.filter((u: any) => u.day === d.today);
        const later = d.upcoming.filter((u: any) => u.day !== d.today);
        return (
          <div className="space-y-5">
            <PageHeader
              eyebrow="Principal & Office only"
              title="Automatic birthday wishes"
              subtitle={`Every morning at ${d.sendTime}, each birthday student’s family gets a WhatsApp wish from the school. Parents and teachers cannot see this page.`}
              actions={<Button variant="secondary" loading={sendNow.isPending} onClick={() => sendNow.mutateAsync(undefined).then((r: any) => toast(r.queued ? `${r.queued} wishes queued` : 'Today’s wishes were already sent'))}><Send className="size-4" /> Send today’s now</Button>}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title={`Today · ${today.length} birthday${today.length === 1 ? '' : 's'}`} icon={<Cake className="size-5" />} />
                <ul className="divide-y divide-navy-50 pb-2">
                  {today.map((s: any) => (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <Avatar name={s.full_name} />
                      <div className="flex-1"><div className="font-semibold">{s.full_name}</div><div className="text-xs text-navy-400">{s.class_name}-{s.section_name} · turning {s.turning}</div></div>
                    </li>
                  ))}
                  {!today.length && <Empty title="No birthdays today" />}
                </ul>
                <div className="border-t border-navy-50 px-5 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-navy-400">Coming up</div>
                <ul className="divide-y divide-navy-50 pb-2">
                  {later.map((s: any) => (
                    <li key={s.id + s.day} className="flex justify-between px-5 py-2 text-sm"><span>{s.full_name} <span className="text-navy-400">· {s.class_name}-{s.section_name}</span></span><span className="text-navy-400">{fmtDate(s.day)}</span></li>
                  ))}
                  {d.staff.map((s: any) => (
                    <li key={s.id + s.day} className="flex justify-between px-5 py-2 text-sm"><span>{s.full_name} <Badge tone="info">staff</Badge></span><span className="text-navy-400">{fmtDate(s.day)}</span></li>
                  ))}
                </ul>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 font-bold">Message</h3>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await save.mutateAsync({ enabled: f.get('enabled') === 'on', include_staff: f.get('include_staff') === 'on', template: f.get('template'), signature: f.get('signature') });
                    toast('Birthday settings saved');
                  }}
                  className="space-y-3"
                >
                  <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={d.settings.enabled} className="accent-navy-800" /> Send wishes automatically</label>
                  <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="include_staff" defaultChecked={d.settings.include_staff} className="accent-navy-800" /> Also wish staff</label>
                  <Field label="Wish" hint="{name} is replaced with the first name"><Textarea name="template" rows={4} required maxLength={600} defaultValue={d.settings.template} /></Field>
                  <Field label="Signed by"><Input name="signature" required maxLength={150} defaultValue={d.settings.signature} /></Field>
                  <ErrorBox error={save.error} />
                  <Button type="submit" className="w-full" loading={save.isPending}>Save</Button>
                </form>
              </Card>
            </div>
            <Card>
              <CardHeader title="Sent wishes · last 30 days" subtitle="Delivered and read status from WhatsApp" />
              <Table head={['Student', 'To', 'Status', 'Sent']}>
                {d.sent.map((m: any) => (
                  <tr key={m.id}>
                    <Td className="font-semibold">{m.student_name ?? '—'}</Td>
                    <Td>{m.recipient}</Td>
                    <Td><MsgStatus s={m.status} /></Td>
                    <Td className="text-navy-400">{fmtDateTime(m.created_at)}</Td>
                  </tr>
                ))}
              </Table>
              {!d.sent.length && <Empty title="No wishes sent yet" />}
            </Card>
          </div>
        );
      }}
    </Async>
  );
}

const MsgStatus = ({ s }: { s: string }) => <Badge tone={{ read: 'good', delivered: 'good', sent: 'info', queued: 'neutral', sending: 'neutral', failed: 'bad' }[s]}>{s}</Badge>;

// ── WhatsApp log ────────────────────────────────────────────────────────────
export function MessagesPage() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const q = useApi(`/messages?${new URLSearchParams({ ...(kind && { kind }), ...(status && { status }) })}`, { refetchInterval: 15_000 });
  const retry = useAction((id: string) => api.post(`/messages/${id}/retry`), ['/messages']);
  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp log" subtitle="Every automatic message: absence alerts, fee reminders, report cards, notices, receipts and birthday wishes." actions={
        <>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-44">
            <option value="">All types</option>
            {['absence', 'fee_reminder', 'monthly_report', 'notice', 'birthday', 'payment_receipt'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="">Any status</option>
            {['queued', 'sent', 'delivered', 'read', 'failed'].map((k) => <option key={k}>{k}</option>)}
          </Select>
        </>
      } />
      <Card>
        <Async q={q}>
          {(d: any) => (
            <Table head={['Type', 'Message', 'To', 'Status', 'Time', '']}>
              {d.rows.map((m: any) => (
                <tr key={m.id}>
                  <Td><Badge>{m.kind.replace('_', ' ')}</Badge></Td>
                  <Td className="max-w-md"><div className="line-clamp-2 text-xs text-navy-600">{m.preview}</div>{m.last_error && <div className="text-xs text-bad">{m.last_error}</div>}</Td>
                  <Td className="text-xs whitespace-nowrap">{m.recipient}<div className="text-navy-400">{m.to_phone}</div></Td>
                  <Td><MsgStatus s={m.status} /></Td>
                  <Td className="text-xs whitespace-nowrap text-navy-400">{fmtDateTime(m.created_at)}</Td>
                  <Td>{m.status === 'failed' && <Button size="sm" variant="ghost" onClick={() => retry.mutate(m.id)}><RefreshCw className="size-3.5" /></Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
    </div>
  );
}

// ── Staff & classes setup (Principal) ───────────────────────────────────────
export function SetupPage() {
  const [tab, setTab] = useState<'staff' | 'classes' | 'subjects' | 'holidays'>('staff');
  return (
    <div className="space-y-4">
      <PageHeader title="Staff & classes" subtitle="Accounts, class teachers and who teaches what." />
      <Tabs value={tab} onChange={setTab} options={[{ value: 'staff', label: 'Staff' }, { value: 'classes', label: 'Class teachers & subjects' }, { value: 'subjects', label: 'Classes & subjects' }, { value: 'holidays', label: 'Holidays' }]} />
      {tab === 'staff' && <StaffTab />}
      {tab === 'classes' && <AssignmentsTab />}
      {tab === 'subjects' && <StructureTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </div>
  );
}

function StaffTab() {
  const q = useApi('/school/staff');
  const [form, setForm] = useState<any>(null);
  const toast = useToast();
  const save = useAction((b: any) => (form?.id ? api.patch(`/school/staff/${form.id}`, b) : api.post('/school/staff', b)), ['/school']);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body: any = { full_name: f.full_name, email: f.email, phone: f.phone || null, dob: f.dob || null };
    if (!form.id) body.role = f.role;
    if (f.password) body.password = f.password;
    if (form.id) body.is_active = f.is_active === 'on';
    await save.mutateAsync(body);
    toast('Saved');
    setForm(null);
  };
  return (
    <Card>
      <CardHeader title="Staff accounts" action={<Button size="sm" onClick={() => setForm({})}><UserPlus className="size-4" /> Add staff</Button>} />
      <Async q={q}>
        {(rows: any[]) => (
          <Table head={['Name', 'Role', 'Email', 'Phone', 'Last sign-in', 'Status', '']}>
            {rows.map((u) => (
              <tr key={u.id}>
                <Td className="font-semibold">{u.full_name}</Td>
                <Td><Badge tone={u.role === 'principal' ? 'navy' : u.role === 'office' ? 'gold' : 'neutral'}>{u.role}</Badge></Td>
                <Td className="text-navy-500">{u.email}</Td>
                <Td className="text-navy-500">{u.phone}</Td>
                <Td className="text-xs text-navy-400">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Never'}</Td>
                <Td>{u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setForm(u)}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Async>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Edit · ${form.full_name}` : 'Add staff member'}>
        {form && (
          <form onSubmit={submit} className="space-y-3">
            {!form.id && <Field label="Role"><Select name="role" defaultValue="teacher"><option value="teacher">Teacher</option><option value="office">School office</option><option value="principal">Principal</option></Select></Field>}
            <Field label="Full name"><Input name="full_name" required defaultValue={form.full_name} /></Field>
            <Field label="Email (sign-in)"><Input name="email" type="email" required defaultValue={form.email} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile"><Input name="phone" type="tel" defaultValue={form.phone ?? ''} /></Field>
              <Field label="Date of birth"><Input name="dob" type="date" defaultValue={form.dob ?? ''} /></Field>
            </div>
            <Field label={form.id ? 'Reset password (optional)' : 'Password'} hint="At least 10 characters with letters and numbers. Share it privately.">
              <Input name="password" type="password" autoComplete="new-password" required={!form.id} minLength={10} />
            </Field>
            {form.id && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="is_active" defaultChecked={form.is_active} className="accent-navy-800" /> Account active</label>}
            <ErrorBox error={save.error} />
            <Button type="submit" className="w-full" loading={save.isPending}>Save</Button>
          </form>
        )}
      </Modal>
    </Card>
  );
}

function AssignmentsTab() {
  const meta = useMeta();
  const staff = useApi<any[]>('/school/staff');
  const ta = useApi<any[]>('/school/teaching-assignments');
  const setCT = useAction((v: { id: number; t: string | null }) => api.patch(`/school/sections/${v.id}`, { class_teacher_id: v.t }), ['/school']);
  const setTA = useAction((v: any) => api.put('/school/teaching-assignments', v), ['/school']);
  const teachers = (staff.data ?? []).filter((s) => s.role === 'teacher' && s.is_active);
  const lookup = useMemo(() => new Map((ta.data ?? []).map((a) => [`${a.section_id}:${a.subject_id}`, a.teacher_id])), [ta.data]);
  if (!meta.data || !staff.data || !ta.data) return <Card><Empty title="Loading…" /></Card>;
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400">
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2">Class teacher</th>
              {meta.data.subjects.map((s) => <th key={s.id} className="px-3 py-2">{s.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {meta.data.sections.map((sec) => (
              <tr key={sec.id}>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{meta.data!.classes.find((c) => c.id === sec.class_id)?.name} – {sec.name}</td>
                <td className="px-2 py-1.5">
                  <Select value={sec.class_teacher_id ?? ''} onChange={(e) => setCT.mutate({ id: sec.id, t: e.target.value || null })} className="h-8 min-w-36 text-xs">
                    <option value="">—</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </Select>
                </td>
                {meta.data!.subjects.map((s) => (
                  <td key={s.id} className="px-2 py-1.5">
                    <Select value={lookup.get(`${sec.id}:${s.id}`) ?? ''} onChange={(e) => setTA.mutate({ section_id: sec.id, subject_id: s.id, teacher_id: e.target.value || null })} className="h-8 min-w-32 text-xs">
                      <option value="">—</option>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                    </Select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StructureTab() {
  const meta = useMeta();
  const toast = useToast();
  const addClass = useAction((b: any) => api.post('/school/classes', b), ['/school']);
  const addSubject = useAction((b: any) => api.post('/school/subjects', b), ['/school']);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 font-bold">Add a class</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          await addClass.mutateAsync({ name: f.get('name'), grade: Number(f.get('grade')), sections: String(f.get('sections')).split(',').map((s) => s.trim()).filter(Boolean) });
          toast('Class added');
          form.reset();
        }} className="grid grid-cols-3 gap-3">
          <Field label="Name"><Input name="name" required placeholder="Class 5" /></Field>
          <Field label="Grade"><Input name="grade" type="number" min={0} max={12} required /></Field>
          <Field label="Sections"><Input name="sections" defaultValue="A, B" /></Field>
          <div className="col-span-3"><ErrorBox error={addClass.error} /><Button type="submit" loading={addClass.isPending}>Add class</Button></div>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">{meta.data?.classes.map((c) => <Badge key={c.id}>{c.name} · {meta.data!.sections.filter((s) => s.class_id === c.id).map((s) => s.name).join(', ')}</Badge>)}</div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-bold">Add a subject</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          await addSubject.mutateAsync({ name: f.get('name'), code: f.get('code') });
          toast('Subject added');
          form.reset();
        }} className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input name="name" required placeholder="Computer Science" /></Field>
          <Field label="Code"><Input name="code" required placeholder="CS" maxLength={12} /></Field>
          <div className="col-span-2"><ErrorBox error={addSubject.error} /><Button type="submit" loading={addSubject.isPending}>Add subject</Button></div>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">{meta.data?.subjects.map((s) => <Badge key={s.id}>{s.name} ({s.code})</Badge>)}</div>
      </Card>
    </div>
  );
}

function HolidaysTab() {
  const q = useApi<any[]>('/school/holidays');
  const save = useAction((b: any) => api.put('/school/holidays', b), ['/school/holidays']);
  return (
    <Card className="p-5">
      <form onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        await save.mutateAsync({ day: f.get('day'), name: f.get('name') });
        form.reset();
      }} className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Date"><Input name="day" type="date" required /></Field>
        <Field label="Holiday"><Input name="name" required placeholder="Dussehra" /></Field>
        <Button type="submit" loading={save.isPending}>Add</Button>
      </form>
      <ul className="divide-y divide-navy-50">
        {q.data?.map((h) => (
          <li key={h.day} className="flex items-center justify-between py-2 text-sm">
            <span><b>{fmtDateLong(h.day)}</b> · {h.name}</span>
            <button onClick={() => save.mutate({ day: h.day, name: null })} className="text-navy-300 hover:text-bad" aria-label="Remove"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────────
export function AuditPage() {
  const q = useApi('/school/audit?limit=300');
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Sign-ins, payments, marks changes and account changes. Kept for accountability." />
      <Card>
        <Async q={q}>
          {(rows: any[]) => (
            <Table head={['Time', 'Who', 'Action', 'Record', 'IP']}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs whitespace-nowrap text-navy-400">{fmtDateTime(r.created_at)}</Td>
                  <Td className="text-sm">{r.actor ?? 'system'} {r.actor_role && <Badge>{r.actor_role}</Badge>}</Td>
                  <Td><Badge tone={/fail|lock|invalid/.test(r.action) ? 'bad' : 'neutral'}>{r.action}</Badge></Td>
                  <Td className="text-xs text-navy-400">{r.entity}{r.meta && Object.keys(r.meta).length ? ` · ${JSON.stringify(r.meta).slice(0, 80)}` : ''}</Td>
                  <Td className="text-xs text-navy-400">{r.ip}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Async>
      </Card>
    </div>
  );
}
