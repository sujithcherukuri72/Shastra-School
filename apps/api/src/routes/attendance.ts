import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { q, q1, tx } from '../db/pool.ts';
import { addDays, fmtDate, schoolToday } from '../lib/dates.ts';
import { badRequest, forbidden, id, isoDate, parse, text, uuid } from '../lib/http.ts';
import { assertCanMarkAttendance, assertFamilyOf, assertStudentAccess, isLeadership } from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { requireRole } from '../security/middleware.ts';
import { getSetting, notifyFamilies, whatsappFamilies } from '../services/notify.ts';

const r = Router();

/** Section register for a day: everyone defaults to present until marked otherwise. */
r.get('/section/:sectionId', requireRole('principal', 'office', 'teacher'), async (req, res) => {
  const sectionId = parse(id, req.params.sectionId);
  const day = parse(isoDate.optional(), req.query.date) ?? schoolToday();
  if (!isLeadership(req.auth!)) await assertCanMarkAttendance(req.auth!, sectionId);
  const [students, holiday, sec] = await Promise.all([
    q(
      `SELECT s.id, s.full_name, s.roll_no, a.status, a.parent_reason, a.updated_at
         FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $2
        WHERE s.section_id = $1 AND s.status = 'active' ORDER BY s.roll_no NULLS LAST, s.full_name`,
      [sectionId, day],
    ),
    q1('SELECT name FROM holidays WHERE day = $1', [day]),
    q1('SELECT sec.name, c.name AS class_name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.id = $1', [sectionId]),
  ]);
  res.json({
    day,
    section: sec,
    holiday: holiday?.name ?? null,
    submitted: students.some((s) => s.status),
    students: students.map((s) => ({ ...s, status: s.status ?? 'present' })),
  });
});

r.put('/section/:sectionId', requireRole('principal', 'teacher'), async (req, res) => {
  const sectionId = parse(id, req.params.sectionId);
  const b = parse(
    z.strictObject({
      date: isoDate,
      absent: z.array(uuid).max(200).default([]),
      late: z.array(uuid).max(200).default([]),
      leave: z.array(uuid).max(200).default([]),
    }),
    req.body,
  );
  await assertCanMarkAttendance(req.auth!, sectionId);
  const today = schoolToday();
  if (b.date > today) throw badRequest('Attendance cannot be marked for a future date');
  if (req.auth!.user.role === 'teacher' && b.date < addDays(today, -3)) {
    throw forbidden('Teachers can correct attendance for the last 3 days only. Ask the Principal for older changes.');
  }
  const all = [...b.absent, ...b.late, ...b.leave];
  if (new Set(all).size !== all.length) throw badRequest('A student can have only one status');

  const result = await tx(async (db) => {
    const students = await q('SELECT id FROM students WHERE section_id = $1 AND status = $2', [sectionId, 'active'], db);
    const ids = new Set(students.map((s) => s.id));
    for (const sid of all) if (!ids.has(sid)) throw badRequest('A student in the list is not in this section');
    const statusOf = (sid: string) => (b.absent.includes(sid) ? 'absent' : b.late.includes(sid) ? 'late' : b.leave.includes(sid) ? 'leave' : 'present');

    const before = new Map(
      (await q('SELECT student_id, status FROM attendance WHERE day = $1 AND student_id = ANY($2::uuid[])', [b.date, [...ids]], db)).map((r) => [r.student_id, r.status]),
    );
    await q(
      `INSERT INTO attendance (student_id, day, status, section_id, marked_by)
       SELECT sid, $1, st::attendance_status, $2, $3 FROM unnest($4::uuid[], $5::text[]) AS t(sid, st)
       ON CONFLICT (student_id, day) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by,
         section_id = EXCLUDED.section_id, updated_at = now()`,
      [b.date, sectionId, req.auth!.user.id, [...ids], [...ids].map(statusOf)],
      db,
    );

    // Alert only on a change *to* absent, and at most once per child per day.
    const newlyAbsent = b.absent.filter((sid) => before.get(sid) !== 'absent');
    const alerts = (await getSetting('absence_alerts', db))?.enabled !== false;
    if (newlyAbsent.length) {
      await notifyFamilies(newlyAbsent, { kind: 'absence', title: `Marked absent · ${fmtDate(b.date)}`, body: 'Tap to add a reason for the absence.', link: '/family/attendance' }, db);
      if (alerts && b.date === today) {
        await whatsappFamilies(
          newlyAbsent,
          (g) => ({ kind: 'absence', template: 'absence_alert', params: [g.student_name, fmtDate(b.date), env.SCHOOL_NAME], dedupeKey: `absence:${g.student_id}:${b.date}` }),
          db,
        );
      }
    }
    return { total: ids.size, absent: b.absent.length, late: b.late.length, leave: b.leave.length, alerted: newlyAbsent.length };
  });
  await audit(req, 'attendance.marked', 'section', sectionId, { date: b.date, ...result });
  res.json(result);
});

/** Heat-map data for one student and month, plus a month-by-month view of the academic year. */
r.get('/student/:id', async (req, res) => {
  const sid = parse(uuid, req.params.id);
  await assertStudentAccess(req.auth!, sid);
  const month = parse(z.string().regex(/^\d{4}-\d{2}$/).optional(), req.query.month) ?? schoolToday().slice(0, 7);
  const from = `${month}-01`;
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const to = addDays(end.toISOString().slice(0, 10), -1);

  const [days, holidays, months] = await Promise.all([
    q('SELECT day, status, parent_reason FROM attendance WHERE student_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day', [sid, from, to]),
    q('SELECT day, name FROM holidays WHERE day BETWEEN $1 AND $2', [from, to]),
    q(
      `SELECT to_char(date_trunc('month', day), 'YYYY-MM') AS month,
              ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*), 0), 1) AS pct,
              COUNT(*) FILTER (WHERE status = 'absent') AS absent
         FROM attendance a WHERE student_id = $1
          AND day >= COALESCE((SELECT starts_on FROM academic_years WHERE is_current), CURRENT_DATE - interval '1 year')
        GROUP BY 1 ORDER BY 1`,
      [sid],
    ),
  ]);
  const counted = days.length;
  const present = days.filter((d) => d.status === 'present' || d.status === 'late').length;
  res.json({
    month,
    days,
    holidays,
    months,
    summary: {
      school_days: counted,
      present,
      absent: days.filter((d) => d.status === 'absent').length,
      late: days.filter((d) => d.status === 'late').length,
      leave: days.filter((d) => d.status === 'leave').length,
      pct: counted ? Math.round((present / counted) * 1000) / 10 : null,
    },
  });
});

/** Parents explain an absence / leave. */
r.put('/student/:id/reason', requireRole('parent', 'student'), async (req, res) => {
  const sid = parse(uuid, req.params.id);
  const b = parse(z.strictObject({ date: isoDate, reason: text(500) }), req.body);
  await assertFamilyOf(req.auth!, sid);
  if (b.date < addDays(schoolToday(), -30)) throw badRequest('Reasons can be added for the last 30 days only');
  const row = await q1(
    `UPDATE attendance SET parent_reason = $3, reason_at = now() WHERE student_id = $1 AND day = $2 AND status IN ('absent','leave','late') RETURNING day`,
    [sid, b.date, b.reason],
  );
  if (!row) throw badRequest('Your child was not marked absent, late or on leave that day');
  await audit(req, 'attendance.reason', 'student', sid, { date: b.date });
  res.json({ ok: true });
});

export default r;
