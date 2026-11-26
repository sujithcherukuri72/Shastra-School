import type { Request } from 'express';
import { type Db, pool, q } from '../db/pool.ts';
import { logger } from '../lib/logger.ts';

/** Append-only record of security-relevant and money-relevant actions. */
export async function audit(
  req: Request | null,
  action: string,
  entity?: string | null,
  entityId?: string | number | null,
  meta: Record<string, unknown> = {},
  db: Db = pool,
  actorId?: string | null,
) {
  try {
    await q(
      'INSERT INTO audit_logs (actor_id, action, entity, entity_id, ip, meta) VALUES ($1,$2,$3,$4,$5,$6)',
      [actorId ?? req?.auth?.user.id ?? null, action, entity ?? null, entityId == null ? null : String(entityId), req?.ip ?? null, meta],
      db,
    );
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}
