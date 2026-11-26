import { Router } from 'express';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.ts';
import { badRequest, id, isoDate, notFound, optText, parse, phoneE164, text, uuid } from '../lib/http.ts';
import { audit } from '../security/audit.ts';
import { requireRole } from '../security/middleware.ts';
import { hashPassword, strongPassword } from '../security/password.ts';
import { destroyAllSessions } from '../security/sessions.ts';

const r = Router();
const principal = requireRole('principal');
const staff = requireRole('principal', 'office', 'teacher');

/** Reference data every staff screen needs. */
r.get('/meta', staff, async (_req, res) => {
  const [classes, sections, subjects, years] = await Promise.all([
    q('SELECT id, name, grade, sort_order FROM classes ORDER BY sort_order, grade'),
    q(`SELECT sec.id, sec.class_id, sec.name, sec.class_teacher_id, u.full_name AS class_teacher,
              (SELECT COUNT(*) FROM students s WHERE s.section_id = sec.id AND s.status = 'active') AS students
         FROM sections sec LEFT JOIN users u ON u.id = sec.class_teacher_id ORDER BY sec.class_id, sec.name`),
    q('SELECT id, name, code FROM subjects ORDER BY name'),
    q('SELECT id, name, starts_on, ends_on, is_current FROM academic_years ORDER BY starts_on DESC'),
  ]);
  res.json({ classes, sections, subjects, years });
});

// ── Staff accounts (principal only) ─────────────────────────────────────────
r.get('/staff', requireRole('principal', 'office'), async (_req, res) => {
  res.json(
    await q(`SELECT u.id, u.role, u.full_name, u.email, u.phone, u.dob, u.is_active, u.last_login_at,
                    (SELECT json_agg(json_build_object('section_id', ta.section_id, 'subject_id', ta.subject_id)) FROM teaching_assignments ta WHERE ta.teacher_id = u.id) AS teaches,
                    (SELECT json_agg(sec.id) FROM sections sec WHERE sec.class_teacher_id = u.id) AS class_teacher_of
               FROM users u WHERE u.role IN ('principal','office','teacher') ORDER BY u.role, u.full_name`),
  );
});

const staffBody = z.strictObject({
  role: z.enum(['principal', 'office', 'teacher']),
  full_name: text(150),
  email: z.email().max(200).transform((v) => v.toLowerCase()),
  phone: phoneE164.optional().nullable(),
  dob: isoDate.optional().nullable(),
  password: strongPassword,
});

r.post('/staff', principal, async (req, res) => {
  const b = parse(staffBody, req.body);
  const u = await q1(
    `INSERT INTO users (role, full_name, email, phone, dob, password_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [b.role, b.full_name, b.email, b.phone ?? null, b.dob ?? null, await hashPassword(b.password)],
  );
  await audit(req, 'staff.created', 'user', u!.id, { role: b.role });
  res.status(201).json(u);
});

r.patch('/staff/:id', principal, async (req, res) => {
  const userId = parse(uuid, req.params.id);
  const b = parse(
    z.strictObject({
      full_name: text(150).optional(),
      email: z.email().max(200).transform((v) => v.toLowerCase()).optional(),
      phone: phoneE164.optional().nullable(),
      dob: isoDate.optional().nullable(),
      is_active: z.boolean().optional(),
      password: strongPassword.optional(),
    }),
    req.body,
  );
  if (userId === req.auth!.user.id && b.is_active === false) throw badRequest('You cannot deactivate your own account');
  const row = await q1(
    `UPDATE users SET full_name = COALESCE($2, full_name), email = COALESCE($3, email),
            phone = CASE WHEN $4::boolean THEN $5 ELSE phone END, dob = CASE WHEN $6::boolean THEN $7::date ELSE dob END,
            is_active = COALESCE($8, is_active), password_hash = COALESCE($9, password_hash),
            failed_logins = 0, locked_until = NULL, updated_at = now()
      WHERE id = $1 AND role IN ('principal','office','teacher') RETURNING id, is_active`,
    [userId, b.full_name ?? null, b.email ?? null, 'phone' in b, b.phone ?? null, 'dob' in b, b.dob ?? null, b.is_active ?? null, b.password ? await hashPassword(b.password) : null],
  );
  if (!row) throw notFound('Staff member not found');
  if (b.is_active === false || b.password) await destroyAllSessions(userId);
  await audit(req, 'staff.updated', 'user', userId, { fields: Object.keys(b).filter((k) => k !== 'password'), passwordReset: !!b.password });
  res.json({ ok: true });
});

// ── Classes, sections, subjects ─────────────────────────────────────────────
r.post('/classes', principal, async (req, res) => {
  const b = parse(z.strictObject({ name: text(50), grade: z.number().int().min(0).max(12), sections: z.array(text(10)).max(10).default(['A']) }), req.body);
  const out = await tx(async (db) => {
    const c = await q1('INSERT INTO classes (name, grade, sort_order) VALUES ($1,$2,$2) RETURNING id', [b.name, b.grade], db);
    for (const s of b.sections) await q('INSERT INTO sections (class_id, name) VALUES ($1,$2)', [c!.id, s.toUpperCase()], db);
    return c;
  });
  await audit(req, 'class.created', 'class', out!.id, b);
  res.status(201).json(out);
});

r.post('/sections', principal, async (req, res) => {
  const b = parse(z.strictObject({ class_id: id, name: text(10) }), req.body);
  res.status(201).json(await q1('INSERT INTO sections (class_id, name) VALUES ($1,$2) RETURNING id', [b.class_id, b.name.toUpperCase()]));
});

r.patch('/sections/:id', principal, async (req, res) => {
  const sectionId = parse(id, req.params.id);
  const b = parse(z.strictObject({ class_teacher_id: uuid.nullable() }), req.body);
  if (b.class_teacher_id) {
    const t = await q1(`SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND is_active`, [b.class_teacher_id]);
    if (!t) throw badRequest('Class teacher must be an active teacher');
  }
  const row = await q1('UPDATE sections SET class_teacher_id = $2 WHERE id = $1 RETURNING id', [sectionId, b.class_teacher_id]);
  if (!row) throw notFound();
  await audit(req, 'section.class_teacher', 'section', sectionId, b);
  res.json({ ok: true });
});

r.post('/subjects', principal, async (req, res) => {
  const b = parse(z.strictObject({ name: text(80), code: text(12).transform((v) => v.toUpperCase()) }), req.body);
  res.status(201).json(await q1('INSERT INTO subjects (name, code) VALUES ($1,$2) RETURNING id', [b.name, b.code]));
});

r.get('/teaching-assignments', staff, async (_req, res) => {
  res.json(
    await q(`SELECT ta.id, ta.teacher_id, u.full_name AS teacher, ta.section_id, sec.name AS section_name, c.name AS class_name,
                    ta.subject_id, sub.name AS subject_name
               FROM teaching_assignments ta JOIN users u ON u.id = ta.teacher_id JOIN sections sec ON sec.id = ta.section_id
               JOIN classes c ON c.id = sec.class_id JOIN subjects sub ON sub.id = ta.subject_id
              ORDER BY c.sort_order, sec.name, sub.name`),
  );
});

r.put('/teaching-assignments', principal, async (req, res) => {
  const b = parse(z.strictObject({ section_id: id, subject_id: id, teacher_id: uuid.nullable() }), req.body);
  if (b.teacher_id === null) {
    await q('DELETE FROM teaching_assignments WHERE section_id = $1 AND subject_id = $2', [b.section_id, b.subject_id]);
  } else {
    const t = await q1(`SELECT 1 FROM users WHERE id = $1 AND role = 'teacher' AND is_active`, [b.teacher_id]);
    if (!t) throw badRequest('Choose an active teacher');
    await q(
      `INSERT INTO teaching_assignments (teacher_id, section_id, subject_id) VALUES ($1,$2,$3)
       ON CONFLICT (section_id, subject_id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id`,
      [b.teacher_id, b.section_id, b.subject_id],
    );
  }
  await audit(req, 'teaching.assigned', 'section', b.section_id, b);
  res.json({ ok: true });
});

// ── Calendar ────────────────────────────────────────────────────────────────
r.get('/holidays', requireRole('principal', 'office', 'teacher', 'parent', 'student'), async (_req, res) => {
  res.json(await q(`SELECT day, name FROM holidays WHERE day >= CURRENT_DATE - interval '1 year' ORDER BY day`));
});

r.put('/holidays', principal, async (req, res) => {
  const b = parse(z.strictObject({ day: isoDate, name: optText(100) }), req.body);
  if (b.name) await q('INSERT INTO holidays (day, name) VALUES ($1,$2) ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name', [b.day, b.name]);
  else await q('DELETE FROM holidays WHERE day = $1', [b.day]);
  res.json({ ok: true });
});

r.get('/audit', principal, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(
    await q(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.meta, a.created_at, u.full_name AS actor, u.role AS actor_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    ),
  );
});

export default r;
