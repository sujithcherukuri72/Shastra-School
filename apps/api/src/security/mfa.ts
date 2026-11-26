import type { Request, Response } from 'express';
import { isProd } from '../config/env.ts';
import { type Db, pool, q, q1 } from '../db/pool.ts';
import { randomToken, sha256 } from './crypto.ts';
import type { Role } from './sessions.ts';
import { decryptSecret, newRecoveryCodes, normaliseRecovery, verifyTotp } from './totp.ts';

/** Roles that must use two-step login. */
export const MFA_ROLES: Role[] = ['principal', 'office'];
export const requiresMfa = (role: Role) => MFA_ROLES.includes(role);

export const MFA_COOKIE = isProd ? '__Host-sc_mfa' : 'sc_mfa';
const CHALLENGE_MINUTES = 10;
export const MFA_MAX_ATTEMPTS = 5;

const cookieOpts = () => ({ httpOnly: true, secure: isProd, sameSite: 'strict' as const, path: '/' });

/** Password was correct: start the second step. Returns which step the user must complete. */
export async function startChallenge(res: Response, user: { id: string; totp_secret_enc: string | null }) {
  const token = randomToken(32);
  const purpose = user.totp_secret_enc ? 'verify' : 'enroll';
  await q('DELETE FROM mfa_challenges WHERE user_id = $1 OR expires_at < now()', [user.id]);
  await q(
    `INSERT INTO mfa_challenges (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [user.id, sha256(token), purpose, String(CHALLENGE_MINUTES)],
  );
  res.cookie(MFA_COOKIE, token, { ...cookieOpts(), maxAge: CHALLENGE_MINUTES * 60_000 });
  return purpose as 'verify' | 'enroll';
}

export interface Challenge {
  id: string;
  user_id: string;
  purpose: 'verify' | 'enroll';
  pending_secret_enc: string | null;
  attempts: number;
}

export async function loadChallenge(req: Request): Promise<Challenge | null> {
  const token = req.cookies?.[MFA_COOKIE];
  if (typeof token !== 'string' || token.length > 100) return null;
  return (await q1<Challenge>(
    `SELECT id, user_id, purpose, pending_secret_enc, attempts FROM mfa_challenges WHERE token_hash = $1 AND expires_at > now()`,
    [sha256(token)],
  )) ?? null;
}

/** Counts an attempt; returns false once the limit is reached (the challenge is then deleted). */
export async function spendAttempt(ch: Challenge) {
  const r = await q1('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [ch.id]);
  if (!r || r.attempts > MFA_MAX_ATTEMPTS) {
    await q('DELETE FROM mfa_challenges WHERE id = $1', [ch.id]);
    return false;
  }
  return true;
}

export async function endChallenge(res: Response, ch: Challenge) {
  await q('DELETE FROM mfa_challenges WHERE id = $1', [ch.id]);
  res.clearCookie(MFA_COOKIE, cookieOpts());
}

/** Check a 6-digit authenticator code (with replay protection) or a one-time recovery code. */
export async function checkSecondFactor(userId: string, code: string, db: Db = pool): Promise<'totp' | 'recovery' | null> {
  const u = await q1('SELECT totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE', [userId], db);
  if (!u?.totp_secret_enc) return null;
  const clean = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(u.totp_secret_enc), clean, u.totp_last_step == null ? null : Number(u.totp_last_step));
    if (step == null) return null;
    await q('UPDATE users SET totp_last_step = $2 WHERE id = $1', [userId, step], db);
    return 'totp';
  }
  const norm = normaliseRecovery(clean);
  if (norm.length !== 8) return null;
  const used = await q1(
    `UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
    [userId, sha256(norm)],
    db,
  );
  return used ? 'recovery' : null;
}

/** Replace all recovery codes; returns the new plain codes (shown to the user once). */
export async function issueRecoveryCodes(userId: string, db: Db = pool) {
  const codes = newRecoveryCodes(10);
  await q('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId], db);
  for (const c of codes) await q('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, sha256(normaliseRecovery(c))], db);
  return codes;
}

export async function mfaStatus(userId: string) {
  const r = await q1(
    `SELECT u.totp_enabled_at, (SELECT COUNT(*) FROM mfa_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL) AS recovery_left
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  return { enabled: !!r?.totp_enabled_at, enabled_at: r?.totp_enabled_at ?? null, recovery_left: Number(r?.recovery_left ?? 0) };
}

export async function resetMfa(userId: string, db: Db = pool) {
  await q('UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1', [userId], db);
  await q('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId], db);
  await q('DELETE FROM mfa_challenges WHERE user_id = $1', [userId], db);
}

export { decryptSecret };
