import { Router } from 'express';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.ts';
import { badRequest, conflict, id, isoDate, notFound, optText, parse, phoneE164, text, uuid } from '../lib/http.ts';
import { assertStudentAccess, visibleStudentIds } from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { requireRole } from '../security/middleware.ts';
import { destroyAllSessions } from '../security/sessions.ts';

const r = Router();
const office = requireRole('principal', 'office');
const staff = requireRole('principal', 'office', 'teacher');

r.get('/', staff, async (req, res) => {
  const f = parse(
    z.object({
      section_id: id.optional(),
      class_id: id.optional(),
      search: z.string().trim().max(80).optional(),
      status: z.enum(['active', 'left']).default('active'),
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );
  const visible = await visibleStudentIds(req.auth!);
  const rows = await q(
    `SELECT s.id, s.admission_no, s.full_name, s.dob, s.gender, s.roll_no, s.status, s.section_id,
            sec.name AS section_name, c.id AS class_id, c.name AS class_name,
            (SELECT json_agg(json_build_object('name', u.full_name, 'phone', u.phone, 'relation', g.relation))
               FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.student_id = s.id) AS guardians,
            COUNT(*) OVER () AS total
       FROM students s
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE s.status = $1
        AND ($2::int IS NULL OR s.section_id = $2)
        AND ($3::int IS NULL OR c.id = $3)
        AND ($4::text IS NULL OR s.full_name ILIKE '%' || $4 || '%' OR s.admission_no ILIKE '%' || $4 || '%')
        AND ($5::uuid[] IS NULL OR s.id = ANY($5))
      ORDER BY c.sort_order, sec.name, s.roll_no NULLS LAST, s.full_name
      LIMIT $6 OFFSET $7`,
    [f.status, f.section_id ?? null, f.class_id ?? null, f.search?.replace(/[%_\\]/g, '\\$&') || null, visible, f.limit, f.offset],
  );
  res.json({ total: rows[0]?.total ?? 0, rows: rows.map(({ total: _t, ...x }) => x) });
});

r.get('/:id', async (req, res) => {
  const sid = parse(uuid, req.params.id);
  await assertStudentAccess(req.auth!, sid);
  const s = await q1(
    `SELECT s.*, sec.name AS section_name, c.id AS class_id, c.name AS class_name, ct.full_name AS class_teacher
       FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users ct ON ct.id = sec.class_teacher_id WHERE s.id = $1`,
    [sid],
  );
  const guardians = await q(
    `SELECT u.id, u.full_name, u.phone, u.email, g.relation, g.is_primary, g.whatsapp_opt_in
       FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.student_id = $1 ORDER BY g.is_primary DESC`,
    [sid],
  );
  // Families and teachers do not need other guardians' contact details beyond names.
  const role = req.auth!.user.role;
  const showContacts = role === 'principal' || role === 'office' || role === 'teacher';
  res.json({ ...s, guardians: showContacts ? guardians : guardians.map((g) => ({ full_name: g.full_name, relation: g.relation })) });
});

const guardianIn = z.strictObject({
  full_name: text(150),
  phone: phoneE164,
  relation: z.enum(['father', 'mother', 'guardian', 'parent']).default('parent'),
  is_primary: z.boolean().default(false),
  whatsapp_opt_in: z.boolean().default(true),
});

const studentIn = z.strictObject({
  admission_no: text(30),
  full_name: text(150),
  dob: isoDate.optional().nullable(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  blood_group: optText(5),
  address: optText(500),
  section_id: id.optional().nullable(),
  roll_no: z.number().int().positive().optional().nullable(),
  guardians: z.array(guardianIn).max(4).default([]),
});

/** Guardian accounts are matched by phone so siblings share one parent login. */
async function upsertGuardian(db: Parameters<Parameters<typeof tx>[0]>[0], studentId: string, g: z.infer<typeof guardianIn>) {
  let u = await q1('SELECT id, role FROM users WHERE phone = $1', [g.phone], db);
  if (u && u.role !== 'parent') throw conflict(`${g.phone} already belongs to a ${u.role} account`);
  if (!u) u = await q1(`INSERT INTO users (role, full_name, phone) VALUES ('parent', $1, $2) RETURNING id`, [g.full_name, g.phone], db);
  await q(
    `INSERT INTO guardians (student_id, user_id, relation, is_primary, whatsapp_opt_in) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (student_id, user_id) DO UPDATE SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary, whatsapp_opt_in = EXCLUDED.whatsapp_opt_in`,
    [studentId, u!.id, g.relation, g.is_primary, g.whatsapp_opt_in],
    db,
  );
}

r.post('/', office, async (req, res) => {
  const b = parse(studentIn, req.body);
  const s = await tx(async (db) => {
    const row = await q1(
      `INSERT INTO students (admission_no, full_name, dob, gender, blood_group, address, section_id, roll_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.admission_no, b.full_name, b.dob ?? null, b.gender ?? null, b.blood_group, b.address, b.section_id ?? null, b.roll_no ?? null],
      db,
    );
    for (const g of b.guardians) await upsertGuardian(db, row!.id, g);
    return row!;
  });
  await audit(req, 'student.created', 'student', s.id, { admission_no: b.admission_no });
  res.status(201).json(s);
});

r.patch('/:id', office, async (req, res) => {
  const sid = parse(uuid, req.params.id);
  const b = parse(studentIn.partial().extend({ status: z.enum(['active', 'left']).optional() }), req.body);
  await tx(async (db) => {
    const sets: string[] = [];
    const vals: unknown[] = [sid];
    const cols = ['admission_no', 'full_name', 'dob', 'gender', 'blood_group', 'address', 'section_id', 'roll_no', 'status'] as const;
    for (const c of cols) {
      if (c in b) {
        vals.push((b as any)[c] ?? null);
        sets.push(`${c} = $${vals.length}`); // column names come from the fixed list above
      }
    }
    if (sets.length) {
      const row = await q1(`UPDATE students SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, vals, db);
      if (!row) throw notFound('Student not found');
    }
    if (b.guardians) for (const g of b.guardians) await upsertGuardian(db, sid, g);
  });
  await audit(req, 'student.updated', 'student', sid, { fields: Object.keys(b) });
  res.json({ ok: true });
});

r.delete('/:id/guardians/:userId', office, async (req, res) => {
  const sid = parse(uuid, req.params.id);
  const uid = parse(uuid, req.params.userId);
  const gone = await q1('DELETE FROM guardians WHERE student_id = $1 AND user_id = $2 RETURNING user_id', [sid, uid]);
  if (!gone) throw notFound();
  // A parent with no remaining children loses access immediately.
  const left = await q1('SELECT 1 FROM guardians WHERE user_id = $1', [uid]);
  if (!left) {
    await q('UPDATE users SET is_active = false WHERE id = $1', [uid]);
    await destroyAllSessions(uid);
  }
  await audit(req, 'guardian.removed', 'student', sid, { user_id: uid });
  res.json({ ok: true });
});

/** Bulk import (CSV parsed in the browser → JSON rows). Each row is validated; all-or-nothing. */
r.post('/import', office, async (req, res) => {
  const rows = parse(
    z.strictObject({
      rows: z
        .array(
          z.strictObject({
            admission_no: text(30),
            full_name: text(150),
            dob: isoDate.optional().nullable(),
            gender: z.enum(['male', 'female', 'other']).optional().nullable(),
            class_name: text(50),
            section: text(10),
            roll_no: z.coerce.number().int().positive().optional().nullable(),
            parent_name: text(150),
            parent_phone: phoneE164,
            relation: z.enum(['father', 'mother', 'guardian', 'parent']).default('parent'),
          }),
        )
        .min(1)
        .max(3000),
    }),
    req.body,
  ).rows;
  const result = await tx(async (db) => {
    let created = 0;
    let updated = 0;
    for (const [i, row] of rows.entries()) {
      const sec = await q1(
        'SELECT sec.id FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE lower(c.name) = lower($1) AND upper(sec.name) = upper($2)',
        [row.class_name, row.section],
        db,
      );
      if (!sec) throw badRequest(`Row ${i + 1}: class "${row.class_name}" section "${row.section}" does not exist`);
      const s = await q1(
        `INSERT INTO students (admission_no, full_name, dob, gender, section_id, roll_no) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (admission_no) DO UPDATE SET full_name = EXCLUDED.full_name, dob = EXCLUDED.dob, gender = EXCLUDED.gender,
           section_id = EXCLUDED.section_id, roll_no = EXCLUDED.roll_no, updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [row.admission_no, row.full_name, row.dob ?? null, row.gender ?? null, sec.id, row.roll_no ?? null],
        db,
      );
      s!.inserted ? created++ : updated++;
      await upsertGuardian(db, s!.id, { full_name: row.parent_name, phone: row.parent_phone, relation: row.relation, is_primary: true, whatsapp_opt_in: true });
    }
    return { created, updated };
  });
  await audit(req, 'student.import', 'student', null, result);
  res.json(result);
});

export default r;
