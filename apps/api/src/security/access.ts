import { type Db, pool, q, q1 } from '../db/pool.ts';
import { forbidden, notFound } from '../lib/http.ts';
import type { AuthCtx } from './sessions.ts';

/**
 * Object-level authorisation. Every route that takes a student/section id calls one of these,
 * so a parent can never read another family's child and a teacher only sees their own classes.
 */

export const isLeadership = (a: AuthCtx) => a.user.role === 'principal' || a.user.role === 'office';

/** Student ids the caller may read (null = all students). */
export async function visibleStudentIds(a: AuthCtx, db: Db = pool): Promise<string[] | null> {
  switch (a.user.role) {
    case 'principal':
    case 'office':
      return null;
    case 'teacher':
      return (
        await q(
          `SELECT s.id FROM students s
            WHERE s.status = 'active' AND s.section_id IN (
              SELECT id FROM sections WHERE class_teacher_id = $1
              UNION SELECT section_id FROM teaching_assignments WHERE teacher_id = $1)`,
          [a.user.id],
          db,
        )
      ).map((r) => r.id);
    case 'parent':
      return (await q('SELECT student_id AS id FROM guardians WHERE user_id = $1', [a.user.id], db)).map((r) => r.id);
    case 'student':
      return (await q('SELECT id FROM students WHERE user_id = $1', [a.user.id], db)).map((r) => r.id);
  }
}

export async function assertStudentAccess(a: AuthCtx, studentId: string, db: Db = pool) {
  const exists = await q1('SELECT id, section_id FROM students WHERE id = $1', [studentId], db);
  if (!exists) throw notFound('Student not found');
  const ids = await visibleStudentIds(a, db);
  if (ids && !ids.includes(studentId)) throw forbidden();
  return exists as { id: string; section_id: number | null };
}

/** Families only: student must be the caller's own child / self. */
export async function assertFamilyOf(a: AuthCtx, studentId: string, db: Db = pool) {
  if (a.user.role !== 'parent' && a.user.role !== 'student') throw forbidden();
  await assertStudentAccess(a, studentId, db);
}

export async function isClassTeacher(a: AuthCtx, sectionId: number, db: Db = pool) {
  return !!(await q1('SELECT 1 FROM sections WHERE id = $1 AND class_teacher_id = $2', [sectionId, a.user.id], db));
}

export async function teachesSubject(a: AuthCtx, sectionId: number, subjectId: number, db: Db = pool) {
  return !!(await q1(
    'SELECT 1 FROM teaching_assignments WHERE section_id = $1 AND subject_id = $2 AND teacher_id = $3',
    [sectionId, subjectId, a.user.id],
    db,
  ));
}

/** Attendance: class teacher of the section, or principal. */
export async function assertCanMarkAttendance(a: AuthCtx, sectionId: number, db: Db = pool) {
  if (a.user.role === 'principal') return;
  if (a.user.role === 'teacher' && (await isClassTeacher(a, sectionId, db))) return;
  throw forbidden('Only the class teacher can mark attendance for this section');
}

/** Marks / homework / uploads: the subject teacher for that section, or principal. */
export async function assertCanTeach(a: AuthCtx, sectionId: number, subjectId: number, db: Db = pool) {
  if (a.user.role === 'principal') return;
  if (a.user.role === 'teacher' && (await teachesSubject(a, sectionId, subjectId, db))) return;
  throw forbidden('You do not teach this subject in this section');
}

/** Class-level uploads (library): teacher must teach the subject in any section of that class. */
export async function assertCanTeachClass(a: AuthCtx, classId: number, subjectId: number, db: Db = pool) {
  if (a.user.role === 'principal') return;
  if (a.user.role === 'teacher') {
    const ok = await q1(
      `SELECT 1 FROM teaching_assignments ta JOIN sections s ON s.id = ta.section_id
        WHERE s.class_id = $1 AND ta.subject_id = $2 AND ta.teacher_id = $3`,
      [classId, subjectId, a.user.id],
      db,
    );
    if (ok) return;
  }
  throw forbidden('You do not teach this subject in this class');
}

/** Class ids whose content (library, events) the family can see. */
export async function familyClassIds(a: AuthCtx, db: Db = pool): Promise<number[]> {
  const ids = await visibleStudentIds(a, db);
  if (!ids || !ids.length) return [];
  return (
    await q(
      `SELECT DISTINCT sec.class_id FROM students s JOIN sections sec ON sec.id = s.section_id WHERE s.id = ANY($1::uuid[])`,
      [ids],
      db,
    )
  ).map((r) => r.class_id);
}
