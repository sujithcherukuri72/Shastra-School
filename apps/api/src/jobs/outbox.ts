import { env } from '../config/env.ts';
import { type Db, pool, q, q1 } from '../db/pool.ts';
import { readStoredFile } from '../lib/files.ts';
import { logger } from '../lib/logger.ts';
import { type TemplateName, renderPreview, whatsapp } from './whatsapp.ts';

export type WaKind = 'absence' | 'fee_reminder' | 'monthly_report' | 'notice' | 'birthday' | 'otp' | 'payment_receipt';

export interface Enqueue {
  kind: WaKind;
  to: string;
  template: TemplateName;
  params: string[];
  dedupeKey?: string;
  studentId?: string | null;
  recipientUserId?: string | null;
  documentFileId?: string | null;
}

/**
 * Queue a WhatsApp message (transactional outbox). Call inside the same DB transaction as the
 * business change so a message is queued if and only if the change commits.
 * A repeated dedupeKey is ignored, which makes every automatic message exactly-once.
 */
export async function enqueueWhatsApp(m: Enqueue, db: Db = pool) {
  await q(
    `INSERT INTO wa_messages (kind, to_phone, template, lang, params, preview, dedupe_key, student_id, recipient_user_id, document_file_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      m.kind, m.to, m.template, env.WHATSAPP_TEMPLATE_LANG, JSON.stringify(m.params),
      m.kind === 'otp' ? 'Login code (hidden)' : renderPreview(m.template, m.params),
      m.dedupeKey ?? null, m.studentId ?? null, m.recipientUserId ?? null, m.documentFileId ?? null,
    ],
    db,
  );
}

const MAX_ATTEMPTS = 5;

/** Claim and send a batch. Safe to run from several workers (FOR UPDATE SKIP LOCKED). */
export async function processOutbox(batch = 20): Promise<number> {
  const claimed = await q(
    `UPDATE wa_messages SET status = 'sending', attempts = attempts + 1, updated_at = now()
      WHERE id IN (SELECT id FROM wa_messages
                    WHERE status = 'queued' AND next_attempt_at <= now()
                    ORDER BY CASE WHEN kind = 'otp' THEN 0 ELSE 1 END, created_at
                    FOR UPDATE SKIP LOCKED LIMIT $1)
      RETURNING *`,
    [batch],
  );
  for (const m of claimed) {
    try {
      let document: { buffer: Buffer; filename: string; mime: string } | undefined;
      if (m.document_file_id) {
        const f = await q1('SELECT storage_key, original_name, mime FROM files WHERE id = $1', [m.document_file_id]);
        if (f) document = { buffer: await readStoredFile(f.storage_key), filename: f.original_name, mime: f.mime };
      }
      const r = await whatsapp.send({ to: m.to_phone, template: m.template, lang: m.lang, params: m.params, document });
      await q(
        `UPDATE wa_messages SET status = $2, provider_message_id = $3, last_error = NULL, updated_at = now(),
                params = CASE WHEN kind = 'otp' THEN '[]'::jsonb ELSE params END
          WHERE id = $1`,
        [m.id, r.status, r.providerMessageId],
      );
    } catch (err) {
      const e = err as Error & { retryable?: boolean };
      const final = m.attempts >= MAX_ATTEMPTS || e.retryable === false;
      logger.warn({ err: e.message, id: m.id, attempts: m.attempts }, 'WhatsApp send failed');
      await q(
        `UPDATE wa_messages SET status = $2, last_error = $3, updated_at = now(),
                next_attempt_at = now() + ($4 || ' seconds')::interval
          WHERE id = $1`,
        [m.id, final ? 'failed' : 'queued', e.message.slice(0, 500), String(30 * 2 ** m.attempts)],
      );
    }
  }
  return claimed.length;
}

/** Status callbacks from the provider only ever move a message forward. */
const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
export async function applyDeliveryStatus(providerMessageId: string, status: string, error?: string) {
  if (!(status in RANK)) return;
  const row = await q1('SELECT id, status FROM wa_messages WHERE provider_message_id = $1', [providerMessageId]);
  if (!row) return;
  if (status !== 'failed' && RANK[status]! <= RANK[row.status]!) return;
  await q('UPDATE wa_messages SET status = $2, last_error = COALESCE($3, last_error), updated_at = now() WHERE id = $1', [
    row.id,
    status,
    error ?? null,
  ]);
}
