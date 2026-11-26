import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// Argon2id with OWASP-recommended parameters (m=19 MiB, t=2, p=1) — the library defaults.
export const hashPassword = (password: string) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

// Used when a user does not exist, so failed logins take the same time either way.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing-equalisation');

export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  try {
    return await verify(stored || DUMMY_HASH, password);
  } catch {
    return false;
  }
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123',
  'iloveyou', 'admin123', 'welcome1', 'shastra123', 'school123', 'teacher123', 'principal1',
]);

export const strongPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'This password is too common')
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Use letters and numbers');
