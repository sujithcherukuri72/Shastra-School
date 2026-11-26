import { type Db, pool, q } from '../db/pool.ts';
import { type Enqueue, enqueueWhatsApp } from '../jobs/outbox.ts';

interface InApp {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** In-app notification to every guardian (and the student login, if any) of the given students. */
export async function notifyFamilies(studentIds: string[], n: InApp, db: Db = pool) {
  if (!studentIds.length) return;
  await q(
    `INSERT INTO notifications (user_id, student_id, kind, title, body, link)
     SELECT r.user_id, r.student_id, $2, $3, $4, $5 FROM (
       SELECT g.user_id, g.student_id FROM guardians g WHERE g.student_id = ANY($1::uuid[])
       UNION SELECT s.user_id, s.id FROM students s WHERE s.id = ANY($1::uuid[]) AND s.user_id IS NOT NULL
     ) r`,
    [studentIds, n.kind, n.title, n.body ?? null, n.link ?? null],
    db,
  );
}

export async function notifyUsers(userIds: string[], n: InApp, db: Db = pool) {
  if (!userIds.length) return;
  await q(
    `INSERT INTO notifications (user_id, kind, title, body, link)
     SELECT u, $2, $3, $4, $5 FROM unnest($1::uuid[]) u`,
    [userIds, n.kind, n.title, n.body ?? null, n.link ?? null],
    db,
  );
}

export interface GuardianContact {
  student_id: string;
  student_name: string;
  user_id: string;
  phone: string;
}

/** Guardians who opted in to WhatsApp and have a phone number. */
export async function whatsappGuardians(studentIds: string[], db: Db = pool): Promise<GuardianContact[]> {
  if (!studentIds.length) return [];
  return q<GuardianContact>(
    `SELECT g.student_id, s.full_name AS student_name, u.id AS user_id, u.phone
       FROM guardians g JOIN users u ON u.id = g.user_id JOIN students s ON s.id = g.student_id
      WHERE g.student_id = ANY($1::uuid[]) AND g.whatsapp_opt_in AND u.is_active AND u.phone IS NOT NULL`,
    [studentIds],
    db,
  );
}

/** Queue one WhatsApp per opted-in guardian; dedupe key is suffixed per recipient. */
export async function whatsappFamilies(
  studentIds: string[],
  build: (g: GuardianContact) => Omit<Enqueue, 'to' | 'recipientUserId' | 'studentId'> & { dedupeKey: string },
  db: Db = pool,
) {
  const gs = await whatsappGuardians(studentIds, db);
  for (const g of gs) {
    const m = build(g);
    await enqueueWhatsApp({ ...m, to: g.phone, recipientUserId: g.user_id, studentId: g.student_id, dedupeKey: `${m.dedupeKey}:${g.user_id}` }, db);
  }
  return gs.length;
}

/** Built-in defaults; a stored row (if any) overrides them key by key. */
export const SETTING_DEFAULTS: Record<string, Record<string, unknown>> = {
  birthday: {
    enabled: true,
    include_staff: false,
    template: 'Dear {name}, wishing you a wonderful year ahead filled with joy, good health and great success.',
    signature: 'The Principal & Teachers, Shastra The New Age School',
  },
  fee_reminders: { enabled: true, days_before: [7, 1] },
  absence_alerts: { enabled: true },
  monthly_report: { enabled: true },
};

export async function getSetting<T = any>(key: string, db: Db = pool): Promise<T> {
  const r = await q('SELECT value FROM settings WHERE key = $1', [key], db);
  return { ...(SETTING_DEFAULTS[key] ?? {}), ...(r[0]?.value ?? {}) } as T;
}

export async function putSetting(key: string, value: unknown, userId: string | null, db: Db = pool) {
  await q(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
    db,
  );
}
