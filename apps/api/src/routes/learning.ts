import { Router } from 'express';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.ts';
import { readStoredFile, saveUpload, upload } from '../lib/files.ts';
import { fmtDate } from '../lib/dates.ts';
import { badRequest, forbidden, id, isoDate, notFound, optText, parse, text, uuid } from '../lib/http.ts';
import {
  assertCanTeach,
  assertCanTeachClass,
  assertFamilyOf,
  assertStudentAccess,
  familyClassIds,
  isLeadership,
  visibleStudentIds,
} from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { limits, requireRole } from '../security/middleware.ts';
import type { AuthCtx } from '../security/sessions.ts';
import { notifyFamilies } from '../services/notify.ts';

const r = Router();
const teachers = requireRole('principal', 'teacher');
const families = requireRole('parent', 'student');

const fileUrl = (fid: string | null | undefined) => (fid ? `/api/files/${fid}` : null);

// ── Homework diary ──────────────────────────────────────────────────────────
r.get('/homework', async (req, res) => {
  const a = req.auth!;
  const f = parse(
    z.object({ student_id: uuid.optional(), section_id: id.optional(), from: isoDate.optional(), to: isoDate.optional() }),
    req.query,
  );
  let sectionId: number | null = null;
  let studentId: string | null = null;
  if (f.student_id) {
    const st = await assertStudentAccess(a, f.student_id);
    sectionId = st.section_id;
    studentId = f.student_id;
  } else if (f.section_id && (a.user.role === 'teacher' || isLeadership(a))) {
    if (a.user.role === 'teacher') {
      const ok = await q1(
        'SELECT 1 FROM sections WHERE id = $1 AND class_teacher_id = $2 UNION SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND teacher_id = $2',
        [f.section_id, a.user.id],
      );
      if (!ok) throw forbidden();
    }
    sectionId = f.section_id;
  } else if (a.user.role === 'teacher') {
    sectionId = null; // teacher's own homework across sections
  } else {
    throw badRequest('Choose a child');
  }
  const rows = await q(
    `SELECT h.id, h.title, h.details, h.due_on, h.created_at, h.file_id, h.section_id,
            sub.name AS subject, sub.id AS subject_id, u.full_name AS teacher, c.name AS class_name, sec.name AS section_name,
            ${studentId ? '(SELECT done_at FROM homework_done d WHERE d.homework_id = h.id AND d.student_id = $5)' : 'NULL'} AS done_at,
            (SELECT COUNT(*) FROM homework_done d WHERE d.homework_id = h.id) AS done_count
       FROM homework h JOIN subjects sub ON sub.id = h.subject_id JOIN sections sec ON sec.id = h.section_id
       JOIN classes c ON c.id = sec.class_id LEFT JOIN users u ON u.id = h.teacher_id
      WHERE ($1::int IS NULL OR h.section_id = $1)
        AND ($2::uuid IS NULL OR h.teacher_id = $2)
        AND h.due_on BETWEEN COALESCE($3::date, CURRENT_DATE - 14) AND COALESCE($4::date, CURRENT_DATE + 30)
      ORDER BY h.due_on DESC, sub.name LIMIT 300`,
    [sectionId, sectionId === null && a.user.role === 'teacher' ? a.user.id : null, f.from ?? null, f.to ?? null, ...(studentId ? [studentId] : [])],
  );
  res.json(rows.map((h) => ({ ...h, file_url: fileUrl(h.file_id) })));
});

r.post('/homework', teachers, limits.upload, upload.single('file'), async (req, res) => {
  const b = parse(
    z.strictObject({ section_id: id, subject_id: id, title: text(200), details: optText(4000), due_on: isoDate }),
    req.body,
  );
  await assertCanTeach(req.auth!, b.section_id, b.subject_id);
  const hw = await tx(async (db) => {
    const file = req.file ? await saveUpload(req.file, req.auth!.user.id, db) : null;
    const row = await q1(
      `INSERT INTO homework (section_id, subject_id, teacher_id, title, details, due_on, file_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.section_id, b.subject_id, req.auth!.user.id, b.title, b.details, b.due_on, file?.id ?? null],
      db,
    );
    const sub = await q1('SELECT name FROM subjects WHERE id = $1', [b.subject_id], db);
    const studs = await q(`SELECT id FROM students WHERE section_id = $1 AND status = 'active'`, [b.section_id], db);
    await notifyFamilies(studs.map((s) => s.id), { kind: 'homework', title: `${sub?.name} homework · due ${fmtDate(b.due_on)}`, body: b.title, link: '/family/homework' }, db);
    return row!;
  });
  await audit(req, 'homework.created', 'homework', hw.id);
  res.status(201).json(hw);
});

r.delete('/homework/:id', teachers, async (req, res) => {
  const hid = parse(uuid, req.params.id);
  const hw = await q1('SELECT section_id, subject_id FROM homework WHERE id = $1', [hid]);
  if (!hw) throw notFound();
  await assertCanTeach(req.auth!, hw.section_id, hw.subject_id);
  await q('DELETE FROM homework WHERE id = $1', [hid]);
  res.json({ ok: true });
});

r.put('/homework/:id/done', families, async (req, res) => {
  const hid = parse(uuid, req.params.id);
  const b = parse(z.strictObject({ student_id: uuid, done: z.boolean() }), req.body);
  await assertFamilyOf(req.auth!, b.student_id);
  const hw = await q1('SELECT h.id FROM homework h JOIN students s ON s.section_id = h.section_id WHERE h.id = $1 AND s.id = $2', [hid, b.student_id]);
  if (!hw) throw notFound();
  if (b.done) await q('INSERT INTO homework_done (homework_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [hid, b.student_id]);
  else await q('DELETE FROM homework_done WHERE homework_id = $1 AND student_id = $2', [hid, b.student_id]);
  res.json({ ok: true });
});

// ── Library: textbooks, worksheets, previous papers ─────────────────────────
r.get('/library', async (req, res) => {
  const a = req.auth!;
  const f = parse(z.object({ kind: z.enum(['textbook', 'worksheet', 'paper']).optional(), class_id: id.optional(), student_id: uuid.optional() }), req.query);
  let classIds: number[] | null = null;
  if (a.user.role === 'parent' || a.user.role === 'student') {
    classIds = await familyClassIds(a);
    if (f.class_id && !classIds.includes(f.class_id)) throw forbidden();
    if (f.class_id) classIds = [f.class_id];
  } else if (f.class_id) classIds = [f.class_id];

  if (f.student_id) await assertStudentAccess(a, f.student_id);
  const rows = await q(
    `SELECT li.id, li.kind, li.title, li.exam_name, li.year, li.due_on, li.created_at, li.file_id, li.answer_key_file_id,
            li.class_id, c.name AS class_name, sub.id AS subject_id, sub.name AS subject, u.full_name AS uploaded_by,
            ${f.student_id ? '(SELECT submitted_at FROM worksheet_submissions ws WHERE ws.item_id = li.id AND ws.student_id = $3)' : 'NULL'} AS submitted_at
       FROM library_items li JOIN classes c ON c.id = li.class_id JOIN subjects sub ON sub.id = li.subject_id
       LEFT JOIN users u ON u.id = li.uploaded_by
      WHERE ($1::text IS NULL OR li.kind = $1) AND ($2::int[] IS NULL OR li.class_id = ANY($2))
      ORDER BY li.kind, sub.name, li.year DESC NULLS LAST, li.created_at DESC LIMIT 500`,
    [f.kind ?? null, classIds, ...(f.student_id ? [f.student_id] : [])],
  );
  res.json(rows.map((x) => ({ ...x, file_url: fileUrl(x.file_id), answer_key_url: fileUrl(x.answer_key_file_id) })));
});

r.post(
  '/library',
  teachers,
  limits.upload,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'answer_key', maxCount: 1 },
  ]),
  async (req, res) => {
    const b = parse(
      z.strictObject({
        kind: z.enum(['textbook', 'worksheet', 'paper']),
        class_id: id,
        subject_id: id,
        title: text(200),
        exam_name: optText(100),
        year: z.coerce.number().int().min(2000).max(2100).optional().nullable(),
        due_on: isoDate.optional().nullable(),
      }),
      req.body,
    );
    await assertCanTeachClass(req.auth!, b.class_id, b.subject_id);
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const item = await tx(async (db) => {
      const main = await saveUpload(files?.file?.[0], req.auth!.user.id, db);
      const key = files?.answer_key?.[0] ? await saveUpload(files.answer_key[0], req.auth!.user.id, db) : null;
      const row = await q1(
        `INSERT INTO library_items (kind, class_id, subject_id, title, exam_name, year, due_on, file_id, answer_key_file_id, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [b.kind, b.class_id, b.subject_id, b.title, b.exam_name, b.year ?? null, b.due_on ?? null, main.id, key?.id ?? null, req.auth!.user.id],
        db,
      );
      if (b.kind === 'worksheet') {
        const studs = await q(`SELECT s.id FROM students s JOIN sections sec ON sec.id = s.section_id WHERE sec.class_id = $1 AND s.status = 'active'`, [b.class_id], db);
        await notifyFamilies(studs.map((s) => s.id), { kind: 'worksheet', title: 'New worksheet', body: b.title, link: '/family/library' }, db);
      }
      return row!;
    });
    await audit(req, 'library.uploaded', 'library_item', item.id, { kind: b.kind });
    res.status(201).json(item);
  },
);

r.delete('/library/:id', teachers, async (req, res) => {
  const lid = parse(uuid, req.params.id);
  const it = await q1('SELECT class_id, subject_id FROM library_items WHERE id = $1', [lid]);
  if (!it) throw notFound();
  await assertCanTeachClass(req.auth!, it.class_id, it.subject_id);
  await q('DELETE FROM library_items WHERE id = $1', [lid]);
  res.json({ ok: true });
});

/** Student uploads their answer to a worksheet. */
r.post('/library/:id/submit', families, limits.upload, upload.single('file'), async (req, res) => {
  const lid = parse(uuid, req.params.id);
  const b = parse(z.strictObject({ student_id: uuid }), req.body);
  await assertFamilyOf(req.auth!, b.student_id);
  const it = await q1(
    `SELECT li.id FROM library_items li JOIN sections sec ON sec.class_id = li.class_id JOIN students s ON s.section_id = sec.id
      WHERE li.id = $1 AND li.kind = 'worksheet' AND s.id = $2`,
    [lid, b.student_id],
  );
  if (!it) throw notFound('Worksheet not found for this child');
  await tx(async (db) => {
    const f = await saveUpload(req.file, req.auth!.user.id, db);
    await q(
      `INSERT INTO worksheet_submissions (item_id, student_id, file_id) VALUES ($1,$2,$3)
       ON CONFLICT (item_id, student_id) DO UPDATE SET file_id = EXCLUDED.file_id, submitted_at = now()`,
      [lid, b.student_id, f.id],
      db,
    );
  });
  res.status(201).json({ ok: true });
});

r.get('/library/:id/submissions', teachers, async (req, res) => {
  const lid = parse(uuid, req.params.id);
  const it = await q1('SELECT class_id, subject_id FROM library_items WHERE id = $1', [lid]);
  if (!it) throw notFound();
  await assertCanTeachClass(req.auth!, it.class_id, it.subject_id);
  const rows = await q(
    `SELECT ws.student_id, s.full_name, s.roll_no, sec.name AS section_name, ws.submitted_at, ws.file_id
       FROM worksheet_submissions ws JOIN students s ON s.id = ws.student_id LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE ws.item_id = $1 ORDER BY sec.name, s.roll_no`,
    [lid],
  );
  res.json(rows.map((x) => ({ ...x, file_url: fileUrl(x.file_id) })));
});

// ── Checked answer sheets ───────────────────────────────────────────────────
r.get('/answer-sheets', async (req, res) => {
  const sid = parse(uuid, req.query.student_id);
  await assertStudentAccess(req.auth!, sid);
  const rows = await q(
    `SELECT a.id, a.comments, a.created_at, a.file_id, e.name AS exam, e.exam_date, e.max_marks, sub.name AS subject,
            m.marks, u.full_name AS checked_by
       FROM answer_sheets a JOIN exams e ON e.id = a.exam_id JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN marks m ON m.exam_id = a.exam_id AND m.student_id = a.student_id AND m.subject_id = a.subject_id
       LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.student_id = $1 AND (e.published_at IS NOT NULL OR $2)
      ORDER BY e.exam_date DESC, sub.name`,
    [sid, req.auth!.user.role !== 'parent' && req.auth!.user.role !== 'student'],
  );
  res.json(rows.map((x) => ({ ...x, file_url: fileUrl(x.file_id) })));
});

r.post('/answer-sheets', teachers, limits.upload, upload.single('file'), async (req, res) => {
  const b = parse(z.strictObject({ exam_id: id, student_id: uuid, subject_id: id, comments: optText(1000) }), req.body);
  const st = await q1(
    `SELECT s.section_id FROM students s JOIN sections sec ON sec.id = s.section_id JOIN exams e ON e.class_id = sec.class_id
      WHERE s.id = $1 AND e.id = $2`,
    [b.student_id, b.exam_id],
  );
  if (!st) throw badRequest('This student did not sit this exam');
  await assertCanTeach(req.auth!, st.section_id, b.subject_id);
  const row = await tx(async (db) => {
    const f = await saveUpload(req.file, req.auth!.user.id, db);
    return q1(
      `INSERT INTO answer_sheets (exam_id, student_id, subject_id, file_id, comments, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (exam_id, student_id, subject_id) DO UPDATE SET file_id = EXCLUDED.file_id, comments = EXCLUDED.comments, uploaded_by = EXCLUDED.uploaded_by
       RETURNING id`,
      [b.exam_id, b.student_id, b.subject_id, f.id, b.comments, req.auth!.user.id],
      db,
    );
  });
  res.status(201).json(row);
});

// ── Authorised file download ────────────────────────────────────────────────
async function canReadFile(a: AuthCtx, fileId: string): Promise<boolean> {
  if (isLeadership(a)) return true;
  const f = await q1('SELECT uploaded_by FROM files WHERE id = $1', [fileId]);
  if (!f) return false;
  if (f.uploaded_by === a.user.id) return true;
  const students = await visibleStudentIds(a);
  const classes = a.user.role === 'teacher' ? null : await familyClassIds(a);
  const ref = await q1(
    `SELECT 1 WHERE
       EXISTS (SELECT 1 FROM homework h JOIN students s ON s.section_id = h.section_id
                WHERE h.file_id = $1 AND s.id = ANY($2::uuid[]))
    OR EXISTS (SELECT 1 FROM library_items li WHERE (li.file_id = $1 OR li.answer_key_file_id = $1)
                AND ($3::int[] IS NULL OR li.class_id = ANY($3)))
    OR EXISTS (SELECT 1 FROM worksheet_submissions ws WHERE ws.file_id = $1 AND ws.student_id = ANY($2::uuid[]))
    OR EXISTS (SELECT 1 FROM answer_sheets an JOIN exams e ON e.id = an.exam_id
                WHERE an.file_id = $1 AND an.student_id = ANY($2::uuid[]) AND (e.published_at IS NOT NULL OR $4))`,
    [fileId, students ?? [], classes, a.user.role === 'teacher'],
  );
  return !!ref;
}

r.get('/files/:id', async (req, res) => {
  const fid = parse(uuid, req.params.id);
  if (!(await canReadFile(req.auth!, fid))) throw notFound('File not found');
  const f = await q1('SELECT storage_key, original_name, mime, size_bytes FROM files WHERE id = $1', [fid]);
  if (!f) throw notFound('File not found');
  const buf = await readStoredFile(f.storage_key);
  const inline = req.query.inline === '1' && (f.mime === 'application/pdf' || f.mime.startsWith('image/'));
  res.set({
    'Content-Type': f.mime,
    'Content-Length': String(buf.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    // Uploaded content can never run scripts in our origin.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'private, no-store',
  });
  res.send(buf);
});

export default r;
