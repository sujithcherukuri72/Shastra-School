import pg from 'pg';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

// DATE columns come back as 'YYYY-MM-DD' strings (no timezone shifting); NUMERIC as JS numbers.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  application_name: 'shastra-api',
});

pool.on('error', (err) => logger.error({ err }, 'Postgres pool error'));

export type Db = Pick<pg.PoolClient, 'query'>;

/** Parameterised query helper. Never interpolate user input into SQL text. */
export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
}

export async function q1<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  const rows = await q<T>(text, params, db);
  return rows[0];
}

export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
