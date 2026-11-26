import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.ts';

/** 256-bit URL-safe random token. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest();
export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

/** Keyed hash with the server secret (used for OTP codes so a DB leak does not reveal them). */
export const serverHmac = (data: string) => hmac(env.SESSION_SECRET, data);

/** Constant-time comparison for secrets of any length. */
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly constant
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Uniform 6-digit code from a CSPRNG. */
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
