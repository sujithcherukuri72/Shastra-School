import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg = 'Invalid request', details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Please sign in') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Validate untrusted input. Unknown keys are rejected by the strict schemas used in routes. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Please check the highlighted fields',
      r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function errorHandler(log: { error: (o: object, m: string) => void }) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    const e = err as { type?: string; code?: string; status?: number };
    if (e?.type === 'entity.too.large') return void res.status(413).json({ error: 'Request is too large' });
    if (e?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Malformed JSON' });
    if (e?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: 'File is too large' });
    if (e?.code === 'LIMIT_UNEXPECTED_FILE') return void res.status(400).json({ error: 'Unexpected file field' });
    if (e?.code === '23505') return void res.status(409).json({ error: 'This record already exists' });
    if (e?.code === '23503') return void res.status(400).json({ error: 'A referenced record does not exist' });
    if (e?.code === '22P02') return void res.status(400).json({ error: 'Invalid identifier' });
    log.error({ err, path: req.path }, 'Unhandled error');
    // Never leak internals to clients.
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
}

// Reusable field schemas
export const id = z.coerce.number().int().positive();
export const uuid = z.uuid();
export const isoDate = z.iso.date();
export const phoneE164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (/^\d{10}$/.test(v) ? `+91${v}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number'));
export const text = (max: number) => z.string().trim().min(1).max(max);
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
