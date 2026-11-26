import { mkdir } from 'node:fs/promises';
import { env, uploadRoot } from './config/env.ts';
import { createApp } from './app.ts';
import { pool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { startJobs, stopJobs } from './jobs/scheduler.ts';
import { logger } from './lib/logger.ts';

await mkdir(uploadRoot, { recursive: true, mode: 0o750 });
await migrate((m) => logger.info(m));

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV, payments: env.PAYMENT_PROVIDER, whatsapp: env.WHATSAPP_PROVIDER }, 'Shastra Connect API listening');
});
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

if (env.RUN_JOBS_IN_API) startJobs();

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopJobs();
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
