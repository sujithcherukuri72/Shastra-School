import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isProd, isTest } from './config/env.ts';
import { pool } from './db/pool.ts';
import { errorHandler, notFound } from './lib/http.ts';
import { logger } from './lib/logger.ts';
import { attachSession, csrfProtection, limits, noStore, requireAuth } from './security/middleware.ts';
import academics from './routes/academics.ts';
import attendance from './routes/attendance.ts';
import auth from './routes/auth.ts';
import comms from './routes/comms.ts';
import dashboard from './routes/dashboard.ts';
import fees from './routes/fees.ts';
import learning from './routes/learning.ts';
import school from './routes/school.ts';
import students from './routes/students.ts';
import webhooks from './routes/webhooks.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple');

  // The API only ever returns JSON or file downloads — lock the browser down completely.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    next();
  });

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
          req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  // Webhooks first: they need the raw body and are authenticated by signature, not cookies.
  app.use('/api/webhooks', webhooks);

  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(cookieParser());
  app.use('/api', limits.api, noStore, attachSession, csrfProtection);

  app.use('/api/auth', auth);

  const secured = Router();
  secured.use(requireAuth);
  secured.use('/school', school);
  secured.use('/students', students);
  secured.use('/attendance', attendance);
  secured.use('/academics', academics);
  secured.use('/fees', fees);
  secured.use('/dashboard', dashboard);
  secured.use('/', learning); // /homework, /library, /answer-sheets, /files
  secured.use('/', comms); // /events, /notices, /notifications, /birthdays, /messages
  app.use('/api', secured);

  app.use('/api', (_req, _res, next) => next(notFound('No such endpoint')));
  app.use(errorHandler(logger));
  return app;
}
