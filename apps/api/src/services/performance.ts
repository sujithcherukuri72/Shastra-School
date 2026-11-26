import { type Db, pool, q, q1 } from '../db/pool.ts';
import { addDays } from '../lib/dates.ts';
import { gradeFor } from './grades.ts';

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

export async function studentHeader(studentId: string, db: Db = pool) {
  return q1(
    `SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.dob, s.section_id,
            sec.name AS section_name, c.id AS class_id, c.name AS class_name,
            ct.full_name AS class_teacher
       FROM students s
       LEFT JOIN sections sec ON sec.id = s.section_id
       LEFT JOIN classes c ON c.id = sec.class_id
       LEFT JOIN users ct ON ct.id = sec.class_teacher_id
      WHERE s.id = $1`,
    [studentId],
    db,
  );
}

/** Weekly-test trend vs class average, subject grades, strongest subject and focus area. */
export async function performance(studentId: string, opts: { from?: string; to?: string } = {}, db: Db = pool) {
  const st = await studentHeader(studentId, db);
  if (!st?.class_id) return { student: st, trend: [], subjects: [], strongest: null, focus: null, overall: null };
  const from = opts.from ?? '1900-01-01';
  const to = opts.to ?? '2999-12-31';

  // Per published exam: student's % (avg across subjects) vs class average %.
  const trend = await q(
    `WITH pct AS (
       SELECT m.exam_id, m.student_id, AVG(m.marks / e.max_marks * 100) AS pct
         FROM marks m JOIN exams e ON e.id = m.exam_id
        WHERE e.class_id = $2 AND e.published_at IS NOT NULL AND NOT m.is_absent
          AND e.exam_date BETWEEN $3 AND $4
        GROUP BY m.exam_id, m.student_id)
     SELECT e.id AS exam_id, e.name, e.kind, e.exam_date,
            (SELECT pct FROM pct WHERE pct.exam_id = e.id AND pct.student_id = $1) AS student_pct,
            (SELECT AVG(pct) FROM pct WHERE pct.exam_id = e.id) AS class_avg
       FROM exams e
      WHERE e.class_id = $2 AND e.published_at IS NOT NULL AND e.exam_date BETWEEN $3 AND $4
      ORDER BY e.exam_date`,
    [studentId, st.class_id, from, to],
    db,
  );

  const subjects = await q(
    `SELECT sub.id AS subject_id, sub.name AS subject,
            AVG(m.marks / e.max_marks * 100) FILTER (WHERE m.student_id = $1 AND NOT m.is_absent) AS pct,
            AVG(m.marks / e.max_marks * 100) FILTER (WHERE NOT m.is_absent) AS class_avg,
            COUNT(*) FILTER (WHERE m.student_id = $1) AS tests
       FROM marks m JOIN exams e ON e.id = m.exam_id JOIN subjects sub ON sub.id = m.subject_id
      WHERE e.class_id = $2 AND e.published_at IS NOT NULL AND e.exam_date BETWEEN $3 AND $4
      GROUP BY sub.id, sub.name
     HAVING COUNT(*) FILTER (WHERE m.student_id = $1) > 0
      ORDER BY sub.name`,
    [studentId, st.class_id, from, to],
    db,
  );

  const subj = subjects.map((s) => ({
    subject_id: s.subject_id,
    subject: s.subject,
    pct: round1(s.pct),
    class_avg: round1(s.class_avg),
    grade: gradeFor(s.pct),
    tests: s.tests,
  }));
  const ranked = subj.filter((s) => s.pct != null).sort((a, b) => b.pct! - a.pct!);
  const overallPct = ranked.length ? ranked.reduce((a, s) => a + s.pct!, 0) / ranked.length : null;

  return {
    student: st,
    trend: trend.map((t) => ({ ...t, student_pct: round1(t.student_pct), class_avg: round1(t.class_avg) })),
    subjects: subj,
    strongest: ranked[0] ?? null,
    focus: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
    overall: overallPct == null ? null : { pct: round1(overallPct), grade: gradeFor(overallPct) },
  };
}

/** Attendance between two dates: counts + percentage (late counts as present). */
export async function attendanceSummary(studentId: string, from: string, to: string, db: Db = pool) {
  const r = await q1(
    `SELECT COUNT(*) FILTER (WHERE status IN ('present','late')) AS present,
            COUNT(*) FILTER (WHERE status = 'late') AS late,
            COUNT(*) FILTER (WHERE status = 'absent') AS absent,
            COUNT(*) FILTER (WHERE status = 'leave') AS leave,
            COUNT(*) AS total
       FROM attendance WHERE student_id = $1 AND day BETWEEN $2 AND $3`,
    [studentId, from, to],
    db,
  );
  const total = r?.total ?? 0;
  return { ...r, pct: total ? round1(((r!.present as number) / total) * 100) : null };
}

/** Everything that goes on a monthly report card. */
export async function monthlyReport(studentId: string, month: string, db: Db = pool) {
  const from = month;
  const next = new Date(`${month}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const to = addDays(next.toISOString().slice(0, 10), -1);
  const perf = await performance(studentId, { from, to }, db);
  const att = await attendanceSummary(studentId, from, to, db);
  const remark = await q1('SELECT remark FROM report_remarks WHERE student_id = $1 AND month = $2', [studentId, month], db);
  return { ...perf, month, from, to, attendance: att, remark: remark?.remark ?? null };
}
