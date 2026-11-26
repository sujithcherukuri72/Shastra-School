/**
 * Demo data for local development and staff training. ALL names, phones, marks and amounts are fictional.
 * Refuses to run in production. Wipes existing data first.
 *   npm run seed
 */
import { env, isProd } from '../config/env.ts';
import { saveBuffer } from '../lib/files.ts';
import { addDays, schoolToday } from '../lib/dates.ts';
import { hashPassword } from '../security/password.ts';
import { samplePdf } from '../services/pdf.ts';
import { migrate } from './migrate.ts';
import { pool, q, q1, tx } from './pool.ts';

if (isProd && process.env.ALLOW_PROD_SEED !== 'yes-wipe-everything') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

const DEMO_PASSWORD = 'Shastra@2026demo';
const today = schoolToday();

const FIRST = ['Aarav', 'Vihaan', 'Aditya', 'Sai', 'Krishna', 'Rohan', 'Arjun', 'Karthik', 'Nikhil', 'Rahul', 'Varun', 'Harsha', 'Teja', 'Charan', 'Pranav', 'Akhil', 'Manish', 'Srinivas',
  'Ananya', 'Diya', 'Sneha', 'Lakshmi', 'Kavya', 'Meghana', 'Sahithi', 'Divya', 'Harika', 'Keerthi', 'Pooja', 'Swathi', 'Bhavana', 'Navya', 'Sravani', 'Ishita', 'Tanvi', 'Riya'];
const LAST = ['Reddy', 'Rao', 'Goud', 'Naidu', 'Sharma', 'Varma', 'Yadav', 'Chary', 'Kumar', 'Prasad', 'Murthy', 'Patel', 'Gupta', 'Shetty', 'Raju'];
const SUBJECTS: [string, string][] = [['English', 'ENG'], ['Telugu', 'TEL'], ['Hindi', 'HIN'], ['Mathematics', 'MAT'], ['Science', 'SCI'], ['Social Studies', 'SOC']];
const TEACHERS = [
  ['Lakshmi Prasanna', 'teacher@shastra.school', 'Mathematics'],
  ['Ravi Kumar', 'ravi.kumar@shastra.school', 'Science'],
  ['Suma Latha', 'suma.latha@shastra.school', 'English'],
  ['Venkat Rao', 'venkat.rao@shastra.school', 'Telugu'],
  ['Anitha Sharma', 'anitha.sharma@shastra.school', 'Hindi'],
  ['Mahesh Goud', 'mahesh.goud@shastra.school', 'Social Studies'],
  ['Padmaja Reddy', 'padmaja.reddy@shastra.school', 'Mathematics'],
  ['Srikanth Varma', 'srikanth.varma@shastra.school', 'Science'],
  ['Rajeshwari Naidu', 'rajeshwari.naidu@shastra.school', 'English'],
  ['Kiran Chary', 'kiran.chary@shastra.school', 'Social Studies'],
] as const;

let seed = 20262027;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

async function wipe() {
  await q(`TRUNCATE users, sessions, otp_challenges, audit_logs, academic_years, classes, sections, subjects, teaching_assignments,
           students, guardians, holidays, attendance, exams, marks, report_remarks, files, homework, homework_done, library_items,
           worksheet_submissions, answer_sheets, fee_items, payments, payment_allocations, events, notices, notifications,
           wa_messages, job_runs RESTART IDENTITY CASCADE`);
  await q(`ALTER SEQUENCE receipt_seq RESTART WITH 1001`);
}

async function main() {
  await migrate(() => {});
  console.log('Wiping existing data…');
  await wipe();
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Year, classes, subjects ────────────────────────────────────────────────
  const year = await q1(`INSERT INTO academic_years (name, starts_on, ends_on, is_current) VALUES ('2026-27', '2026-06-12', '2027-04-23', true) RETURNING id`);
  const subjects = new Map<string, number>();
  for (const [name, code] of SUBJECTS) subjects.set(name, (await q1('INSERT INTO subjects (name, code) VALUES ($1,$2) RETURNING id', [name, code]))!.id);
  const sections: { id: number; classId: number; grade: number; name: string }[] = [];
  const classIds = new Map<number, number>();
  for (const grade of [6, 7, 8, 9, 10]) {
    const c = await q1('INSERT INTO classes (name, grade, sort_order) VALUES ($1,$2,$2) RETURNING id', [`Class ${grade}`, grade]);
    classIds.set(grade, c!.id);
    for (const s of ['A', 'B']) {
      const sec = await q1('INSERT INTO sections (class_id, name) VALUES ($1,$2) RETURNING id', [c!.id, s]);
      sections.push({ id: sec!.id, classId: c!.id, grade, name: s });
    }
  }

  // ── Staff ──────────────────────────────────────────────────────────────────
  const principal = await q1(
    `INSERT INTO users (role, full_name, email, phone, dob, password_hash) VALUES ('principal', 'Dr. Srinivas Reddy', 'principal@shastra.school', '+919100000001', '1975-03-14', $1) RETURNING id`,
    [pw],
  );
  await q(`INSERT INTO users (role, full_name, email, phone, dob, password_hash) VALUES ('office', 'Office – Madhavi', 'office@shastra.school', '+919100000002', $2, $1)`, [pw, `1988-${today.slice(5)}`]);
  const teacherIds: { id: string; subject: string }[] = [];
  for (const [i, [name, email, subject]] of TEACHERS.entries()) {
    const t = await q1(
      `INSERT INTO users (role, full_name, email, phone, dob, password_hash) VALUES ('teacher', $1, $2, $3, $4, $5) RETURNING id`,
      [name, email, `+9191000001${String(i).padStart(2, '0')}`, `198${i % 10}-0${(i % 9) + 1}-1${i % 9}`, pw],
    );
    teacherIds.push({ id: t!.id, subject });
  }
  // Class teachers: one per section (demo teacher = Class 9-A).
  const order = [0, 6, 1, 2, 3, 4, 5, 7, 8, 9];
  const sec9A = sections.find((s) => s.grade === 9 && s.name === 'A')!;
  const ctOrder = [sec9A, ...sections.filter((s) => s !== sec9A)];
  for (const [i, s] of ctOrder.entries()) await q('UPDATE sections SET class_teacher_id = $2 WHERE id = $1', [s.id, teacherIds[order[i]!]!.id]);
  // Subject teachers: the two teachers per subject split the sections.
  for (const s of sections) {
    for (const [subject, subjId] of subjects) {
      const cands = teacherIds.filter((t) => t.subject === subject);
      const t = cands.length === 1 ? cands[0]! : cands[(s.grade >= 9 ? 0 : 1) % cands.length]!;
      await q('INSERT INTO teaching_assignments (teacher_id, section_id, subject_id) VALUES ($1,$2,$3)', [t.id, s.id, subjId]);
    }
  }

  // ── Students & parents ─────────────────────────────────────────────────────
  console.log('Creating students and parents…');
  const studentIds: string[] = [];
  let adm = 2401;
  let phoneN = 10;
  const demoParent = await q1(`INSERT INTO users (role, full_name, phone) VALUES ('parent', 'Ramesh Reddy', '+919000000001') RETURNING id`);
  for (const s of sections) {
    for (let roll = 1; roll <= 18; roll++) {
      const girl = rand() < 0.5;
      const first = girl ? pick(FIRST.slice(18)) : pick(FIRST.slice(0, 18));
      const last = pick(LAST);
      const birthYear = 2026 - s.grade - 6;
      let dob = `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
      if (roll === 3) dob = `${birthYear}-${today.slice(5)}`; // a birthday today in every section
      if (roll === 7) dob = `${birthYear}-${addDays(today, 3).slice(5)}`;
      const isDemoChild = (s === sec9A && roll === 1) || (s.grade === 6 && s.name === 'B' && roll === 1);
      const name = isDemoChild ? (s.grade === 9 ? 'Aarav Reddy' : 'Ananya Reddy') : `${first} ${last}`;
      const st = await q1(
        `INSERT INTO students (admission_no, full_name, dob, gender, section_id, roll_no, address) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [`SHS${adm++}`, name, dob, isDemoChild ? (s.grade === 9 ? 'male' : 'female') : girl ? 'female' : 'male', s.id, roll, `${roll}-${s.grade}/${s.name}, Suryapet, Telangana`],
      );
      studentIds.push(st!.id);
      if (isDemoChild) {
        await q(`INSERT INTO guardians (student_id, user_id, relation, is_primary) VALUES ($1,$2,'father',true)`, [st!.id, demoParent!.id]);
      } else {
        const p = await q1(`INSERT INTO users (role, full_name, phone) VALUES ('parent', $1, $2) RETURNING id`, [
          `${rand() < 0.6 ? pick(FIRST.slice(0, 18)) : pick(FIRST.slice(18))} ${last}`,
          `+91900000${String(phoneN++).padStart(4, '0')}`,
        ]);
        await q(`INSERT INTO guardians (student_id, user_id, relation, is_primary) VALUES ($1,$2,$3,true)`, [st!.id, p!.id, pick(['father', 'mother'] as const)]);
      }
    }
  }
  // A student login (Class 9-A roll 2) using OTP on their own phone.
  const stu = await q1(`SELECT id FROM students WHERE section_id = $1 AND roll_no = 2`, [sec9A.id]);
  const stuUser = await q1(`INSERT INTO users (role, full_name, phone) VALUES ('student', 'Student – 9A roll 2', '+919000000002') RETURNING id`);
  await q('UPDATE students SET user_id = $2 WHERE id = $1', [stu!.id, stuUser!.id]);

  // ── Holidays & attendance (last ~6 weeks, Mon–Sat) ─────────────────────────
  console.log('Attendance…');
  const hol1 = addDays(today, -12);
  await q(`INSERT INTO holidays (day, name) VALUES ($1, 'Local festival'), ($2, 'Christmas'), ($3, 'Sankranti')`, [hol1, `${today.slice(0, 4)}-12-25`, `${Number(today.slice(0, 4)) + 1}-01-14`]);
  await q(`SELECT setseed(0.42)`);
  await q(
    `INSERT INTO attendance (student_id, day, status, section_id, marked_by)
     SELECT id, day,
            (CASE WHEN r < 0.05 THEN 'absent' WHEN r < 0.08 THEN 'late' WHEN r < 0.095 THEN 'leave' ELSE 'present' END)::attendance_status,
            section_id, class_teacher_id
       FROM (SELECT s.id, d::date AS day, s.section_id, sec.class_teacher_id, random() AS r  -- random() per row
               FROM students s JOIN sections sec ON sec.id = s.section_id
              CROSS JOIN generate_series($1::date, $2::date, interval '1 day') d
              WHERE extract(isodow FROM d) < 7 AND d::date NOT IN (SELECT day FROM holidays)) t`,
    [addDays(today, -42), addDays(today, -1)],
  );
  await q(`UPDATE attendance SET parent_reason = 'Fever – visited the doctor.' WHERE status = 'absent' AND student_id IN (SELECT student_id FROM guardians WHERE user_id = $1)`, [demoParent!.id]);

  // ── Exams & marks: weekly tests (25) + one unit test (50) per class ────────
  console.log('Exams and marks…');
  const saturdays: string[] = [];
  for (let d = addDays(today, -42); d < today; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() === 6) saturdays.push(d);
  for (const [grade, classId] of classIds) {
    const exams: { id: number; max: number }[] = [];
    for (const [i, d] of saturdays.entries()) {
      exams.push({ id: (await q1(`INSERT INTO exams (name, kind, class_id, exam_date, max_marks, academic_year_id, published_at) VALUES ($1,'weekly_test',$2,$3,25,$4,now()) RETURNING id`, [`Weekly Test ${i + 1}`, classId, d, year!.id]))!.id, max: 25 });
    }
    exams.push({ id: (await q1(`INSERT INTO exams (name, kind, class_id, exam_date, max_marks, academic_year_id, published_at) VALUES ('Unit Test 2','unit_test',$1,$2,50,$3,now()) RETURNING id`, [classId, addDays(today, -20), year!.id]))!.id, max: 50 });
    for (const [ei, e] of exams.entries()) {
      // Each student has a stable ability; Class 9 Maths is deliberately weaker (shows on the heat map).
      await q(
        `INSERT INTO marks (exam_id, student_id, subject_id, marks, is_absent, entered_by)
         SELECT $1, s.id, ta.subject_id,
                LEAST($2::numeric, GREATEST(0, ROUND(($2::numeric * (0.45 + (abs(hashtext(s.id::text)) % 45) / 100.0
                   + (abs(hashtext(s.id::text || ta.subject_id)) % 20 - 10) / 100.0
                   + $3::int * 0.012
                   - CASE WHEN $4::int = 9 AND ta.subject_id = $5::int THEN 0.18 ELSE 0 END
                   + (random()::numeric - 0.5) * 0.12)), 0))), false, ta.teacher_id
           FROM students s JOIN teaching_assignments ta ON ta.section_id = s.section_id
           JOIN sections sec ON sec.id = s.section_id WHERE sec.class_id = $6`,
        [e.id, e.max, ei, grade, subjects.get('Mathematics'), classId],
      );
    }
  }
  // An upcoming, unpublished test so teachers have something to enter.
  for (const [, classId] of classIds) {
    await q(`INSERT INTO exams (name, kind, class_id, exam_date, max_marks, academic_year_id) VALUES ('Weekly Test ${saturdays.length + 1}','weekly_test',$1,$2,25,$3)`, [classId, today, year!.id]);
  }
  const month = today.slice(0, 7);
  for (const sid of studentIds.slice(0, 40)) {
    await q(`INSERT INTO report_remarks (student_id, month, remark) VALUES ($1, $2, $3)`, [sid, `${month}-01`, pick(['Attentive in class and completes work on time.', 'Good progress this month. Needs more practice in written answers.', 'Participates well. Should revise Mathematics regularly.', 'Excellent effort and conduct.'])]);
  }

  // ── Fees ───────────────────────────────────────────────────────────────────
  console.log('Fees and payments…');
  const y = Number(today.slice(0, 4));
  const terms: [string, string, number][] = [['Term 1', '2026-06-30', 18000], ['Term 2', addDays(today, 7), 18000], ['Term 3', `${y + 1}-03-10`, 16000]];
  for (const [term, due, amt] of terms) {
    await q(
      `INSERT INTO fee_items (student_id, academic_year_id, term, title, amount, due_on)
       SELECT s.id, $1, $2, 'Tuition fee', $3 + (sec.class_id * 500), $4 FROM students s JOIN sections sec ON sec.id = s.section_id`,
      [year!.id, term, amt, due],
    );
  }
  await q(`INSERT INTO fee_items (student_id, academic_year_id, term, title, amount, due_on) SELECT id, $1, 'Term 2', 'Transport', 6500, $2 FROM students WHERE random() < 0.35`, [year!.id, addDays(today, 7)]);
  const items = await q(`SELECT fi.id, fi.student_id, fi.term, fi.amount FROM fee_items fi ORDER BY fi.student_id, fi.due_on`);
  await tx(async (db) => {
    for (const it of items) {
      const r = rand();
      let pay = 0;
      if (it.term === 'Term 1') pay = r < 0.9 ? it.amount : r < 0.96 ? Math.round(it.amount / 2) : 0;
      else if (it.term === 'Term 2') pay = r < 0.35 ? it.amount : r < 0.5 ? Math.round(it.amount / 2) : 0;
      if (!pay) continue;
      const n = await q1(`SELECT nextval('receipt_seq') AS n`, [], db);
      const online = rand() < 0.45;
      const p = await q1(
        `INSERT INTO payments (student_id, amount, method, status, receipt_no, provider, provider_order_id, paid_at)
         VALUES ($1,$2,$3,'paid',$4,$5,$6, now() - (random() * interval '40 days')) RETURNING id`,
        [it.student_id, pay, online ? 'upi' : pick(['cash', 'cash', 'cheque'] as const), `${env.RECEIPT_PREFIX}/2026-27/${String(n!.n).padStart(6, '0')}`, online ? 'mock' : null, online ? `seed_${n!.n}` : null],
        db,
      );
      await q('INSERT INTO payment_allocations (payment_id, fee_item_id, amount) VALUES ($1,$2,$3)', [p!.id, it.id, pay], db);
    }
  });

  // ── Homework, library ──────────────────────────────────────────────────────
  console.log('Homework and library files…');
  const tasks: Record<string, string[]> = {
    English: ['Write a paragraph on "My favourite festival"', 'Read Chapter 4 and answer the questions on page 52'],
    Telugu: ['పాఠం 5 ప్రశ్నలకు సమాధానాలు రాయండి', 'Learn the poem by heart'],
    Hindi: ['पाठ 3 के प्रश्न-उत्तर लिखिए', 'Write 10 sentences about your school'],
    Mathematics: ['Exercise 6.2 – questions 1 to 10', 'Practice worksheet on fractions'],
    Science: ['Draw and label the parts of a plant cell', 'Revise Chapter 7 – Light'],
    'Social Studies': ['Map work: mark the rivers of India', 'Read the chapter on the Indian Constitution'],
  };
  for (const s of sections) {
    for (const [subject, subjId] of subjects) {
      const t = await q1('SELECT teacher_id FROM teaching_assignments WHERE section_id = $1 AND subject_id = $2', [s.id, subjId]);
      for (const [i, title] of tasks[subject]!.entries()) {
        await q(`INSERT INTO homework (section_id, subject_id, teacher_id, title, details, due_on, created_at) VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' days')::interval)`, [
          s.id, subjId, t!.teacher_id, title, 'Complete in your notebook and bring it to class.', addDays(today, i === 0 ? 1 : 3 - (subjId % 5)), String(i + 1),
        ]);
      }
    }
  }
  await q(`INSERT INTO homework_done (homework_id, student_id) SELECT h.id, s.id FROM homework h JOIN students s ON s.section_id = h.section_id WHERE h.due_on < $1 AND random() < 0.8`, [today]);

  for (const [grade, classId] of classIds) {
    for (const [subject, subjId] of subjects) {
      const t = await q1(`SELECT ta.teacher_id FROM teaching_assignments ta JOIN sections s ON s.id = ta.section_id WHERE s.class_id = $1 AND ta.subject_id = $2 LIMIT 1`, [classId, subjId]);
      const book = await saveBuffer(await samplePdf(`${subject} – Class ${grade}`, ['Sample textbook for the demo.', 'Replace with the real SCERT / CBSE textbook PDF.']), `${subject}-Class-${grade}-Textbook.pdf`, 'application/pdf', t!.teacher_id);
      await q(`INSERT INTO library_items (kind, class_id, subject_id, title, file_id, uploaded_by) VALUES ('textbook',$1,$2,$3,$4,$5)`, [classId, subjId, `${subject} – Class ${grade} textbook`, book.id, t!.teacher_id]);
      if (subject === 'Mathematics' || subject === 'Science' || subject === 'English') {
        const ws = await saveBuffer(await samplePdf(`${subject} worksheet`, ['1. ____________', '2. ____________', '3. ____________']), `${subject}-Worksheet-${grade}.pdf`, 'application/pdf', t!.teacher_id);
        await q(`INSERT INTO library_items (kind, class_id, subject_id, title, file_id, due_on, uploaded_by) VALUES ('worksheet',$1,$2,$3,$4,$5,$6)`, [classId, subjId, `${subject} practice worksheet`, ws.id, addDays(today, 4), t!.teacher_id]);
        for (const yr of [2025, 2024]) {
          const paper = await saveBuffer(await samplePdf(`${subject} – Annual exam ${yr}`, ['Section A …', 'Section B …']), `${subject}-${grade}-${yr}-Paper.pdf`, 'application/pdf', t!.teacher_id);
          const key = await saveBuffer(await samplePdf(`${subject} – Answer key ${yr}`, ['1. (b)', '2. (d)', '3. (a)']), `${subject}-${grade}-${yr}-Key.pdf`, 'application/pdf', t!.teacher_id);
          await q(`INSERT INTO library_items (kind, class_id, subject_id, title, exam_name, year, file_id, answer_key_file_id, uploaded_by) VALUES ('paper',$1,$2,$3,'Annual exam',$4,$5,$6,$7)`, [classId, subjId, `${subject} annual exam ${yr}`, yr, paper.id, key.id, t!.teacher_id]);
        }
      }
    }
  }
  // Checked answer sheet for the demo child (Unit Test 2, Mathematics).
  const aarav = await q1(`SELECT id FROM students WHERE full_name = 'Aarav Reddy'`);
  const ut2 = await q1(`SELECT id FROM exams WHERE class_id = $1 AND name = 'Unit Test 2'`, [sec9A.classId]);
  const sheet = await saveBuffer(await samplePdf('Unit Test 2 – Mathematics (checked)', ['Q1 ✓ 5/5', 'Q2 ✓ 4/5 – show steps', 'Q3 ✗ 1/5 – revise factorisation']), 'Aarav-UT2-Maths.pdf', 'application/pdf', teacherIds[0]!.id);
  await q(`INSERT INTO answer_sheets (exam_id, student_id, subject_id, file_id, comments, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`, [ut2!.id, aarav!.id, subjects.get('Mathematics'), sheet.id, 'Good attempt. Revise factorisation (Q3) and show all steps.', teacherIds[0]!.id]);

  // ── Events & notices ───────────────────────────────────────────────────────
  const at = (d: string, hm: string) => `${d}T${hm}:00+05:30`;
  await q(
    `INSERT INTO events (title, description, kind, starts_at, ends_at, location, created_by) VALUES
      ('Science Exhibition', 'Students of Classes 6–10 present their projects. Parents are welcome.', 'exhibition', $1, $2, 'School auditorium', $7),
      ('Parent–Teacher Meeting', 'Discuss your child''s progress with the class teacher.', 'meeting', $3, $4, 'Classrooms', $7),
      ('Annual Sports Day', 'Track events, relays and prize distribution.', 'sports', $5, $6, 'School ground', $7)`,
    [at(addDays(today, 5), '10:00'), at(addDays(today, 5), '13:00'), at(addDays(today, 9), '09:30'), at(addDays(today, 9), '12:30'), at(addDays(today, 20), '08:00'), at(addDays(today, 20), '16:00'), principal!.id],
  );
  await q(
    `INSERT INTO events (title, kind, starts_at, class_id, created_by) VALUES ('Unit Test 3 begins', 'exam', $1, $2, $3)`,
    [at(addDays(today, 12), '09:00'), sec9A.classId, principal!.id],
  );
  await q(
    `INSERT INTO notices (title, body, priority, created_by, created_at) VALUES
      ('Winter uniform from 1 December', 'All students should wear the winter uniform (navy sweater) from 1 December.', 'normal', $1, now() - interval '2 days'),
      ('Term 2 fee due soon', 'Term 2 fees are due next week. Pay in the app or at the school office (9 AM – 3 PM).', 'important', $1, now() - interval '1 day')`,
    [principal!.id],
  );
  await q(
    `INSERT INTO notifications (user_id, student_id, kind, title, body, link)
     SELECT g.user_id, g.student_id, 'notice', 'Term 2 fee due soon', 'Pay in the app or at the school office.', '/family/fees'
       FROM guardians g WHERE g.user_id = $1`,
    [demoParent!.id],
  );

  const counts = await q1(`SELECT (SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM attendance) AS attendance,
                                  (SELECT COUNT(*) FROM marks) AS marks, (SELECT COUNT(*) FROM payments) AS payments`);
  console.log('\nSeed complete:', counts);
  console.log(`
  Demo logins (password for all staff: ${DEMO_PASSWORD})
    Principal   principal@shastra.school
    Office      office@shastra.school
    Teacher     teacher@shastra.school      (class teacher 9-A, Maths for Classes 9–10)
  Parent (WhatsApp OTP — code is printed in the API log in development)
    Parent      9000000001                 (Aarav 9-A, Ananya 6-B)
    Student     9000000002                 (9-A roll 2)
`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
