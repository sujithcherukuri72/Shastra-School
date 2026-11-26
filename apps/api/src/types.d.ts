import type { AuthCtx } from './security/sessions.ts';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthCtx;
      rawBody?: Buffer;
    }
  }
}

export {};
