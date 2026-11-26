import clsx from 'clsx';
import {
  BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileCheck2, FileText, IndianRupee, Lock, Trophy, Upload, AlertTriangle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, download, openFile, useAction, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { fmtDate, fmtDateLong, fmtDateTime, fmtTime, gradeTone, pct, relDays, rupees, todayISO } from '../lib/format.ts';
import { familyMoreLinks } from '../components/layouts.tsx';
import { Async, Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Modal, Progress, Tabs, Textarea, useToast } from '../components/ui.tsx';

const useChild = () => useAuth().child!;

// ── Home ────────────────────────────────────────────────────────────────────
export function FamilyHome() {
  const child = useChild();
  const q = useApi(`/dashboard/family/${child.id}`);
  return (
    <Async q={q}>
      {(d: any) => (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-navy-400">{fmtDateLong(d.today)}</div>
            <h1 className="font-display text-2xl font-semibold">Hello! Here’s {child.full_name.split(' ')[0]}’s day</h1>
          </div>
          {d.attendance.today === 'absent' && (
            <Link to="/family/attendance" className="flex items-center gap-3 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-bad">
              <AlertTriangle className="size-5" /> Marked absent today. Tap to add a reason.
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Link to="/family/attendance">
              <Card className="h-full p-4">
                <div className="text-xs font-semibold text-navy-400">Attendance this month</div>
                <div className="mt-1 text-3xl font-extrabold">{pct(d.attendance.pct)}</div>
                <div className="mt-2">
                  <Progress value={d.attendance.pct ?? 0} tone={(d.attendance.pct ?? 100) < 75 ? 'bad' : 'good'} />
                </div>
                <div className="mt-1.5 text-xs text-navy-400">
                  {d.attendance.present}/{d.attendance.total} days{d.attendance.today ? ` · today: ${d.attendance.today}` : ''}
                </div>
              </Card>
            </Link>
            <Link to="/family/progress">
              <Card className="h-full p-4">
                <div className="text-xs font-semibold text-navy-400">Overall grade</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold">{d.grade?.grade ?? '—'}</span>
                  <span className="text-sm text-navy-400">{pct(d.grade?.pct)}</span>
                </div>
                {d.lastTest && (
                  <div className="mt-2 text-xs text-navy-400">
                    Last test: <b className="text-navy-700">{pct(d.lastTest.student_pct)}</b> vs class {pct(d.lastTest.class_avg)}
                  </div>
                )}
              </Card>
            </Link>
            <Link to="/family/homework">
              <Card className="h-full p-4">
                <div className="text-xs font-semibold text-navy-400">Homework due</div>
                <div className="mt-1 text-3xl font-extrabold">{d.homework.pending}</div>
                <div className="mt-1.5 text-xs text-navy-400">{d.homework.items.length} upcoming in the diary</div>
              </Card>
            </Link>
            <Link to="/family/fees">
              <Card className={clsx('h-full p-4', Number(d.fees.overdue) > 0 && 'border-red-200')}>
                <div className="text-xs font-semibold text-navy-400">Fees due</div>
                <div className={clsx('mt-1 text-3xl font-extrabold', Number(d.fees.balance) > 0 ? 'text-navy-800' : 'text-good')}>{Number(d.fees.balance) > 0 ? rupees(d.fees.balance) : 'Paid'}</div>
                <div className="mt-1.5 text-xs text-navy-400">{d.fees.next_due ? `Next due ${fmtDate(d.fees.next_due)}` : 'Nothing due'}</div>
              </Card>
            </Link>
          </div>

          {(d.strongest || d.focus) && (
            <Card className="flex gap-3 p-4">
              {d.strongest && (
                <div className="flex-1">
                  <div className="flex items-center gap-1 text-xs font-semibold text-good"><Trophy className="size-3.5" /> Strongest</div>
                  <div className="font-bold">{d.strongest.subject}</div>
                </div>
              )}
              {d.focus && (
                <div className="flex-1">
                  <div className="text-xs font-semibold text-warn">Needs focus</div>
                  <div className="font-bold">{d.focus.subject}</div>
                </div>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Homework diary" action={<Link to="/family/homework" className="text-xs font-semibold text-navy-500">See all</Link>} />
            <HomeworkList items={d.homework.items.slice(0, 4)} studentId={child.id} />
          </Card>

          <Card>
            <CardHeader title="Upcoming events" action={<Link to="/family/events" className="text-xs font-semibold text-navy-500">All events</Link>} />
            {d.events.length ? (
              <ul className="divide-y divide-navy-50 pb-2">
                {d.events.map((e: any) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                    <DateChip iso={e.starts_at} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{e.title}</div>
                      <div className="text-xs text-navy-400">{fmtTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No upcoming events" />
            )}
          </Card>
        </div>
      )}
    </Async>
  );
}

function DateChip({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-gold-soft leading-none">
      <span className="text-[10px] font-bold uppercase text-navy-500">{d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</span>
      <span className="text-lg font-extrabold">{d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</span>
    </div>
  );
}

// ── Homework diary ──────────────────────────────────────────────────────────
function HomeworkList({ items, studentId }: { items: any[]; studentId: string }) {
  const toggle = useAction((v: { id: string; done: boolean }) => api.put(`/homework/${v.id}/done`, { student_id: studentId, done: v.done }), ['/homework', '/dashboard/family']);
  if (!items.length) return <Empty title="No homework right now" icon={<BookOpen className="size-8" />} />;
  return (
    <ul className="divide-y divide-navy-50 pb-2">
      {items.map((h) => (
        <li key={h.id} className="flex items-start gap-3 px-5 py-3">
          <button
            onClick={() => toggle.mutate({ id: h.id, done: !h.done_at })}
            className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition', h.done_at ? 'border-good bg-good text-white' : 'border-navy-200 text-transparent hover:border-navy-400')}
            aria-label={h.done_at ? 'Mark as not done' : 'Mark as done'}
          >
            <Check className="size-4" strokeWidth={3} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-brand-red">{h.subject}</span>
              <Badge tone={h.due_on < todayISO() ? 'bad' : h.due_on === todayISO() ? 'warn' : 'neutral'}>Due {relDays(h.due_on)}</Badge>
            </div>
            <div className={clsx('text-sm font-semibold', h.done_at && 'text-navy-300 line-through')}>{h.title}</div>
            {h.details && <div className="text-xs text-navy-400">{h.details}</div>}
            {h.file_url && (
              <button onClick={() => openFile(h.file_url.replace('/api', ''))} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-navy-600 hover:underline">
                <FileText className="size-3.5" /> Open worksheet
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function FamilyHomework() {
  const child = useChild();
  const q = useApi(`/homework?student_id=${child.id}`);
  const [tab, setTab] = useState<'due' | 'past'>('due');
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Homework diary</h1>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'due', label: 'Upcoming' }, { value: 'past', label: 'Past 2 weeks' }]} />
      <Async q={q}>
        {(rows: any[]) => {
          const t = todayISO();
          const list = rows.filter((h) => (tab === 'due' ? h.due_on >= t : h.due_on < t));
          const byDay = new Map<string, any[]>();
          for (const h of list.sort((a, b) => (tab === 'due' ? a.due_on.localeCompare(b.due_on) : b.due_on.localeCompare(a.due_on)))) byDay.set(h.due_on, [...(byDay.get(h.due_on) ?? []), h]);
          if (!list.length) return <Card><Empty title={tab === 'due' ? 'Nothing due — well done!' : 'No past homework'} /></Card>;
          return (
            <div className="space-y-3">
              {[...byDay].map(([day, items]) => (
                <Card key={day}>
                  <CardHeader title={`Due ${fmtDateLong(day)}`} subtitle={relDays(day)} />
                  <HomeworkList items={items} studentId={child.id} />
                </Card>
              ))}
            </div>
          );
        }}
      </Async>
    </div>
  );
}

// ── Performance analytics ───────────────────────────────────────────────────
export function FamilyProgress() {
  const child = useChild();
  const q = useApi(`/academics/students/${child.id}/performance`);
  const sheets = useApi(`/answer-sheets?student_id=${child.id}`);
  const toast = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Performance</h1>
      <Async q={q}>
        {(p: any) => (
          <>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-navy-400">Weekly test trend</div>
                  <div className="text-sm font-bold">{child.full_name.split(' ')[0]} vs class average</div>
                </div>
                {p.overall && <Badge tone={gradeTone(p.overall.grade)}>Overall {p.overall.grade}</Badge>}
              </div>
              {p.trend.length ? (
                <div className="mt-3 h-52">
                  <ResponsiveContainer>
                    <AreaChart data={p.trend.map((t: any) => ({ ...t, label: fmtDate(t.exam_date) }))} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFB81C" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#FFB81C" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#E2E6EF" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5B6478' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#5B6478' }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => `${v}%`} labelFormatter={(_, pl) => pl?.[0]?.payload?.name ?? ''} />
                      <Area type="monotone" dataKey="student_pct" name={child.full_name.split(' ')[0]} stroke="#14213D" strokeWidth={2.5} fill="url(#g1)" />
                      <Line type="monotone" dataKey="class_avg" name="Class avg" stroke="#94A0BD" strokeDasharray="5 4" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty title="No published tests yet" />
              )}
            </Card>

            <Card>
              <CardHeader title="Subject grades" subtitle="All published tests this year" />
              <ul className="divide-y divide-navy-50 pb-2">
                {p.subjects.map((s: any) => (
                  <li key={s.subject_id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="w-28 shrink-0 text-sm font-semibold">{s.subject}</div>
                    <div className="flex-1">
                      <Progress value={s.pct ?? 0} tone={s.pct >= 60 ? 'navy' : s.pct >= 40 ? 'gold' : 'bad'} />
                      <div className="mt-0.5 text-[11px] text-navy-400">Class average {pct(s.class_avg)}</div>
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{pct(s.pct)}</div>
                    <Badge tone={gradeTone(s.grade)} className="w-9 justify-center">{s.grade}</Badge>
                  </li>
                ))}
              </ul>
              {(p.strongest || p.focus) && (
                <div className="mx-5 mb-4 grid grid-cols-2 gap-2 text-sm">
                  {p.strongest && <div className="rounded-xl bg-green-50 p-3"><div className="text-xs font-semibold text-good">Strength</div><b>{p.strongest.subject}</b></div>}
                  {p.focus && <div className="rounded-xl bg-amber-50 p-3"><div className="text-xs font-semibold text-warn">Focus area</div><b>{p.focus.subject}</b></div>}
                </div>
              )}
            </Card>
          </>
        )}
      </Async>

      <Card className="p-4">
        <div className="text-sm font-bold">Report card</div>
        <p className="text-xs text-navy-400">Marks, attendance and the class teacher’s remark. Also sent on WhatsApp on the 1st of every month.</p>
        <div className="mt-3 flex gap-2">
          <input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="h-10 flex-1 rounded-xl border border-navy-200 px-3 text-sm" />
          <Button onClick={() => download(`/academics/students/${child.id}/report-card.pdf?month=${month}`).catch((e) => toast(e.message, 'bad'))}>
            <Download className="size-4" /> Download
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Checked answer sheets" subtitle="With the teacher’s ticks, marks and comments" />
        <Async q={sheets}>
          {(rows: any[]) =>
            rows.length ? (
              <ul className="divide-y divide-navy-50 pb-2">
                {rows.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <FileCheck2 className="size-5 shrink-0 text-good" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{a.subject} · {a.exam}</div>
                      <div className="text-xs text-navy-400">{a.marks != null ? `${a.marks}/${a.max_marks} · ` : ''}{a.comments}</div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => openFile(a.file_url.replace('/api', ''))}>Open</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No checked answer sheets yet" />
            )
          }
        </Async>
      </Card>
    </div>
  );
}

// ── Attendance heat map ─────────────────────────────────────────────────────
const STATUS_COLOURS: Record<string, string> = {
  present: 'bg-good text-white',
  late: 'bg-amber-400 text-navy-800',
  absent: 'bg-bad text-white',
  leave: 'bg-sky-400 text-white',
  holiday: 'bg-navy-100 text-navy-400',
};

export function FamilyAttendance() {
  const child = useChild();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const q = useApi(`/attendance/student/${child.id}?month=${month}`);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const shift = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Attendance</h1>
      <Async q={q}>
        {(a: any) => {
          const days = new Map<string, any>(a.days.map((d: any) => [d.day, d]));
          const hol = new Map<string, string>(a.holidays.map((h: any) => [h.day, h.name]));
          const first = new Date(`${month}-01T00:00:00Z`);
          const lead = (first.getUTCDay() + 6) % 7; // Monday first
          const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
          const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
          const reasons = a.days.filter((d: any) => d.status !== 'present');
          return (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ['This month', pct(a.summary.pct)],
                  ['Absent', a.summary.absent],
                  ['Late', a.summary.late],
                  ['Leave', a.summary.leave],
                ].map(([l, v]) => (
                  <Card key={l} className="px-1 py-3">
                    <div className="text-lg font-extrabold">{v}</div>
                    <div className="text-[10px] font-semibold text-navy-400">{l}</div>
                  </Card>
                ))}
              </div>
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <button onClick={() => shift(-1)} className="rounded-lg p-1.5 hover:bg-navy-50" aria-label="Previous month"><ChevronLeft className="size-5" /></button>
                  <div className="font-bold">{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
                  <button onClick={() => shift(1)} disabled={month >= todayISO().slice(0, 7)} className="rounded-lg p-1.5 hover:bg-navy-50 disabled:opacity-30" aria-label="Next month"><ChevronRight className="size-5" /></button>
                </div>
                <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-navy-300">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
                  {cells.map((iso, i) => {
                    if (!iso) return <div key={i} />;
                    const rec = days.get(iso);
                    const status = rec?.status ?? (hol.has(iso) ? 'holiday' : null);
                    return (
                      <button
                        key={iso}
                        disabled={!rec || rec.status === 'present'}
                        onClick={() => setReasonFor(iso)}
                        title={hol.get(iso) ?? rec?.status ?? ''}
                        className={clsx('flex aspect-square items-center justify-center rounded-lg text-xs font-bold', status ? STATUS_COLOURS[status] : 'bg-navy-50 text-navy-300', iso === todayISO() && 'ring-2 ring-navy-800 ring-offset-1')}
                      >
                        {Number(iso.slice(8))}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-3 text-[11px] font-semibold text-navy-500">
                  {Object.entries(STATUS_COLOURS).map(([k, c]) => (
                    <span key={k} className="flex items-center gap-1.5"><span className={clsx('size-3 rounded', c)} />{k}</span>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Absences & reasons" subtitle="Tap a red day on the calendar to add a reason" />
                {reasons.length ? (
                  <ul className="divide-y divide-navy-50 pb-2">
                    {reasons.map((d: any) => (
                      <li key={d.day} className="flex items-center gap-3 px-5 py-2.5">
                        <Badge tone={d.status === 'absent' ? 'bad' : d.status === 'late' ? 'warn' : 'info'}>{d.status}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{fmtDateLong(d.day)}</div>
                          <div className="truncate text-xs text-navy-400">{d.parent_reason ?? 'No reason added'}</div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setReasonFor(d.day)}>{d.parent_reason ? 'Edit' : 'Add reason'}</Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="Full attendance this month 🎉" />
                )}
              </Card>
              <Card>
                <CardHeader title="Month by month" />
                <div className="flex items-end gap-2 overflow-x-auto px-5 pb-4">
                  {a.months.map((m: any) => (
                    <div key={m.month} className="flex w-10 shrink-0 flex-col items-center gap-1">
                      <div className="text-[10px] font-bold">{pct(m.pct)}</div>
                      <div className="flex h-20 w-6 items-end overflow-hidden rounded-md bg-navy-50">
                        <div className={clsx('w-full rounded-md', Number(m.pct) < 75 ? 'bg-bad' : 'bg-navy-800')} style={{ height: `${m.pct}%` }} />
                      </div>
                      <div className="text-[10px] text-navy-400">{new Date(`${m.month}-01`).toLocaleDateString('en-IN', { month: 'short' })}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <ReasonModal studentId={child.id} day={reasonFor} current={reasonFor ? days.get(reasonFor)?.parent_reason : ''} onClose={() => setReasonFor(null)} />
            </>
          );
        }}
      </Async>
    </div>
  );
}

function ReasonModal({ studentId, day, current, onClose }: { studentId: string; day: string | null; current?: string; onClose: () => void }) {
  const toast = useToast();
  const save = useAction((v: { date: string; reason: string }) => api.put(`/attendance/student/${studentId}/reason`, v), ['/attendance/student']);
  return (
    <Modal open={!!day} onClose={onClose} title={`Reason · ${fmtDateLong(day)}`}>
      <form
        key={day}
        onSubmit={async (e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get('reason') ?? '');
          await save.mutateAsync({ date: day!, reason });
          toast('Reason sent to the class teacher');
          onClose();
        }}
        className="space-y-3"
      >
        <Field label="Why was your child away?">
          <Textarea name="reason" rows={3} maxLength={500} required defaultValue={current ?? ''} placeholder="e.g. Fever – visited the doctor" />
        </Field>
        <ErrorBox error={save.error} />
        <Button type="submit" className="w-full" loading={save.isPending}>Save reason</Button>
      </form>
    </Modal>
  );
}

// ── Library ─────────────────────────────────────────────────────────────────
export function FamilyLibrary() {
  const child = useChild();
  const [kind, setKind] = useState<'textbook' | 'worksheet' | 'paper'>('textbook');
  const q = useApi(`/library?kind=${kind}&class_id=${child.class_id}&student_id=${child.id}`);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const submit = useAction(async (v: { id: string; file: File }) => {
    const f = new FormData();
    f.append('student_id', child.id);
    f.append('file', v.file);
    return api.post(`/library/${v.id}/submit`, f);
  }, ['/library']);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Library</h1>
      <Tabs value={kind} onChange={setKind} options={[{ value: 'textbook', label: 'Textbooks' }, { value: 'worksheet', label: 'Worksheets' }, { value: 'paper', label: 'Previous papers' }]} />
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !target) return;
          try {
            await submit.mutateAsync({ id: target, file });
            toast('Answer uploaded');
          } catch (err: any) {
            toast(err.message, 'bad');
          }
        }}
      />
      <Async q={q}>
        {(rows: any[]) =>
          rows.length ? (
            <div className="grid gap-3">
              {rows.map((it) => (
                <Card key={it.id} className="flex items-center gap-3 p-4">
                  <div className={clsx('flex size-11 shrink-0 items-center justify-center rounded-xl', kind === 'textbook' ? 'bg-navy-800 text-brand-gold' : kind === 'worksheet' ? 'bg-brand-gold-soft text-navy-800' : 'bg-navy-50 text-navy-600')}>
                    {kind === 'textbook' ? <BookOpen className="size-5" /> : <FileText className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-brand-red">{it.subject}</div>
                    <div className="truncate text-sm font-semibold">{it.title}</div>
                    <div className="text-xs text-navy-400">
                      {kind === 'paper' && `${it.exam_name ?? ''} ${it.year ?? ''}`}
                      {kind === 'worksheet' && (it.submitted_at ? `Submitted ${fmtDate(it.submitted_at)}` : it.due_on ? `Due ${fmtDate(it.due_on)}` : '')}
                      {kind === 'textbook' && it.uploaded_by}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => openFile(`/files/${it.file_id}`).catch((e) => toast(e.message, 'bad'))}>
                      <ExternalLink className="size-3.5" /> Open
                    </Button>
                    {kind === 'textbook' && (
                      <Button size="sm" variant="ghost" onClick={() => download(`/files/${it.file_id}`)}>
                        <Download className="size-3.5" /> Save
                      </Button>
                    )}
                    {kind === 'paper' && it.answer_key_file_id && (
                      <Button size="sm" variant="ghost" onClick={() => openFile(`/files/${it.answer_key_file_id}`)}>Answer key</Button>
                    )}
                    {kind === 'worksheet' && (
                      <Button size="sm" variant={it.submitted_at ? 'ghost' : 'gold'} loading={submit.isPending && target === it.id} onClick={() => { setTarget(it.id); fileRef.current?.click(); }}>
                        <Upload className="size-3.5" /> {it.submitted_at ? 'Re-upload' : 'Upload answer'}
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card><Empty title="Nothing here yet" /></Card>
          )
        }
      </Async>
    </div>
  );
}

// ── Events, notices, notifications ──────────────────────────────────────────
const EVENT_TONE: Record<string, string> = { exam: 'bad', meeting: 'info', sports: 'good', holiday: 'neutral', celebration: 'gold', exhibition: 'gold', other: 'neutral' };

export function EventsList() {
  const [past, setPast] = useState<'upcoming' | 'past'>('upcoming');
  const q = useApi(`/events${past === 'past' ? '?past=1' : ''}`);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Events</h1>
      <Tabs value={past} onChange={setPast} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
      <Async q={q}>
        {(rows: any[]) =>
          rows.length ? (
            <div className="space-y-3">
              {rows.map((e) => (
                <Card key={e.id} className="flex gap-3 p-4">
                  <DateChip iso={e.starts_at} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{e.title}</span>
                      <Badge tone={EVENT_TONE[e.kind]}>{e.kind}</Badge>
                      {e.class_name && <Badge>{e.class_name}</Badge>}
                    </div>
                    <div className="text-xs text-navy-400">{fmtDateTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</div>
                    {e.description && <p className="mt-1 text-sm text-navy-600">{e.description}</p>}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card><Empty title="No events" icon={<CalendarDays className="size-8" />} /></Card>
          )
        }
      </Async>
    </div>
  );
}

export function NoticesList() {
  const q = useApi('/notices');
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Notices</h1>
      <Async q={q}>
        {(rows: any[]) =>
          rows.length ? (
            <div className="space-y-3">
              {rows.map((n) => (
                <Card key={n.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{n.title}</span>
                    {n.priority !== 'normal' && <Badge tone={n.priority === 'urgent' ? 'bad' : 'gold'}>{n.priority}</Badge>}
                    {n.class_name && <Badge>{n.class_name}</Badge>}
                  </div>
                  <div className="text-xs text-navy-400">{fmtDateTime(n.created_at)}</div>
                  <p className="mt-2 text-sm whitespace-pre-line text-navy-600">{n.body}</p>
                </Card>
              ))}
            </div>
          ) : (
            <Card><Empty title="No notices" /></Card>
          )
        }
      </Async>
    </div>
  );
}

export function Notifications() {
  const q = useApi('/notifications');
  const read = useAction(() => api.post('/notifications/read'), ['/notifications']);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Notifications</h1>
        <Button size="sm" variant="secondary" onClick={() => read.mutate(undefined)} loading={read.isPending}>Mark all read</Button>
      </div>
      <Async q={q}>
        {(d: any) =>
          d.rows.length ? (
            <Card>
              <ul className="divide-y divide-navy-50">
                {d.rows.map((n: any) => (
                  <li key={n.id} className={clsx('px-5 py-3', !n.read_at && 'bg-brand-gold-soft/40')}>
                    <Link to={n.link ?? '#'} className="block">
                      <div className="flex items-center gap-2">
                        {!n.read_at && <span className="size-2 rounded-full bg-brand-red" />}
                        <span className="text-sm font-semibold">{n.title}</span>
                      </div>
                      {n.body && <div className="text-xs text-navy-500">{n.body}</div>}
                      <div className="mt-0.5 text-[11px] text-navy-300">{n.student_name ? `${n.student_name} · ` : ''}{fmtDateTime(n.created_at)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card><Empty title="You're all caught up" /></Card>
          )
        }
      </Async>
    </div>
  );
}

export function FamilyMore() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">More</h1>
      <Card>
        <ul className="divide-y divide-navy-50">
          {familyMoreLinks.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="flex items-center gap-3 px-5 py-3.5 text-sm font-semibold hover:bg-navy-50">
                <span className="text-navy-400">{l.icon}</span>
                {l.label}
                <ChevronRight className="ml-auto size-4 text-navy-300" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ── Fees ────────────────────────────────────────────────────────────────────
declare global {
  interface Window {
    Razorpay?: new (opts: any) => { open: () => void; on: (e: string, cb: (r: any) => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

export function FamilyFees() {
  const child = useChild();
  const { me } = useAuth();
  const q = useApi(`/fees/students/${child.id}`);
  const toast = useToast();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [mockOrder, setMockOrder] = useState<any>(null);
  const pay = useAction((ids: string[]) => api.post('/fees/online/orders', { student_id: child.id, fee_item_ids: ids }), []);
  const verify = useAction((v: any) => api.post('/fees/online/verify', v), ['/fees', '/dashboard/family', '/notifications']);

  const startPayment = async (ids: string[]) => {
    try {
      const order = await pay.mutateAsync(ids);
      if (order.provider === 'mock') return setMockOrder(order);
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount_paise,
        currency: 'INR',
        name: order.school,
        description: `Fees · ${child.full_name}`,
        prefill: { name: order.user.name, contact: order.user.phone },
        theme: { color: '#14213D' },
        handler: async (r: any) => {
          const res = await verify.mutateAsync({ order_id: r.razorpay_order_id, payment_id: r.razorpay_payment_id, signature: r.razorpay_signature });
          toast(`Payment received · receipt ${res.receipt_no}`);
        },
      });
      rz.on('payment.failed', () => toast('Payment failed. No money was taken.', 'bad'));
      rz.open();
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Fees</h1>
      <Async q={q}>
        {(d: any) => {
          const due = d.items.filter((i: any) => i.balance > 0);
          const sel = selected ?? due.map((i: any) => i.id);
          const selTotal = due.filter((i: any) => sel.includes(i.id)).reduce((a: number, i: any) => a + Number(i.balance), 0);
          return (
            <>
              <Card className="overflow-hidden">
                <div className="bg-navy-800 p-5 text-white">
                  <div className="text-xs font-semibold text-navy-200">Total due</div>
                  <div className="text-3xl font-extrabold">{rupees(d.totals.balance)}</div>
                  <div className="mt-1 text-xs text-navy-200">Paid this year {rupees(d.totals.paid)} of {rupees(d.totals.amount)}</div>
                </div>
                {due.length > 0 && (
                  <div className="p-4">
                    <ul className="space-y-2">
                      {due.map((i: any) => (
                        <li key={i.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-navy-100 p-3">
                            <input
                              type="checkbox"
                              checked={sel.includes(i.id)}
                              onChange={(e) => setSelected(e.target.checked ? [...sel, i.id] : sel.filter((x: string) => x !== i.id))}
                              className="size-4 accent-navy-800"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold">{i.term} · {i.title}</div>
                              <div className="text-xs text-navy-400">Due {fmtDate(i.due_on)} {i.status === 'overdue' && <Badge tone="bad">overdue</Badge>} {i.paid > 0 && `· ${rupees(i.paid)} paid`}</div>
                            </div>
                            <div className="font-bold">{rupees(i.balance)}</div>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <Button variant="gold" size="lg" className="mt-3 w-full" disabled={!sel.length} loading={pay.isPending} onClick={() => startPayment(sel)}>
                      <Lock className="size-4" /> Pay {rupees(selTotal)} securely
                    </Button>
                    <p className="mt-2 text-center text-[11px] text-navy-400">UPI, cards and net banking. The receipt appears here and on WhatsApp.</p>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="All fee items" />
                <ul className="divide-y divide-navy-50 pb-2">
                  {d.items.map((i: any) => (
                    <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{i.term} · {i.title}</div>
                        <div className="text-xs text-navy-400">Due {fmtDate(i.due_on)}</div>
                      </div>
                      <Badge tone={{ paid: 'good', part_paid: 'gold', overdue: 'bad', due: 'neutral' }[i.status as string]}>{i.status.replace('_', ' ')}</Badge>
                      <div className="w-20 text-right font-semibold">{rupees(i.amount)}</div>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Receipts" />
                {d.payments.length ? (
                  <ul className="divide-y divide-navy-50 pb-2">
                    {d.payments.map((p: any) => (
                      <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                        <IndianRupee className="size-4 text-good" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{rupees(p.amount)} · {p.method.toUpperCase()}</div>
                          <div className="text-xs text-navy-400">{p.receipt_no} · {fmtDate(p.paid_at)}</div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => download(`/fees/payments/${p.id}/receipt.pdf`)}>
                          <Download className="size-3.5" /> PDF
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="No payments yet" />
                )}
              </Card>
            </>
          );
        }}
      </Async>

      {/* Development-only payment simulator */}
      <Modal open={!!mockOrder} onClose={() => setMockOrder(null)} title="Test payment (development)">
        <p className="text-sm text-navy-600">
          The payment gateway is in <b>mock</b> mode, so no real money moves. Set <code>PAYMENT_PROVIDER=razorpay</code> with your keys to take live payments.
        </p>
        <div className="my-4 rounded-xl bg-navy-50 p-4 text-center text-2xl font-extrabold">{rupees(mockOrder?.amount)}</div>
        <Button
          className="w-full"
          variant="gold"
          loading={verify.isPending}
          onClick={async () => {
            const r = await verify.mutateAsync({ order_id: mockOrder.order_id });
            setMockOrder(null);
            setSelected(null);
            toast(`Payment received · receipt ${r.receipt_no}`);
          }}
        >
          Simulate successful payment
        </Button>
        {me?.payments.provider === 'mock' && <p className="mt-2 text-center text-[11px] text-navy-400">This button does not exist in production.</p>}
      </Modal>
    </div>
  );
}

