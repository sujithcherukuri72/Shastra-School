// Background worker: WhatsApp outbox delivery + scheduled jobs (birthdays, fee reminders, monthly reports).
// Run as a separate process in production so slow PDF/WhatsApp work never blocks API requests.
import { mkdir } from 'node:fs/promises';
import { uploadRoot } from './config/env.ts';
import { pool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { startJobs, stopJobs } from './jobs/scheduler.ts';
import { logger } from './lib/logger.ts';

await mkdir(uploadRoot, { recursive: true, mode: 0o750 });
await migrate((m) => logger.info(m));
startJobs();

const shutdown = () => {
  stopJobs();
  pool.end().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
