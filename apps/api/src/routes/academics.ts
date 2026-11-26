import { Router } from 'express';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.ts';
import { schoolToday } from '../lib/dates.ts';
import { badRequest, forbidden, id, isoDate, notFound, parse, text, uuid } from '../lib/http.ts';
import { assertCanTeach, assertCanTeachClass, assertStudentAccess, isClassTeacher } from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { requireRole } from '../security/middleware.ts';
import { gradeFor } from '../services/grades.ts';
import { notifyFamilies } from '../services/notify.ts';
import { reportCardPdf } from '../services/pdf.ts';
import { monthlyReport, performance } from '../services/performance.ts';

const r = Router();
const teachers = requireRole('principal', 'teacher');

// ── Exams ───────────────────────────────────────────────────────────────────
r.get('/exams', requireRole('principal', 'office', 'teacher'), async (req, res) => {
  const classId = parse(id.optional(), req.query.class_id);
  res.json(
    await q(
      `SELECT e.*, c.name AS class_name FROM exams e JOIN classes c ON c.id = e.class_id
        WHERE ($1::int IS NULL OR e.class_id = $1) ORDER BY e.exam_date DESC LIMIT 200`,
      [classId ?? null],
    ),
  );
});

r.post('/exams', teachers, async (req, res) => {
  const b = parse(
    z.strictObject({
      name: text(100),
      kind: z.enum(['weekly_test', 'unit_test', 'term_exam']),
      class_id: id,
      exam_date: isoDate,
      max_marks: z.number().positive().max(1000),
      subject_id: id.optional(),
    }),
    req.body,
  );
  if (req.auth!.user.role === 'teacher') {
    // Any teacher of the class may create a test for it.
    const ok = await q1(
      'SELECT 1 FROM teaching_assignments ta JOIN sections s ON s.id = ta.section_id WHERE s.class_id = $1 AND ta.teacher_id = $2',
      [b.class_id, req.auth!.user.id],
    );
    if (!ok) throw forbidden('You do not teach this class');
  }
  const e = await q1(
    `INSERT INTO exams (name, kind, class_id, exam_date, max_marks, academic_year_id, created_by)
     VALUES ($1,$2,$3,$4,$5,(SELECT id FROM academic_years WHERE is_current),$6) RETURNING *`,
    [b.name, b.kind, b.class_id, b.exam_date, b.max_marks, req.auth!.user.id],
  );
  await audit(req, 'exam.created', 'exam', e!.id, b);
  res.status(201).json(e);
});

r.post('/exams/:id/publish', teachers, async (req, res) => {
  const examId = parse(id, req.params.id);
  const e = await q1('SELECT * FROM exams WHERE id = $1', [examId]);
  if (!e) throw notFound('Exam not found');
  if (req.auth!.user.role === 'teacher') {
    const ok = await q1(
      'SELECT 1 FROM sections WHERE class_id = $1 AND class_teacher_id = $2',
      [e.class_id, req.auth!.user.id],
    );
    if (!ok) throw forbidden('Only a class teacher of this class or the Principal can publish results');
  }
  await tx(async (db) => {
    await q('UPDATE exams SET published_at = COALESCE(published_at, now()) WHERE id = $1', [examId], db);
    const studs = await q('SELECT DISTINCT student_id FROM marks WHERE exam_id = $1', [examId], db);
    await notifyFamilies(studs.map((s) => s.student_id), { kind: 'marks', title: `Results published · ${e.name}`, body: 'See the marks and progress chart.', link: '/family/progress' }, db);
  });
  await audit(req, 'exam.published', 'exam', examId);
  res.json({ ok: true });
});

// ── Marks entry (subject teacher) ───────────────────────────────────────────
r.get('/marks/sheet', teachers, async (req, res) => {
  const f = parse(z.object({ exam_id: id, section_id: id, subject_id: id }), req.query);
  await assertCanTeach(req.auth!, f.section_id, f.subject_id);
  const exam = await q1(
    'SELECT e.* FROM exams e JOIN sections s ON s.class_id = e.class_id WHERE e.id = $1 AND s.id = $2',
    [f.exam_id, f.section_id],
  );
  if (!exam) throw notFound('This exam is not for this section');
  const rows = await q(
    `SELECT s.id AS student_id, s.full_name, s.roll_no, m.marks, m.is_absent, m.remark
       FROM students s LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = $1 AND m.subject_id = $3
      WHERE s.section_id = $2 AND s.status = 'active' ORDER BY s.roll_no NULLS LAST, s.full_name`,
    [f.exam_id, f.section_id, f.subject_id],
  );
  res.json({
    exam,
    rows: rows.map((r) => ({ ...r, grade: r.marks == null ? null : gradeFor((r.marks / exam.max_marks) * 100) })),
  });
});

r.put('/marks/sheet', teachers, async (req, res) => {
  const b = parse(
    z.strictObject({
      exam_id: id,
      section_id: id,
      subject_id: id,
      entries: z
        .array(
          z.strictObject({
            student_id: uuid,
            marks: z.number().min(0).nullable(),
            is_absent: z.boolean().default(false),
            remark: z.string().trim().max(300).optional().nullable(),
          }),
        )
        .max(200),
    }),
    req.body,
  );
  await assertCanTeach(req.auth!, b.section_id, b.subject_id);
  const saved = await tx(async (db) => {
    const exam = await q1('SELECT e.* FROM exams e JOIN sections s ON s.class_id = e.class_id WHERE e.id = $1 AND s.id = $2', [b.exam_id, b.section_id], db);
    if (!exam) throw notFound('This exam is not for this section');
    const ids = new Set((await q(`SELECT id FROM students WHERE section_id = $1 AND status = 'active'`, [b.section_id], db)).map((s) => s.id));
    let n = 0;
    for (const e of b.entries) {
      if (!ids.has(e.student_id)) throw badRequest('A student in the list is not in this section');
      if (e.marks == null && !e.is_absent) {
        await q('DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3', [b.exam_id, e.student_id, b.subject_id], db);
        continue;
      }
      if (e.marks != null && e.marks > exam.max_marks) throw badRequest(`Marks cannot be more than ${exam.max_marks}`);
      await q(
        `INSERT INTO marks (exam_id, student_id, subject_id, marks, is_absent, remark, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (exam_id, student_id, subject_id) DO UPDATE SET marks = EXCLUDED.marks, is_absent = EXCLUDED.is_absent,
           remark = EXCLUDED.remark, entered_by = EXCLUDED.entered_by, updated_at = now()`,
        [b.exam_id, e.student_id, b.subject_id, e.is_absent ? null : e.marks, e.is_absent, e.remark ?? null, req.auth!.user.id],
        db,
      );
      n++;
    }
    return n;
  });
  await audit(req, 'marks.saved', 'exam', b.exam_id, { section_id: b.section_id, subject_id: b.subject_id, count: saved });
  res.json({ saved });
});

// ── Report-card remark (class teacher) ──────────────────────────────────────
r.put('/report-remarks', teachers, async (req, res) => {
  const b = parse(z.strictObject({ student_id: uuid, month: z.string().regex(/^\d{4}-\d{2}$/), remark: text(500) }), req.body);
  const st = await q1('SELECT section_id FROM students WHERE id = $1', [b.student_id]);
  if (!st) throw notFound('Student not found');
  if (req.auth!.user.role === 'teacher' && !(st.section_id && (await isClassTeacher(req.auth!, st.section_id)))) {
    throw forbidden('Only the class teacher can write the report remark');
  }
  await q(
    `INSERT INTO report_remarks (student_id, month, remark, written_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (student_id, month) DO UPDATE SET remark = EXCLUDED.remark, written_by = EXCLUDED.written_by, updated_at = now()`,
    [b.student_id, `${b.month}-01`, b.remark, req.auth!.user.id],
  );
  res.json({ ok: true });
});

// ── Analytics for one student ───────────────────────────────────────────────
r.get('/students/:id/performance', async (req, res) => {
  const sid = parse(uuid, req.params.id);
  await assertStudentAccess(req.auth!, sid);
  res.json(await performance(sid));
});

r.get('/students/:id/report-card.pdf', async (req, res) => {
  const sid = parse(uuid, req.params.id);
  await assertStudentAccess(req.auth!, sid);
  const month = parse(z.string().regex(/^\d{4}-\d{2}$/).optional(), req.query.month) ?? schoolToday().slice(0, 7);
  const report = await monthlyReport(sid, `${month}-01`);
  const pdf = await reportCardPdf(report);
  const safeName = (report.student?.full_name ?? 'student').replace(/[^\w]+/g, '-');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="report-card-${safeName}-${month}.pdf"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(pdf);
});

// ── Class-by-subject heat map (Principal) ───────────────────────────────────
r.get('/heatmap', requireRole('principal'), async (req, res) => {
  const days = parse(z.coerce.number().int().min(7).max(365).default(60), req.query.days);
  res.json(
    await q(
      `SELECT c.id AS class_id, c.name AS class_name, sub.id AS subject_id, sub.name AS subject,
              ROUND(AVG(m.marks / e.max_marks * 100), 1) AS avg_pct, COUNT(DISTINCT m.student_id) AS students
         FROM marks m JOIN exams e ON e.id = m.exam_id JOIN classes c ON c.id = e.class_id JOIN subjects sub ON sub.id = m.subject_id
        WHERE NOT m.is_absent AND e.exam_date >= CURRENT_DATE - ($1 || ' days')::interval
        GROUP BY c.id, c.name, c.sort_order, sub.id, sub.name ORDER BY c.sort_order, sub.name`,
      [String(days)],
    ),
  );
});

export default r;
