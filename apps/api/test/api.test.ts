import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, clone, close, db, family, nextCode, PASSWORD, staff, totp } from './helpers.ts';

let principal: Client, office: Client, teacher: Client, parent: Client;
let aarav: string, otherStudent: string, sec9A: number, sec9B: number;

before(async () => {
  // Reset the lockout state the tests below create.
  await db.q(`UPDATE users SET failed_logins = 0, locked_until = NULL`);
  // Start from 'not enrolled' so the enrolment path is exercised every run.
  await db.q(`UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE role IN ('principal','office')`);
  principal = await staff('principal@shastra.school');
  office = await staff('office@shastra.school');
  teacher = await staff('teacher@shastra.school');
  parent = await family('9000000001');
  aarav = (await db.q1(`SELECT id FROM students WHERE full_name = 'Aarav Reddy'`)).id;
  otherStudent = (await db.q1(`SELECT id FROM students WHERE id NOT IN (SELECT student_id FROM guardians g JOIN users u ON u.id = g.user_id WHERE u.phone = '+919000000001') LIMIT 1`)).id;
  sec9A = (await db.q1(`SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.grade = 9 AND s.name = 'A'`)).id;
  sec9B = (await db.q1(`SELECT s.id FROM sections s JOIN classes c ON c.id = s.class_id WHERE c.grade = 9 AND s.name = 'B'`)).id;
});
after(async () => {
  // Leave the demo Principal/Office ready for a person to set up two-step login with their own phone.
  await db.q(`UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE role IN ('principal','office')`);
  await db.q(`DELETE FROM mfa_recovery_codes`);
  await close();
});

describe('authentication', () => {
  test('protected endpoints require a session', async () => {
    const r = await new Client().get('/api/dashboard/principal');
    assert.equal(r.status, 401);
  });

  test('session cookie is HttpOnly + SameSite and never readable by scripts', async () => {
    const c = new Client();
    const r = await c.req('POST', '/api/auth/login', { email: 'suma.latha@shastra.school', password: PASSWORD });
    const sc = r.headers.getSetCookie().find((x) => x.startsWith('sc_sid='))!;
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Lax/i);
  });

  test('wrong password gives a generic error and locks after 5 attempts', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/login', { email: 'kiran.chary@shastra.school', password: 'wrong-password-1' });
      assert.equal(r.status, 401);
      assert.equal(r.data.error, 'Email or password is incorrect');
    }
    const locked = await c.post('/api/auth/login', { email: 'kiran.chary@shastra.school', password: PASSWORD });
    assert.equal(locked.status, 429);
    await db.q(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = 'kiran.chary@shastra.school'`);
  });

  test('unknown email gets the same response as a wrong password', async () => {
    const r = await new Client().post('/api/auth/login', { email: 'nobody@shastra.school', password: 'whatever-123' });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'Email or password is incorrect');
  });

  test('OTP request does not reveal whether a number is registered', async () => {
    const a = await new Client().post('/api/auth/otp/request', { phone: '9999999999' });
    const b = await new Client().post('/api/auth/otp/request', { phone: '9000000002' });
    assert.equal(a.status, 200);
    assert.deepEqual(a.data, b.data);
  });

  test('wrong OTP is rejected and OTP codes are stored only as HMACs', async () => {
    const r = await new Client().post('/api/auth/otp/verify', { phone: '9000000002', code: '000000' });
    assert.equal(r.status, 400);
    const row = await db.q1(`SELECT code_hash FROM otp_challenges WHERE phone = '+919000000002' ORDER BY created_at DESC LIMIT 1`);
    assert.equal(row.code_hash.length, 32);
  });

  test('logout destroys the session server-side', async () => {
    const c = await staff('suma.latha@shastra.school');
    const stolen = new Map(c.cookies);
    await c.post('/api/auth/logout');
    const replay = new Client();
    replay.cookies = stolen;
    assert.equal((await replay.get('/api/auth/me')).status, 401);
  });
});

describe('two-step login (Principal & Office)', () => {
  test('a correct password alone does not create a session', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/login', { email: 'principal@shastra.school', password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.data.mfa, 'verify');
    assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await c.get('/api/dashboard/principal')).status, 401);
  });

  test('wrong codes are rejected and the challenge dies after 5 attempts', async () => {
    const c = new Client();
    await c.post('/api/auth/login', { email: 'office@shastra.school', password: PASSWORD });
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/mfa/verify', { code: '000000' })).status, 400);
    const sixth = await c.post('/api/auth/mfa/verify', { code: await nextCode('office@shastra.school') });
    assert.equal(sixth.status, 401); // must start again with the password
  });

  test('a code cannot be used twice (replay protection)', async () => {
    const code = await nextCode('office@shastra.school');
    const a = new Client();
    await a.post('/api/auth/login', { email: 'office@shastra.school', password: PASSWORD });
    assert.equal((await a.post('/api/auth/mfa/verify', { code })).status, 200);
    const b = new Client();
    await b.post('/api/auth/login', { email: 'office@shastra.school', password: PASSWORD });
    assert.equal((await b.post('/api/auth/mfa/verify', { code })).status, 400);
  });

  test('recovery codes work exactly once, and secrets are stored encrypted', async () => {
    const r = await principal.post('/api/auth/mfa/recovery-codes', { code: await nextCode('principal@shastra.school') });
    assert.equal(r.status, 200);
    assert.equal(r.data.recoveryCodes.length, 10);
    const rc = r.data.recoveryCodes[0];
    for (const expected of [200, 400]) {
      const c = new Client();
      await c.post('/api/auth/login', { email: 'principal@shastra.school', password: PASSWORD });
      assert.equal((await c.post('/api/auth/mfa/verify', { code: rc })).status, expected);
    }
    const row = await db.q1(`SELECT totp_secret_enc FROM users WHERE email = 'principal@shastra.school'`);
    assert.match(row.totp_secret_enc, /^v1\./);
    assert.ok(totp.decryptSecret(row.totp_secret_enc).length >= 32);
  });

  test('the Principal can reset two-step login for the Office; teachers cannot', async () => {
    const officeUser = await db.q1(`SELECT id FROM users WHERE email = 'office@shastra.school'`);
    const t = await staff('suma.latha@shastra.school');
    assert.equal((await t.req('PATCH', `/api/school/staff/${officeUser.id}`, { reset_mfa: true })).status, 403);
    assert.equal((await principal.req('PATCH', `/api/school/staff/${officeUser.id}`, { reset_mfa: true })).status, 200);
    const c = new Client();
    const r = await c.post('/api/auth/login', { email: 'office@shastra.school', password: PASSWORD });
    assert.equal(r.data.mfa, 'enroll');
    office = await staff('office@shastra.school'); // the reset signed the Office out everywhere
  });
});
describe('CSRF', () => {
  test('state-changing request without the CSRF header is rejected', async () => {
    const c = clone(principal);
    c.csrf = false;
    const r = await c.post('/api/notices', { title: 'x', body: 'y' });
    assert.equal(r.status, 403);
  });

  test('cross-origin request is rejected even with a valid session', async () => {
    const c = clone(principal);
    c.origin = 'https://evil.example';
    const r = await c.post('/api/notices', { title: 'x', body: 'y' });
    assert.equal(r.status, 403);
  });
});

describe('authorisation (object level)', () => {
  test("a parent cannot read another family's child", async () => {
    for (const path of [`/api/students/${otherStudent}`, `/api/fees/students/${otherStudent}`, `/api/attendance/student/${otherStudent}`, `/api/academics/students/${otherStudent}/performance`]) {
      const r = await parent.get(path);
      assert.equal(r.status, 403, path);
    }
  });

  test('a parent can read their own child', async () => {
    const r = await parent.get(`/api/dashboard/family/${aarav}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.student.full_name, 'Aarav Reddy');
  });

  test('parents and teachers cannot see birthday wishes or the message log', async () => {
    for (const c of [parent, teacher]) {
      assert.equal((await c.get('/api/birthdays')).status, 403);
      assert.equal((await c.get('/api/messages')).status, 403);
    }
    assert.equal((await office.get('/api/birthdays')).status, 200);
  });

  test('a teacher cannot mark attendance for a section they are not class teacher of', async () => {
    const r = await teacher.put(`/api/attendance/section/${sec9B}`, { date: new Date().toISOString().slice(0, 10) });
    assert.equal(r.status, 403);
  });

  test('only the office/principal can record fee payments', async () => {
    const r = await teacher.post('/api/fees/payments', { student_id: aarav, fee_item_ids: [], method: 'cash' });
    assert.equal(r.status, 403);
  });

  test('unknown fields are rejected (mass-assignment protection)', async () => {
    const r = await principal.post('/api/notices', { title: 'Hello', body: 'World', created_by: '00000000-0000-0000-0000-000000000000' });
    assert.equal(r.status, 400);
  });
});

describe('school flows', () => {
  test('marking absent queues exactly one WhatsApp alert per guardian per day', async () => {
    const reg = await teacher.get(`/api/attendance/section/${sec9A}`);
    assert.equal(reg.status, 200);
    const target = reg.data.students.find((s: any) => s.full_name === 'Aarav Reddy').id;
    await db.q(`DELETE FROM attendance WHERE student_id = $1 AND day = $2`, [target, reg.data.day]);
    await db.q(`DELETE FROM wa_messages WHERE dedupe_key LIKE $1`, [`absence:${target}:%`]);
    for (let i = 0; i < 2; i++) {
      const r = await teacher.put(`/api/attendance/section/${sec9A}`, { date: reg.data.day, absent: [target] });
      assert.equal(r.status, 200);
    }
    const msgs = await db.q(`SELECT * FROM wa_messages WHERE kind = 'absence' AND student_id = $1 AND dedupe_key LIKE $2`, [target, `absence:${target}:${reg.data.day}%`]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].preview, /Aarav Reddy was marked absent/);
  });

  test('marks above the maximum are rejected', async () => {
    const me = await teacher.get('/api/auth/me');
    const t = me.data.teaches.find((x: any) => x.class_name === 'Class 9');
    const exam = await db.q1(`SELECT id, max_marks FROM exams WHERE class_id = $1 AND published_at IS NULL LIMIT 1`, [t.class_id]);
    const sheet = await teacher.get(`/api/academics/marks/sheet?exam_id=${exam.id}&section_id=${t.section_id}&subject_id=${t.subject_id}`);
    assert.equal(sheet.status, 200);
    const sid = sheet.data.rows[0].student_id;
    const bad = await teacher.put('/api/academics/marks/sheet', { exam_id: exam.id, section_id: t.section_id, subject_id: t.subject_id, entries: [{ student_id: sid, marks: exam.max_marks + 1 }] });
    assert.equal(bad.status, 400);
    const ok = await teacher.put('/api/academics/marks/sheet', { exam_id: exam.id, section_id: t.section_id, subject_id: t.subject_id, entries: [{ student_id: sid, marks: 20 }] });
    assert.equal(ok.status, 200);
  });

  test('online fee payment: server decides the amount and issues a receipt', async () => {
    await db.q(`
      INSERT INTO fee_items (student_id, academic_year_id, term, title, amount, due_on)
      SELECT $1, (SELECT id FROM academic_years WHERE is_current), 'Test term', 'Test fee ' || now()::text, 1500, CURRENT_DATE + 10`, [aarav]);
    const ledger = await parent.get(`/api/fees/students/${aarav}`);
    const due = ledger.data.items.find((i: any) => i.balance > 0);
    assert.ok(due, 'demo child should have a fee due');
    const order = await parent.post('/api/fees/online/orders', { student_id: aarav, fee_item_ids: [due.id] });
    assert.equal(order.status, 201);
    assert.equal(order.data.amount, due.balance);
    const verify = await parent.post('/api/fees/online/verify', { order_id: order.data.order_id });
    assert.equal(verify.status, 200);
    assert.match(verify.data.receipt_no, /^SHS\//);
    const again = await parent.post('/api/fees/online/orders', { student_id: aarav, fee_item_ids: [due.id] });
    assert.equal(again.status, 409); // already paid
    const pdf = await parent.get(`/api/fees/payments/${verify.data.payment_id}/receipt.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  });

  test('uploads are checked by content, not by file name', async () => {
    const me = await teacher.get('/api/auth/me');
    const t = me.data.teaches[0];
    const form = new FormData();
    form.append('section_id', String(t.section_id));
    form.append('subject_id', String(t.subject_id));
    form.append('title', 'Malicious upload test');
    form.append('due_on', new Date().toISOString().slice(0, 10));
    form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'homework.pdf');
    const r = await teacher.req('POST', '/api/homework', form);
    assert.equal(r.status, 400);
  });

  test('file downloads are authorised per family', async () => {
    const sheet = await db.q1(`SELECT a.file_id FROM answer_sheets a JOIN students s ON s.id = a.student_id WHERE s.full_name = 'Aarav Reddy'`);
    assert.equal((await parent.get(`/api/files/${sheet.file_id}`)).status, 200);
    const stranger = await family('9000000002'); // the 9-A roll 2 student
    assert.equal((await stranger.get(`/api/files/${sheet.file_id}`)).status, 404);
  });

  test('principal dashboard and report card PDF render', async () => {
    const d = await principal.get('/api/dashboard/principal');
    assert.equal(d.status, 200);
    assert.ok(d.data.trend.length > 0);
    assert.ok(d.data.heatmap.length > 0);
    const pdf = await parent.get(`/api/academics/students/${aarav}/report-card.pdf`);
    assert.equal(pdf.status, 200);
    assert.ok((pdf.data as ArrayBuffer).byteLength > 1000);
  });
});
