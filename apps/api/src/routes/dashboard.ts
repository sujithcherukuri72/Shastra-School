import { Router } from 'express';
import { env } from '../config/env.ts';
import { q, q1 } from '../db/pool.ts';
import { addDays, monthStart, schoolToday } from '../lib/dates.ts';
import { parse, uuid } from '../lib/http.ts';
import { assertFamilyOf } from '../security/access.ts';
import { requireRole } from '../security/middleware.ts';
import { attendanceSummary, performance } from '../services/performance.ts';

const r = Router();

/** "How is my school today?" */
r.get('/principal', requireRole('principal'), async (_req, res) => {
  const today = schoolToday();
  const [counts, att, unmarked, trend, fees, heat, events, notices, birthdays, messages] = await Promise.all([
    q1(`SELECT (SELECT COUNT(*) FROM students WHERE status = 'active') AS students,
               (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND is_active) AS teachers,
               (SELECT COUNT(*) FROM sections) AS sections`),
    q1(
      `SELECT COUNT(*) FILTER (WHERE status IN ('present','late')) AS present, COUNT(*) FILTER (WHERE status = 'absent') AS absent,
              COUNT(*) FILTER (WHERE status = 'late') AS late, COUNT(*) FILTER (WHERE status = 'leave') AS leave, COUNT(*) AS marked
         FROM attendance WHERE day = $1`,
      [today],
    ),
    q(
      `SELECT sec.id, c.name AS class_name, sec.name AS section_name, u.full_name AS class_teacher
         FROM sections sec JOIN classes c ON c.id = sec.class_id LEFT JOIN users u ON u.id = sec.class_teacher_id
        WHERE EXISTS (SELECT 1 FROM students s WHERE s.section_id = sec.id AND s.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.section_id = sec.id AND a.day = $1)
        ORDER BY c.sort_order, sec.name`,
      [today],
    ),
    q(
      `SELECT day, ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('present','late')) / NULLIF(COUNT(*), 0), 1) AS pct, COUNT(*) AS marked
         FROM attendance WHERE day BETWEEN $1 AND $2 GROUP BY day ORDER BY day`,
      [addDays(today, -27), today],
    ),
    q1(
      `SELECT COUNT(*) FILTER (WHERE balance <= 0) AS paid, COUNT(*) FILTER (WHERE balance > 0 AND paid > 0) AS part_paid,
              COUNT(*) FILTER (WHERE paid = 0) AS not_paid, COALESCE(SUM(amount), 0) AS billed, COALESCE(SUM(paid), 0) AS collected
         FROM (SELECT student_id, SUM(amount) AS amount, SUM(paid) AS paid, SUM(balance) AS balance
                 FROM fee_item_balances WHERE due_on <= CURRENT_DATE + 30
                  AND academic_year_id = (SELECT id FROM academic_years WHERE is_current) GROUP BY student_id) t`,
    ),
    q(
      `SELECT c.id AS class_id, c.name AS class_name, sub.name AS subject, ROUND(AVG(m.marks / e.max_marks * 100), 1) AS avg_pct
         FROM marks m JOIN exams e ON e.id = m.exam_id JOIN classes c ON c.id = e.class_id JOIN subjects sub ON sub.id = m.subject_id
        WHERE NOT m.is_absent AND e.exam_date >= CURRENT_DATE - 60
        GROUP BY c.id, c.name, c.sort_order, sub.name ORDER BY c.sort_order, sub.name`,
    ),
    q(`SELECT id, title, kind, starts_at, location FROM events WHERE starts_at >= now() - interval '1 day' ORDER BY starts_at LIMIT 5`),
    q(`SELECT id, title, priority, created_at FROM notices ORDER BY created_at DESC LIMIT 5`),
    q1(
      `SELECT COUNT(*) AS n FROM students WHERE status = 'active'
         AND extract(month FROM dob) = extract(month FROM $1::date) AND extract(day FROM dob) = extract(day FROM $1::date)`,
      [today],
    ),
    q1(
      `SELECT COUNT(*) FILTER (WHERE status IN ('sent','delivered','read')) AS sent, COUNT(*) FILTER (WHERE status = 'failed') AS failed,
              COUNT(*) FILTER (WHERE status IN ('queued','sending')) AS pending
         FROM wa_messages WHERE kind <> 'otp' AND created_at >= now() - interval '1 day'`,
    ),
  ]);
  const marked = Number(att?.marked ?? 0);
  res.json({
    today,
    counts,
    attendance: { ...att, pct: marked ? Math.round((Number(att!.present) / marked) * 1000) / 10 : null, unmarked },
    trend,
    fees,
    heatmap: heat,
    events,
    notices,
    birthdaysToday: birthdays?.n ?? 0,
    messages,
  });
});

r.get('/office', requireRole('office', 'principal'), async (_req, res) => {
  const today = schoolToday();
  const [collected, recent, dueSoon, birthdays, failed] = await Promise.all([
    q1(
      `SELECT COUNT(*) AS payments, COALESCE(SUM(amount), 0) AS amount,
              COALESCE(SUM(amount) FILTER (WHERE provider IS NOT NULL), 0) AS online
         FROM payments WHERE status = 'paid' AND paid_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`,
      [env.SCHOOL_TIMEZONE],
    ),
    q(`SELECT p.id, p.receipt_no, p.amount, p.method, p.provider, p.paid_at, s.full_name AS student
         FROM payments p JOIN students s ON s.id = p.student_id WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 8`),
    q1(`SELECT COUNT(DISTINCT student_id) AS students, COALESCE(SUM(balance), 0) AS amount
          FROM fee_item_balances WHERE balance > 0 AND due_on <= CURRENT_DATE + 7`),
    q(
      `SELECT s.id, s.full_name, c.name AS class_name, sec.name AS section_name FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
        WHERE s.status = 'active' AND extract(month FROM s.dob) = extract(month FROM $1::date) AND extract(day FROM s.dob) = extract(day FROM $1::date)`,
      [today],
    ),
    q1(`SELECT COUNT(*) AS n FROM wa_messages WHERE status = 'failed' AND created_at > now() - interval '7 days'`),
  ]);
  res.json({ today, collected, recent, dueSoon, birthdays, failedMessages: failed?.n ?? 0 });
});

r.get('/teacher', requireRole('teacher', 'principal'), async (req, res) => {
  const me = req.auth!.user.id;
  const today = schoolToday();
  const [classes, teaches, homework, exams] = await Promise.all([
    q(
      `SELECT sec.id AS section_id, c.name AS class_name, sec.name AS section_name,
              (SELECT COUNT(*) FROM students s WHERE s.section_id = sec.id AND s.status = 'active') AS students,
              (SELECT COUNT(*) FROM attendance a WHERE a.section_id = sec.id AND a.day = $2) AS marked,
              (SELECT COUNT(*) FROM attendance a WHERE a.section_id = sec.id AND a.day = $2 AND a.status = 'absent') AS absent
         FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.class_teacher_id = $1 ORDER BY c.sort_order, sec.name`,
      [me, today],
    ),
    q(
      `SELECT ta.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name, ta.subject_id, sub.name AS subject
         FROM teaching_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
         JOIN subjects sub ON sub.id = ta.subject_id WHERE ta.teacher_id = $1 ORDER BY c.sort_order, sec.name, sub.name`,
      [me],
    ),
    q(
      `SELECT h.id, h.title, h.due_on, sub.name AS subject, c.name AS class_name, sec.name AS section_name,
              (SELECT COUNT(*) FROM homework_done d WHERE d.homework_id = h.id) AS done,
              (SELECT COUNT(*) FROM students s WHERE s.section_id = h.section_id AND s.status = 'active') AS students
         FROM homework h JOIN subjects sub ON sub.id = h.subject_id JOIN sections sec ON sec.id = h.section_id JOIN classes c ON c.id = sec.class_id
        WHERE h.teacher_id = $1 ORDER BY h.created_at DESC LIMIT 6`,
      [me],
    ),
    q(
      `SELECT e.id, e.name, e.kind, e.exam_date, e.max_marks, e.published_at, c.name AS class_name, e.class_id
         FROM exams e JOIN classes c ON c.id = e.class_id
        WHERE e.class_id IN (SELECT sec.class_id FROM teaching_assignments ta JOIN sections sec ON sec.id = ta.section_id WHERE ta.teacher_id = $1)
          AND e.exam_date >= CURRENT_DATE - 30 ORDER BY e.exam_date DESC LIMIT 10`,
      [me],
    ),
  ]);
  res.json({ today, classes, teaches, homework, exams });
});

/** Parent / student home: everything about one child at a glance. */
r.get('/family/:studentId', requireRole('parent', 'student'), async (req, res) => {
  const sid = parse(uuid, req.params.studentId);
  await assertFamilyOf(req.auth!, sid);
  const today = schoolToday();
  const [att, perf, homework, fees, events, unread, todayAtt] = await Promise.all([
    attendanceSummary(sid, monthStart(today), today),
    performance(sid),
    q(
      `SELECT h.id, h.title, h.due_on, sub.name AS subject, d.done_at
         FROM homework h JOIN students s ON s.section_id = h.section_id JOIN subjects sub ON sub.id = h.subject_id
         LEFT JOIN homework_done d ON d.homework_id = h.id AND d.student_id = s.id
        WHERE s.id = $1 AND h.due_on >= $2 ORDER BY h.due_on, sub.name LIMIT 20`,
      [sid, today],
    ),
    q1(
      `SELECT COALESCE(SUM(balance), 0) AS balance, MIN(due_on) FILTER (WHERE balance > 0) AS next_due,
              COALESCE(SUM(balance) FILTER (WHERE due_on < CURRENT_DATE), 0) AS overdue
         FROM fee_item_balances WHERE student_id = $1`,
      [sid],
    ),
    q(
      `SELECT e.id, e.title, e.kind, e.starts_at, e.location FROM events e
        WHERE e.starts_at >= now() - interval '6 hours'
          AND (e.class_id IS NULL OR e.class_id = (SELECT sec.class_id FROM students s JOIN sections sec ON sec.id = s.section_id WHERE s.id = $1))
        ORDER BY e.starts_at LIMIT 4`,
      [sid],
    ),
    q1('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.auth!.user.id]),
    q1('SELECT status FROM attendance WHERE student_id = $1 AND day = $2', [sid, today]),
  ]);
  res.json({
    today,
    student: perf.student,
    attendance: { ...att, today: todayAtt?.status ?? null },
    grade: perf.overall,
    strongest: perf.strongest,
    focus: perf.focus,
    lastTest: perf.trend.at(-1) ?? null,
    homework: { pending: homework.filter((h) => !h.done_at).length, items: homework },
    fees,
    events,
    unread: unread?.n ?? 0,
  });
});

export default r;
