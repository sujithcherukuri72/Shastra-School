import clsx from 'clsx';
import { CalendarCheck, CheckCircle2, ClipboardList, FileUp, NotebookPen, Plus, Send, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, openFile, useAction, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { fmtDate, fmtDateLong, gradeTone, relDays, todayISO } from '../lib/format.ts';
import { Async, Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui.tsx';

// ── Home ────────────────────────────────────────────────────────────────────
export function TeacherHome() {
  const { me } = useAuth();
  const q = useApi('/dashboard/teacher');
  return (
    <div>
      <PageHeader eyebrow={fmtDateLong(todayISO())} title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${me!.user.full_name.split(' ')[0]}`} subtitle="Three quick jobs: attendance, marks and the homework diary." />
      <Async q={q}>
        {(d: any) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Today’s attendance" icon={<CalendarCheck className="size-5" />} subtitle="As class teacher" />
              {d.classes.length ? (
                <ul className="divide-y divide-navy-50 pb-2">
                  {d.classes.map((c: any) => (
                    <li key={c.section_id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1">
                        <div className="font-semibold">{c.class_name} – {c.section_name}</div>
                        <div className="text-xs text-navy-400">{c.students} students{Number(c.marked) > 0 && ` · ${c.absent} absent`}</div>
                      </div>
                      {Number(c.marked) > 0 ? <Badge tone="good"><CheckCircle2 className="size-3" /> Done</Badge> : <Badge tone="warn">Not marked</Badge>}
                      <Link to={`/teacher/attendance/${c.section_id}`}><Button size="sm" variant={Number(c.marked) > 0 ? 'secondary' : 'primary'}>{Number(c.marked) > 0 ? 'Edit' : 'Mark now'}</Button></Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="You are not a class teacher" />
              )}
            </Card>
            <Card>
              <CardHeader title="Tests" icon={<ClipboardList className="size-5" />} subtitle="Recent and upcoming for your classes" action={<Link to="/teacher/marks" className="text-xs font-semibold text-navy-500">Enter marks</Link>} />
              {d.exams.length ? (
                <ul className="divide-y divide-navy-50 pb-2">
                  {d.exams.slice(0, 6).map((e: any) => (
                    <li key={e.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <div>
                        <div className="font-semibold">{e.class_name} · {e.name}</div>
                        <div className="text-xs text-navy-400">{fmtDate(e.exam_date)} · out of {e.max_marks}</div>
                      </div>
                      {e.published_at ? <Badge tone="good">Published</Badge> : <Badge>Draft</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No tests yet" />
              )}
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="My homework posts" icon={<NotebookPen className="size-5" />} action={<Link to="/teacher/homework"><Button size="sm"><Plus className="size-4" /> Post homework</Button></Link>} />
              {d.homework.length ? (
                <ul className="divide-y divide-navy-50 pb-2">
                  {d.homework.map((h: any) => (
                    <li key={h.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <Badge tone="gold">{h.subject}</Badge>
                      <div className="min-w-0 flex-1 truncate font-semibold">{h.title}</div>
                      <div className="hidden text-xs text-navy-400 sm:block">{h.class_name}-{h.section_name}</div>
                      <div className="text-xs text-navy-400">{h.done}/{h.students} done</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No homework posted yet" />
              )}
            </Card>
          </div>
        )}
      </Async>
    </div>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────
type Status = 'present' | 'absent' | 'late' | 'leave';
const NEXT: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'leave', leave: 'present' };
const LETTER: Record<Status, string> = { present: 'P', absent: 'A', late: 'L', leave: 'LV' };

export function TeacherAttendancePicker() {
  const { me } = useAuth();
  const mine = me?.classTeacherOf ?? [];
  if (mine.length === 1) return <TeacherAttendance sectionId={mine[0]!.section_id} />;
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Choose your class" />
      <Card>
        {mine.length ? (
          <ul className="divide-y divide-navy-50">
            {mine.map((s) => (
              <li key={s.section_id}>
                <Link to={`/teacher/attendance/${s.section_id}`} className="block px-5 py-3 font-semibold hover:bg-navy-50">{s.class_name} – {s.section_name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="You are not a class teacher">Only the class teacher marks attendance. Ask the Principal if this is wrong.</Empty>
        )}
      </Card>
    </div>
  );
}

export function TeacherAttendanceRoute() {
  const { sectionId } = useParams();
  return <TeacherAttendance sectionId={Number(sectionId)} />;
}

function TeacherAttendance({ sectionId }: { sectionId: number }) {
  const [date, setDate] = useState(todayISO());
  const q = useApi(`/attendance/section/${sectionId}?date=${date}`);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const toast = useToast();
  const save = useAction((body: any) => api.put(`/attendance/section/${sectionId}`, body), ['/attendance', '/dashboard']);

  useEffect(() => {
    if (q.data) setMarks(Object.fromEntries(q.data.students.map((s: any) => [s.id, s.status])));
  }, [q.data]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const v of Object.values(marks)) c[v]++;
    return c;
  }, [marks]);

  const submit = async () => {
    const by = (s: Status) => Object.entries(marks).filter(([, v]) => v === s).map(([k]) => k);
    try {
      const r = await save.mutateAsync({ date, absent: by('absent'), late: by('late'), leave: by('leave') });
      toast(r.alerted ? `Saved. WhatsApp alert sent to ${r.alerted} absent student${r.alerted > 1 ? 's' : ''}’ parents.` : 'Attendance saved');
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Async q={q}>
        {(d: any) => (
          <>
            <PageHeader
              eyebrow="Class teacher"
              title={`${d.section.class_name} – ${d.section.name}`}
              subtitle="Everyone starts as present. Tap a student to mark A (absent), L (late) or LV (leave)."
              actions={<Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="w-40" />}
            />
            {d.holiday && <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-warn">{fmtDateLong(date)} is a holiday: {d.holiday}</div>}
            <div className="mb-3 grid grid-cols-4 gap-2 text-center">
              {(['present', 'absent', 'late', 'leave'] as Status[]).map((s) => (
                <Card key={s} className="py-2">
                  <div className={clsx('text-xl font-extrabold', s === 'absent' && 'text-bad', s === 'present' && 'text-good')}>{counts[s]}</div>
                  <div className="text-[11px] font-semibold capitalize text-navy-400">{s}</div>
                </Card>
              ))}
            </div>
            <Card>
              <ul className="divide-y divide-navy-50">
                {d.students.map((s: any) => {
                  const st = marks[s.id] ?? 'present';
                  return (
                    <li key={s.id}>
                      <button onClick={() => setMarks((m) => ({ ...m, [s.id]: NEXT[st] }))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-navy-50">
                        <span className="w-7 text-xs font-bold text-navy-300">{s.roll_no}</span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold">{s.full_name}</span>
                          {s.parent_reason && <span className="block text-xs text-navy-400">Parent: {s.parent_reason}</span>}
                        </span>
                        <span
                          className={clsx(
                            'flex h-9 w-11 items-center justify-center rounded-xl text-sm font-extrabold',
                            st === 'present' && 'bg-green-50 text-good',
                            st === 'absent' && 'bg-bad text-white',
                            st === 'late' && 'bg-amber-400 text-navy-800',
                            st === 'leave' && 'bg-sky-500 text-white',
                          )}
                        >
                          {LETTER[st]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="sticky bottom-20 mt-4 lg:bottom-4">
              <Button size="lg" className="w-full shadow-lg" loading={save.isPending} onClick={submit}>
                <Send className="size-4" /> {d.submitted ? 'Update attendance' : 'Submit attendance'}
              </Button>
              <p className="mt-1 text-center text-[11px] text-navy-400">Parents of absent students get a WhatsApp alert straight away.</p>
            </div>
          </>
        )}
      </Async>
    </div>
  );
}

// ── Marks ───────────────────────────────────────────────────────────────────
export function TeacherMarks() {
  const { me } = useAuth();
  const teaches = me?.teaches ?? [];
  const [pick, setPick] = useState(teaches[0] ? `${teaches[0].section_id}:${teaches[0].subject_id}` : '');
  const [sectionId, subjectId] = pick.split(':').map(Number);
  const ta = teaches.find((t) => t.section_id === sectionId && t.subject_id === subjectId);
  const exams = useApi<any[]>(ta ? `/academics/exams?class_id=${ta.class_id}` : null);
  const [examId, setExamId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (exams.data?.length && !exams.data.some((e) => e.id === examId)) setExamId(exams.data[0].id);
  }, [exams.data, examId]);

  if (!teaches.length) return <Card><Empty title="No subjects assigned">Ask the Principal to assign your subjects.</Empty></Card>;
  const exam = exams.data?.find((e) => e.id === examId);
  const isCT = me?.classTeacherOf?.some((c) => c.class_id === ta?.class_id);

  return (
    <div>
      <PageHeader title="Marks" subtitle="Type the marks — grades are worked out automatically." actions={<Button variant="secondary" onClick={() => setNewOpen(true)}><Plus className="size-4" /> New test</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Class & subject">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            {teaches.map((t) => (
              <option key={`${t.section_id}:${t.subject_id}`} value={`${t.section_id}:${t.subject_id}`}>{t.class_name} – {t.section_name} · {t.subject_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Test">
          <Select value={examId ?? ''} onChange={(e) => setExamId(Number(e.target.value))}>
            {exams.data?.map((e) => (
              <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.exam_date)} · /{e.max_marks}{e.published_at ? ' · published' : ''}</option>
            ))}
          </Select>
        </Field>
      </div>
      {exam && ta && <MarksSheet key={`${exam.id}:${pick}`} exam={exam} sectionId={ta.section_id} subjectId={ta.subject_id} canPublish={!!isCT} />}
      {ta && <NewExamModal open={newOpen} onClose={() => setNewOpen(false)} classId={ta.class_id} className={ta.class_name} onCreated={(id) => setExamId(id)} />}
    </div>
  );
}

function MarksSheet({ exam, sectionId, subjectId, canPublish }: { exam: any; sectionId: number; subjectId: number; canPublish: boolean }) {
  const q = useApi(`/academics/marks/sheet?exam_id=${exam.id}&section_id=${sectionId}&subject_id=${subjectId}`);
  const [vals, setVals] = useState<Record<string, { marks: string; absent: boolean }>>({});
  const toast = useToast();
  const save = useAction((b: any) => api.put('/academics/marks/sheet', b), ['/academics']);
  const publish = useAction(() => api.post(`/academics/exams/${exam.id}/publish`), ['/academics', '/dashboard']);

  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.rows.map((r: any) => [r.student_id, { marks: r.marks == null ? '' : String(r.marks), absent: !!r.is_absent }])));
  }, [q.data]);

  const grade = (m: string) => {
    if (m === '' || Number.isNaN(Number(m))) return null;
    const p = (Number(m) / exam.max_marks) * 100;
    return p >= 91 ? 'A1' : p >= 81 ? 'A2' : p >= 71 ? 'B1' : p >= 61 ? 'B2' : p >= 51 ? 'C1' : p >= 41 ? 'C2' : p >= 33 ? 'D' : 'E';
  };

  const submit = async () => {
    const entries = Object.entries(vals).map(([student_id, v]) => ({ student_id, marks: v.absent || v.marks === '' ? null : Number(v.marks), is_absent: v.absent }));
    const bad = entries.find((e) => e.marks != null && (e.marks < 0 || e.marks > exam.max_marks));
    if (bad) return toast(`Marks must be between 0 and ${exam.max_marks}`, 'bad');
    try {
      const r = await save.mutateAsync({ exam_id: exam.id, section_id: sectionId, subject_id: subjectId, entries });
      toast(`Saved marks for ${r.saved} students`);
    } catch (e: any) {
      toast(e.message, 'bad');
    }
  };

  return (
    <Async q={q}>
      {(d: any) => (
        <Card>
          <CardHeader
            title={`${exam.name} · out of ${exam.max_marks}`}
            subtitle={exam.published_at ? 'Published — parents can see these marks' : 'Draft — parents see marks after publishing'}
            action={
              canPublish && !exam.published_at ? (
                <Button size="sm" variant="gold" loading={publish.isPending} onClick={() => publish.mutateAsync(undefined).then(() => toast('Results published to parents'))}>Publish results</Button>
              ) : undefined
            }
          />
          <ul className="divide-y divide-navy-50">
            {d.rows.map((r: any) => {
              const v = vals[r.student_id] ?? { marks: '', absent: false };
              const g = v.absent ? null : grade(v.marks);
              return (
                <li key={r.student_id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-7 text-xs font-bold text-navy-300">{r.roll_no}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.full_name}</span>
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-navy-400">
                    <input type="checkbox" checked={v.absent} onChange={(e) => setVals((x) => ({ ...x, [r.student_id]: { ...v, absent: e.target.checked } }))} className="accent-navy-800" /> Ab
                  </label>
                  <input
                    inputMode="decimal"
                    disabled={v.absent}
                    value={v.marks}
                    onChange={(e) => setVals((x) => ({ ...x, [r.student_id]: { ...v, marks: e.target.value.replace(/[^\d.]/g, '') } }))}
                    className={clsx('h-9 w-16 rounded-lg border text-center text-sm font-bold disabled:bg-navy-50', Number(v.marks) > exam.max_marks ? 'border-bad text-bad' : 'border-navy-200')}
                    aria-label={`Marks for ${r.full_name}`}
                  />
                  <Badge tone={gradeTone(g)} className="w-9 justify-center">{v.absent ? 'AB' : (g ?? '–')}</Badge>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-navy-100 p-4">
            <Button className="w-full" size="lg" loading={save.isPending} onClick={submit}>Save marks</Button>
          </div>
        </Card>
      )}
    </Async>
  );
}

function NewExamModal({ open, onClose, classId, className, onCreated }: { open: boolean; onClose: () => void; classId: number; className: string; onCreated: (id: number) => void }) {
  const create = useAction((b: any) => api.post('/academics/exams', b), ['/academics']);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await create.mutateAsync({ name: f.get('name'), kind: f.get('kind'), class_id: classId, exam_date: f.get('exam_date'), max_marks: Number(f.get('max_marks')) });
    onCreated(r.id);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`New test · ${className}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><Input name="name" required maxLength={100} placeholder="Weekly Test 8" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select name="kind" defaultValue="weekly_test">
              <option value="weekly_test">Weekly test</option>
              <option value="unit_test">Unit test</option>
              <option value="term_exam">Term exam</option>
            </Select>
          </Field>
          <Field label="Out of"><Input name="max_marks" type="number" min={1} max={1000} defaultValue={25} required /></Field>
        </div>
        <Field label="Date"><Input name="exam_date" type="date" defaultValue={todayISO()} required /></Field>
        <ErrorBox error={create.error} />
        <Button type="submit" className="w-full" loading={create.isPending}>Create test</Button>
      </form>
    </Modal>
  );
}

// ── Homework diary ──────────────────────────────────────────────────────────
export function TeacherHomework() {
  const { me } = useAuth();
  const teaches = me?.teaches ?? [];
  const q = useApi('/homework');
  const toast = useToast();
  const post = useAction((f: FormData) => api.post('/homework', f), ['/homework', '/dashboard']);
  const del = useAction((id: string) => api.del(`/homework/${id}`), ['/homework', '/dashboard']);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const [section, subject] = String(f.get('pick')).split(':');
    f.delete('pick');
    f.set('section_id', section!);
    f.set('subject_id', subject!);
    if (!(f.get('file') as File)?.size) f.delete('file');
    try {
      await post.mutateAsync(f);
      form.reset();
      toast('Homework posted to the parents’ diary');
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div>
        <PageHeader title="Homework diary" subtitle="Appears in every parent’s app the moment you post it." />
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Class & subject">
              <Select name="pick" required>
                {teaches.map((t) => (
                  <option key={`${t.section_id}:${t.subject_id}`} value={`${t.section_id}:${t.subject_id}`}>{t.class_name} – {t.section_name} · {t.subject_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Homework"><Input name="title" required maxLength={200} placeholder="Exercise 6.2, questions 1–10" /></Field>
            <Field label="Details (optional)"><Textarea name="details" rows={3} maxLength={4000} /></Field>
            <Field label="Due on"><Input name="due_on" type="date" required min={todayISO()} defaultValue={todayISO()} /></Field>
            <Field label="Worksheet (optional)" hint="PDF, Word, PNG or JPG · up to 15 MB">
              <Input name="file" type="file" accept=".pdf,.docx,image/png,image/jpeg,image/webp" className="py-2" />
            </Field>
            <Button type="submit" className="w-full" loading={post.isPending}><NotebookPen className="size-4" /> Post homework</Button>
          </form>
        </Card>
      </div>
      <Card>
        <CardHeader title="Recent posts" />
        <Async q={q}>
          {(rows: any[]) =>
            rows.length ? (
              <ul className="divide-y divide-navy-50">
                {rows.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="gold">{h.subject}</Badge>
                        <span className="text-xs text-navy-400">{h.class_name}-{h.section_name}</span>
                        <Badge tone={h.due_on < todayISO() ? 'neutral' : 'info'}>Due {relDays(h.due_on)}</Badge>
                      </div>
                      <div className="mt-1 text-sm font-semibold">{h.title}</div>
                      <div className="text-xs text-navy-400">{h.done_count} marked done{h.file_url && ' · '}{h.file_url && <button onClick={() => openFile(h.file_url.replace('/api', ''))} className="font-semibold hover:underline">attachment</button>}</div>
                    </div>
                    <button onClick={() => confirm('Delete this homework?') && del.mutate(h.id)} className="rounded-lg p-1.5 text-navy-300 hover:bg-red-50 hover:text-bad" aria-label="Delete">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing posted yet" />
            )
          }
        </Async>
      </Card>
    </div>
  );
}

// ── Uploads: library + checked answer sheets ────────────────────────────────
export function TeacherLibrary() {
  const { me } = useAuth();
  const [tab, setTab] = useState<'library' | 'sheets'>('library');
  const classes = useMemo(() => {
    const m = new Map<string, { class_id: number; class_name: string; subject_id: number; subject_name: string }>();
    for (const t of me?.teaches ?? []) m.set(`${t.class_id}:${t.subject_id}`, t);
    return [...m.values()];
  }, [me]);
  return (
    <div>
      <PageHeader title="Uploads" subtitle="Textbooks, worksheets, previous papers with answer keys, and checked answer sheets." />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} options={[{ value: 'library', label: 'Library' }, { value: 'sheets', label: 'Checked answer sheets' }]} /></div>
      {tab === 'library' ? <LibraryUpload classes={classes} /> : <AnswerSheetUpload />}
    </div>
  );
}

function LibraryUpload({ classes }: { classes: { class_id: number; class_name: string; subject_id: number; subject_name: string }[] }) {
  const [kind, setKind] = useState<'textbook' | 'worksheet' | 'paper'>('worksheet');
  const [pick, setPick] = useState(classes[0] ? `${classes[0].class_id}:${classes[0].subject_id}` : '');
  const [classId] = pick.split(':').map(Number);
  const list = useApi(classId ? `/library?class_id=${classId}` : null);
  const toast = useToast();
  const up = useAction((f: FormData) => api.post('/library', f), ['/library']);
  const del = useAction((id: string) => api.del(`/library/${id}`), ['/library']);
  const [subsFor, setSubsFor] = useState<any>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const [c, s] = pick.split(':');
    f.set('class_id', c!);
    f.set('subject_id', s!);
    f.set('kind', kind);
    for (const k of ['answer_key', 'year', 'exam_name', 'due_on']) {
      const v = f.get(k);
      if (v === '' || (v instanceof File && !v.size)) f.delete(k);
    }
    try {
      await up.mutateAsync(f);
      form.reset();
      toast('Uploaded to the Library');
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <Tabs value={kind} onChange={setKind} options={[{ value: 'worksheet', label: 'Worksheet' }, { value: 'paper', label: 'Paper' }, { value: 'textbook', label: 'Textbook' }]} />
          <Field label="Class & subject">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              {classes.map((c) => <option key={`${c.class_id}:${c.subject_id}`} value={`${c.class_id}:${c.subject_id}`}>{c.class_name} · {c.subject_name}</option>)}
            </Select>
          </Field>
          <Field label="Title"><Input name="title" required maxLength={200} /></Field>
          {kind === 'paper' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Exam"><Input name="exam_name" placeholder="Annual exam" /></Field>
              <Field label="Year"><Input name="year" type="number" min={2000} max={2100} /></Field>
            </div>
          )}
          {kind === 'worksheet' && <Field label="Due on (optional)"><Input name="due_on" type="date" /></Field>}
          <Field label="File" hint="PDF, Word or image · up to 15 MB"><Input name="file" type="file" required accept=".pdf,.docx,image/png,image/jpeg,image/webp" className="py-2" /></Field>
          {kind === 'paper' && <Field label="Answer key (optional)"><Input name="answer_key" type="file" accept=".pdf,.docx,image/png,image/jpeg,image/webp" className="py-2" /></Field>}
          <Button type="submit" className="w-full" loading={up.isPending}><FileUp className="size-4" /> Upload</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="In the Library for this class" />
        <Async q={list}>
          {(rows: any[]) =>
            rows.length ? (
              <ul className="divide-y divide-navy-50">
                {rows.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Badge tone={it.kind === 'worksheet' ? 'gold' : it.kind === 'paper' ? 'info' : 'navy'}>{it.kind}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{it.title}</div>
                      <div className="text-xs text-navy-400">{it.subject}{it.year ? ` · ${it.year}` : ''}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => openFile(`/files/${it.file_id}`)}>Open</Button>
                    {it.kind === 'worksheet' && <Button size="sm" variant="ghost" onClick={() => setSubsFor(it)}><Users className="size-3.5" /></Button>}
                    <button onClick={() => confirm('Delete this item?') && del.mutate(it.id)} className="rounded-lg p-1.5 text-navy-300 hover:text-bad" aria-label="Delete"><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nothing uploaded yet" />
            )
          }
        </Async>
      </Card>
      <Modal open={!!subsFor} onClose={() => setSubsFor(null)} title={`Submissions · ${subsFor?.title ?? ''}`}>
        {subsFor && <Submissions id={subsFor.id} />}
      </Modal>
    </div>
  );
}

function Submissions({ id }: { id: string }) {
  const q = useApi(`/library/${id}/submissions`);
  return (
    <Async q={q}>
      {(rows: any[]) =>
        rows.length ? (
          <ul className="divide-y divide-navy-50">
            {rows.map((s) => (
              <li key={s.student_id} className="flex items-center justify-between py-2 text-sm">
                <span>{s.section_name} · {s.roll_no}. {s.full_name}</span>
                <Button size="sm" variant="secondary" onClick={() => openFile(s.file_url.replace('/api', ''))}>Open</Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No submissions yet" />
        )
      }
    </Async>
  );
}

function AnswerSheetUpload() {
  const { me } = useAuth();
  const teaches = me?.teaches ?? [];
  const [pick, setPick] = useState(teaches[0] ? `${teaches[0].section_id}:${teaches[0].subject_id}` : '');
  const [sectionId, subjectId] = pick.split(':').map(Number);
  const ta = teaches.find((t) => t.section_id === sectionId && t.subject_id === subjectId);
  const exams = useApi<any[]>(ta ? `/academics/exams?class_id=${ta.class_id}` : null);
  const [examId, setExamId] = useState<number | null>(null);
  const sheet = useApi(examId && ta ? `/academics/marks/sheet?exam_id=${examId}&section_id=${sectionId}&subject_id=${subjectId}` : null);
  const toast = useToast();
  const up = useAction((f: FormData) => api.post('/answer-sheets', f), ['/answer-sheets']);

  useEffect(() => {
    if (exams.data?.length && !examId) setExamId(exams.data[0].id);
  }, [exams.data, examId]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    f.set('exam_id', String(examId));
    f.set('subject_id', String(subjectId));
    if (!f.get('comments')) f.delete('comments');
    try {
      await up.mutateAsync(f);
      form.reset();
      toast('Answer sheet shared with the family');
    } catch (err: any) {
      toast(err.message, 'bad');
    }
  };

  return (
    <Card className="max-w-xl p-5">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Class & subject">
          <Select value={pick} onChange={(e) => { setPick(e.target.value); setExamId(null); }}>
            {teaches.map((t) => <option key={`${t.section_id}:${t.subject_id}`} value={`${t.section_id}:${t.subject_id}`}>{t.class_name} – {t.section_name} · {t.subject_name}</option>)}
          </Select>
        </Field>
        <Field label="Exam">
          <Select value={examId ?? ''} onChange={(e) => setExamId(Number(e.target.value))}>
            {exams.data?.map((e) => <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.exam_date)}</option>)}
          </Select>
        </Field>
        <Field label="Student">
          <Select name="student_id" required>
            {sheet.data?.rows.map((r: any) => <option key={r.student_id} value={r.student_id}>{r.roll_no}. {r.full_name}{r.marks != null ? ` (${r.marks})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Scanned answer sheet" hint="PDF or photo · up to 15 MB"><Input name="file" type="file" required accept=".pdf,image/png,image/jpeg,image/webp" className="py-2" /></Field>
        <Field label="Comment for the student (optional)"><Textarea name="comments" rows={2} maxLength={1000} /></Field>
        <Button type="submit" className="w-full" loading={up.isPending}><FileUp className="size-4" /> Share with family</Button>
        <p className="text-center text-[11px] text-navy-400">Families see answer sheets only after the results are published.</p>
      </form>
    </Card>
  );
}
