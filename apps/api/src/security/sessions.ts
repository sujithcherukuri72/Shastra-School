import type { CookieOptions, Request, Response } from 'express';
import { env, isProd } from '../config/env.ts';
import { pool, q, q1 } from '../db/pool.ts';
import { randomToken, sha256 } from './crypto.ts';

export type Role = 'principal' | 'office' | 'teacher' | 'parent' | 'student';

export interface AuthUser {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
}
export interface AuthCtx {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
}

// The __Host- prefix forces Secure, Path=/ and no Domain — the cookie cannot be set by subdomains.
export const SESSION_COOKIE = isProd ? '__Host-sc_sid' : 'sc_sid';
export const CSRF_COOKIE = isProd ? '__Host-sc_csrf' : 'sc_csrf';

const STAFF: Role[] = ['principal', 'office', 'teacher'];
const lifetimeMs = (role: Role) =>
  STAFF.includes(role) ? env.STAFF_SESSION_HOURS * 3600_000 : env.FAMILY_SESSION_DAYS * 86400_000;

const baseCookie = (): CookieOptions => ({
  secure: isProd || env.APP_ORIGIN.startsWith('https://'),
  sameSite: 'lax',
  path: '/',
});

export async function createSession(req: Request, res: Response, user: { id: string; role: Role }) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const ttl = lifetimeMs(user.role);
  await q(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6)`,
    [user.id, sha256(token), csrf, String(ttl), req.ip ?? null, (req.get('user-agent') ?? '').slice(0, 300)],
  );
  // Housekeeping: drop this user's expired sessions and cap concurrent sessions at 10.
  await q(
    `DELETE FROM sessions WHERE user_id = $1 AND (expires_at < now() OR id NOT IN (
       SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10))`,
    [user.id],
  );
  setSessionCookies(res, token, csrf, ttl);
}

export function setSessionCookies(res: Response, token: string, csrf: string, ttlMs: number) {
  res.cookie(SESSION_COOKIE, token, { ...baseCookie(), httpOnly: true, maxAge: ttlMs });
  // Readable by the SPA so it can echo it in the X-CSRF-Token header (double-submit, bound to session).
  res.cookie(CSRF_COOKIE, csrf, { ...baseCookie(), httpOnly: false, maxAge: ttlMs });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...baseCookie(), httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...baseCookie() });
}

export async function loadSession(token: string | undefined): Promise<AuthCtx | null> {
  if (!token || token.length > 100) return null;
  const row = await q1(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at,
            u.id, u.role, u.full_name, u.email, u.phone
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [sha256(token)],
  );
  if (!row) return null;
  // Throttle "last seen" writes to once per 5 minutes.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    pool.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(() => {});
  }
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    user: { id: row.id, role: row.role, full_name: row.full_name, email: row.email, phone: row.phone },
  };
}

export const destroySession = (sessionId: string) => q('DELETE FROM sessions WHERE id = $1', [sessionId]);
export const destroyAllSessions = (userId: string, exceptSessionId?: string) =>
  q('DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, exceptSessionId ?? null]);
