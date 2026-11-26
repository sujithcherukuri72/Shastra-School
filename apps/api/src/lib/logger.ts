import { pino } from 'pino';
import { env } from '../config/env.ts';

// Personal data and credentials are never written to logs.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'shastra-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.otp',
      '*.token',
      '*.access_token',
    ],
    censor: '[redacted]',
  },
});

/** +919876543210 → +91******3210 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.length > 7 ? phone.slice(0, 3) + '*'.repeat(phone.length - 7) + phone.slice(-4) : '****';
}
