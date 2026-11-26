import type { NextFunction, Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env, isProd } from '../config/env.ts';
import { forbidden, unauthorized } from '../lib/http.ts';
import { safeEqual } from './crypto.ts';
import { type Role, SESSION_COOKIE, loadSession } from './sessions.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const appOrigin = new URL(env.APP_ORIGIN).origin;

/** Attach req.auth when a valid session cookie is present. */
export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const ctx = await loadSession(typeof token === 'string' ? token : undefined);
  if (ctx) req.auth = ctx;
  next();
}

/**
 * CSRF defence in depth for every state-changing request:
 *  1. Origin / Sec-Fetch-Site must be same-origin (blocks cross-site forms and fetches).
 *  2. Authenticated requests must echo the per-session CSRF token in X-CSRF-Token.
 * Webhooks are excluded and authenticate with HMAC signatures instead.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  if (origin && origin !== appOrigin) return next(forbidden('Cross-site request blocked'));
  if (!origin && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return next(forbidden('Cross-site request blocked'));
  }
  if (req.auth) {
    const header = req.get('x-csrf-token') ?? '';
    if (!safeEqual(header, req.auth.csrfToken)) return next(forbidden('Security token missing or expired. Please reload the page.'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.user.role)) return next(forbidden());
    next();
  };
}

/** No caching of authenticated API responses by browsers or proxies. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  next();
}

const limiter = (windowMs: number, limit: number, keyFn?: (req: Request) => string) =>
  rateLimit({
    windowMs,
    // Strict in production. Relaxed on a developer machine, where test suites sign in many times from one IP.
    limit: isProd ? limit : limit * 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyFn ?? ((req) => ipKeyGenerator(req.ip ?? '0.0.0.0')),
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

export const limits = {
  api: limiter(60_000, 600),
  login: limiter(15 * 60_000, 20),
  otpRequest: limiter(15 * 60_000, 10),
  otpVerify: limiter(15 * 60_000, 30),
  upload: limiter(60_000, 30),
  payment: limiter(60_000, 20),
};
