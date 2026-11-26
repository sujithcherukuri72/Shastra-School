import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { q, q1, tx } from '../db/pool.ts';
import { enqueueWhatsApp } from '../jobs/outbox.ts';
import { badRequest, parse, phoneE164, unauthorized } from '../lib/http.ts';
import { logger, maskPhone } from '../lib/logger.ts';
import { audit } from '../security/audit.ts';
import { otpCode, safeEqual, serverHmac } from '../security/crypto.ts';
import { limits, requireAuth } from '../security/middleware.ts';
import { hashPassword, strongPassword, verifyPassword } from '../security/password.ts';
import { clearSessionCookies, createSession, destroyAllSessions, destroySession } from '../security/sessions.ts';
import QRCode from 'qrcode';
import { checkSecondFactor, decryptSecret, endChallenge, issueRecoveryCodes, loadChallenge, mfaStatus, requiresMfa, spendAttempt, startChallenge } from '../security/mfa.ts';
import { encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../security/totp.ts';

const r = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_S = 60;
const OTP_MAX_PER_HOUR = 5;

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect';

// ── Staff (and any account with a password): email + password ───────────────
r.post('/login', limits.login, async (req, res) => {
  const body = parse(z.strictObject({ email: z.email().max(200).transform((v) => v.toLowerCase()), password: z.string().min(1).max(200) }), req.body);
  const u = await q1('SELECT * FROM users WHERE email = $1', [body.email]);

  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    await verifyPassword(null, body.password); // equalise timing
    await audit(req, 'login.locked', 'user', u.id, {}, undefined, u.id);
    return void res.status(429).json({ error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
  }

  const ok = await verifyPassword(u?.password_hash, body.password);
  if (!u || !ok || !u.is_active || !u.password_hash) {
    if (u) {
      const fails = u.failed_logins + 1;
      await q(
        `UPDATE users SET failed_logins = $2::int,
                locked_until = CASE WHEN $3::boolean THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
          WHERE id = $1`,
        [u.id, fails >= MAX_FAILED ? 0 : fails, fails >= MAX_FAILED, String(LOCK_MINUTES)],
      );
      await audit(req, fails >= MAX_FAILED ? 'login.lockout' : 'login.failed', 'user', u.id, {}, undefined, u.id);
    }
    throw unauthorized(GENERIC_LOGIN_ERROR);
  }

  await q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  if (req.auth) await destroySession(req.auth.sessionId); // prevent session fixation

  // Principal and Office: the password alone never creates a session.
  if (requiresMfa(u.role)) {
    const step = await startChallenge(res, u);
    await audit(req, 'login.password_ok_mfa_pending', 'user', u.id, { step }, undefined, u.id);
    return void res.json({ ok: true, mfa: step });
  }

  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  await createSession(req, res, u);
  await audit(req, 'login.password', 'user', u.id, {}, undefined, u.id);
  res.json({ ok: true });
});

// ── Two-step login (Principal & Office) ─────────────────────────────────────
const mfaExpired = () => unauthorized('Your sign-in step expired. Please enter your email and password again.');

/** Enrolment: show the QR code for the authenticator app (secret saved only after a correct code). */
r.get('/mfa/setup', limits.otpVerify, async (req, res) => {
  const ch = await loadChallenge(req);
  if (!ch || ch.purpose !== 'enroll') throw mfaExpired();
  let secret: string;
  if (ch.pending_secret_enc) secret = decryptSecret(ch.pending_secret_enc);
  else {
    secret = newTotpSecret();
    await q('UPDATE mfa_challenges SET pending_secret_enc = $2 WHERE id = $1', [ch.id, encryptSecret(secret)]);
  }
  const u = await q1('SELECT email FROM users WHERE id = $1', [ch.user_id]);
  const uri = otpauthUri(secret, u!.email);
  res.json({ secret: secret.match(/.{1,4}/g)!.join(' '), otpauth: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' }) });
});

r.post('/mfa/enroll', limits.otpVerify, async (req, res) => {
  const { code } = parse(z.strictObject({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the app') }), req.body);
  const ch = await loadChallenge(req);
  if (!ch || ch.purpose !== 'enroll' || !ch.pending_secret_enc) throw mfaExpired();
  if (!(await spendAttempt(ch))) throw mfaExpired();
  const step = verifyTotp(decryptSecret(ch.pending_secret_enc), code, null);
  if (step == null) throw badRequest('That code did not match. Check the time on your phone is automatic and try the newest code.');
  const u = await q1('SELECT id, role FROM users WHERE id = $1 AND is_active', [ch.user_id]);
  if (!u) throw mfaExpired();
  const codes = await tx(async (db) => {
    await q('UPDATE users SET totp_secret_enc = $2, totp_enabled_at = now(), totp_last_step = $3, last_login_at = now() WHERE id = $1', [u.id, ch.pending_secret_enc, step], db);
    return issueRecoveryCodes(u.id, db);
  });
  await endChallenge(res, ch);
  await createSession(req, res, u);
  await audit(req, 'mfa.enrolled', 'user', u.id, {}, undefined, u.id);
  res.json({ ok: true, recoveryCodes: codes });
});

r.post('/mfa/verify', limits.otpVerify, async (req, res) => {
  const { code } = parse(z.strictObject({ code: z.string().trim().min(6).max(12) }), req.body);
  const ch = await loadChallenge(req);
  if (!ch || ch.purpose !== 'verify') throw mfaExpired();
  if (!(await spendAttempt(ch))) {
    await audit(req, 'mfa.too_many_attempts', 'user', ch.user_id, {}, undefined, ch.user_id);
    throw mfaExpired();
  }
  const how = await tx((db) => checkSecondFactor(ch.user_id, code, db));
  if (!how) {
    await audit(req, 'mfa.failed', 'user', ch.user_id, {}, undefined, ch.user_id);
    throw badRequest('That code is not correct. Use the newest 6-digit code from your authenticator app.');
  }
  const u = await q1('SELECT id, role FROM users WHERE id = $1 AND is_active', [ch.user_id]);
  if (!u) throw mfaExpired();
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  await endChallenge(res, ch);
  await createSession(req, res, u);
  await audit(req, how === 'recovery' ? 'login.mfa_recovery_code' : 'login.mfa', 'user', u.id, {}, undefined, u.id);
  res.json({ ok: true, usedRecoveryCode: how === 'recovery' });
});

/** Signed-in Principal/Office: replace recovery codes (needs a current authenticator code). */
r.post('/mfa/recovery-codes', requireAuth, limits.otpVerify, async (req, res) => {
  const { code } = parse(z.strictObject({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the app') }), req.body);
  const how = await tx((db) => checkSecondFactor(req.auth!.user.id, code, db));
  if (how !== 'totp') throw badRequest('That code is not correct');
  const codes = await issueRecoveryCodes(req.auth!.user.id);
  await audit(req, 'mfa.recovery_codes_regenerated', 'user', req.auth!.user.id);
  res.json({ recoveryCodes: codes });
});

// ── Parents & students: one-time code on WhatsApp ───────────────────────────
const otpHash = (phone: string, code: string) => serverHmac(`otp:${phone}:${code}`);

r.post('/otp/request', limits.otpRequest, async (req, res) => {
  const { phone } = parse(z.strictObject({ phone: phoneE164 }), req.body);
  // Always the same response, so the endpoint cannot be used to discover registered numbers.
  const reply = () => res.json({ ok: true, message: 'If this number is registered with the school, a login code has been sent on WhatsApp.' });

  const u = await q1(`SELECT id FROM users WHERE phone = $1 AND is_active AND role IN ('parent','student')`, [phone]);
  if (!u) return void reply();

  const recent = await q1(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_hour,
            MAX(created_at) AS latest FROM otp_challenges WHERE phone = $1`,
    [phone],
  );
  if (recent?.latest && Date.now() - new Date(recent.latest).getTime() < OTP_COOLDOWN_S * 1000) return void reply();
  if (Number(recent?.last_hour ?? 0) >= OTP_MAX_PER_HOUR) return void reply();

  const code = otpCode();
  await tx(async (db) => {
    await q(`UPDATE otp_challenges SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL`, [phone], db);
    await q(
      `INSERT INTO otp_challenges (phone, code_hash, expires_at, ip) VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
      [phone, otpHash(phone, code), String(OTP_TTL_MIN), req.ip ?? null],
      db,
    );
    await enqueueWhatsApp({ kind: 'otp', to: phone, template: 'login_otp', params: [code], recipientUserId: u.id }, db);
  });
  logger.info({ phone: maskPhone(phone) }, 'OTP issued');
  reply();
});

r.post('/otp/verify', limits.otpVerify, async (req, res) => {
  const body = parse(z.strictObject({ phone: phoneE164, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }), req.body);
  const invalid = () => badRequest('This code is incorrect or has expired. Please request a new one.');

  const ch = await q1(
    `UPDATE otp_challenges SET attempts = attempts + 1
      WHERE id = (SELECT id FROM otp_challenges WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
                  ORDER BY created_at DESC LIMIT 1)
      RETURNING id, code_hash, attempts`,
    [body.phone],
  );
  if (!ch) throw invalid();
  if (ch.attempts > OTP_MAX_ATTEMPTS) {
    await q('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
    throw invalid();
  }
  if (!safeEqual(ch.code_hash, otpHash(body.phone, body.code))) throw invalid();

  const consumed = await q1('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [ch.id]);
  if (!consumed) throw invalid(); // lost a race with a parallel request

  const u = await q1(`SELECT id, role FROM users WHERE phone = $1 AND is_active AND role IN ('parent','student')`, [body.phone]);
  if (!u) throw invalid();
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  if (req.auth) await destroySession(req.auth.sessionId);
  await createSession(req, res, u);
  await audit(req, 'login.otp', 'user', u.id, {}, undefined, u.id);
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => {
  if (req.auth) {
    await destroySession(req.auth.sessionId);
    await audit(req, 'logout', 'user', req.auth.user.id);
  }
  clearSessionCookies(res);
  res.json({ ok: true });
});

r.post('/logout-everywhere', requireAuth, async (req, res) => {
  await destroyAllSessions(req.auth!.user.id);
  await audit(req, 'logout.all', 'user', req.auth!.user.id);
  clearSessionCookies(res);
  res.json({ ok: true });
});

/** Like /me but answers 200 with { user: null } when signed out (used by the app on start-up). */
r.get('/session', async (req, res, next) => {
  if (!req.auth) return void res.json({ user: null });
  return me(req, res, next);
});

r.get('/me', requireAuth, (req, res, next) => me(req, res, next));

async function me(req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) {
  const a = req.auth!;
  const out: Record<string, unknown> = {
    user: a.user,
    csrfToken: a.csrfToken,
    school: { name: env.SCHOOL_NAME, shortName: env.SCHOOL_SHORT_NAME, city: env.SCHOOL_CITY },
    payments: { provider: env.PAYMENT_PROVIDER, keyId: env.PAYMENT_PROVIDER === 'razorpay' ? env.RAZORPAY_KEY_ID : null },
  };
  if (requiresMfa(a.user.role)) out.mfa = await mfaStatus(a.user.id);
  if (a.user.role === 'parent' || a.user.role === 'student') {
    out.children = await q(
      `SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.dob, sec.id AS section_id, sec.name AS section_name,
              c.id AS class_id, c.name AS class_name
         FROM students s
         LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
        WHERE s.status = 'active' AND (s.user_id = $1 OR s.id IN (SELECT student_id FROM guardians WHERE user_id = $1))
        ORDER BY s.full_name`,
      [a.user.id],
    );
  }
  if (a.user.role === 'teacher' || a.user.role === 'principal') {
    out.classTeacherOf = await q(
      `SELECT sec.id AS section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name
         FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE sec.class_teacher_id = $1 ORDER BY c.sort_order, sec.name`,
      [a.user.id],
    );
    out.teaches = await q(
      `SELECT ta.section_id, sec.name AS section_name, c.id AS class_id, c.name AS class_name, sub.id AS subject_id, sub.name AS subject_name
         FROM teaching_assignments ta JOIN sections sec ON sec.id = ta.section_id JOIN classes c ON c.id = sec.class_id
         JOIN subjects sub ON sub.id = ta.subject_id
        WHERE ta.teacher_id = $1 ORDER BY c.sort_order, sec.name, sub.name`,
      [a.user.id],
    );
  }
  res.json(out);
}

r.post('/password', requireAuth, limits.login, async (req, res) => {
  const body = parse(z.strictObject({ currentPassword: z.string().max(200), newPassword: strongPassword }), req.body);
  const u = await q1('SELECT password_hash FROM users WHERE id = $1', [req.auth!.user.id]);
  if (u?.password_hash && !(await verifyPassword(u.password_hash, body.currentPassword))) {
    throw badRequest('Your current password is incorrect');
  }
  await q('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.auth!.user.id, await hashPassword(body.newPassword)]);
  await destroyAllSessions(req.auth!.user.id, req.auth!.sessionId); // sign out other devices
  await audit(req, 'password.changed', 'user', req.auth!.user.id);
  res.json({ ok: true });
});

export default r;
