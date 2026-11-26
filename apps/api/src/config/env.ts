import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load the repo-root .env for local runs. In Docker, variables come from the environment.
const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    SCHOOL_NAME: z.string().min(1).default('Shastra The New Age School'),
    SCHOOL_SHORT_NAME: z.string().min(1).default('Shastra'),
    SCHOOL_CITY: z.string().default('Suryapet'),
    SCHOOL_PHONE: z.string().max(40).default(''),
    SCHOOL_ADDRESS: z.string().max(200).default(''),
    SCHOOL_TIMEZONE: z.string().default('Asia/Kolkata'),
    RECEIPT_PREFIX: z.string().regex(/^[A-Z0-9]{2,8}$/).default('SHS'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    APP_ORIGIN: z.url(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

    DATABASE_URL: z.string().startsWith('postgres'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters'),
    STAFF_SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    FAMILY_SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    UPLOAD_DIR: z.string().default('./storage'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(15),

    RUN_JOBS_IN_API: bool.default(true),
    BIRTHDAY_SEND_TIME: hhmm.default('08:00'),
    FEE_REMINDER_TIME: hhmm.default('09:00'),
    MONTHLY_REPORT_TIME: hhmm.default('10:00'),

    WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_APP_SECRET: z.string().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().default(''),
    WHATSAPP_TEMPLATE_LANG: z.string().default('en'),

    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  })
  .superRefine((e, ctx) => {
    const prod = e.NODE_ENV === 'production';
    const weak = /change-me|replace-with|CHANGE_ME/i;
    if (prod) {
      if (weak.test(e.SESSION_SECRET)) ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'Set a real random secret in production' });
      if (weak.test(e.MFA_ENCRYPTION_KEY) || e.MFA_ENCRYPTION_KEY === e.SESSION_SECRET) ctx.addIssue({ code: 'custom', path: ['MFA_ENCRYPTION_KEY'], message: 'Set a real random key (different from SESSION_SECRET) in production' });
      if (weak.test(e.DATABASE_URL)) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'Set a real database password in production' });
      if (!e.APP_ORIGIN.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'APP_ORIGIN must be https:// in production' });
      if (e.PAYMENT_PROVIDER === 'mock') ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'The mock payment provider is not allowed in production' });
    }
    if (e.WHATSAPP_PROVIDER === 'meta') {
      for (const k of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const) {
        if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when WHATSAPP_PROVIDER=meta` });
      }
    }
    if (e.PAYMENT_PROVIDER === 'razorpay') {
      for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when PAYMENT_PROVIDER=razorpay` });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: never boot with a broken or insecure configuration.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const uploadRoot = path.resolve(here, '../..', env.UPLOAD_DIR);
