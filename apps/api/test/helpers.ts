// Integration-test helpers. Tests run against the seeded development database (run `npm run seed` first).
process.env.NODE_ENV = 'test';
process.env.RUN_JOBS_IN_API = 'false';

const { createApp } = await import('../src/app.ts');
const { env } = await import('../src/config/env.ts');
export const db = await import('../src/db/pool.ts');

const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as { port: number }).port;
export const base = `http://127.0.0.1:${port}`;
export const ORIGIN = new URL(env.APP_ORIGIN).origin;

export async function close() {
  server.close();
  await db.pool.end();
}

/** Minimal browser-like client: keeps cookies, sends Origin and the CSRF header. */
export class Client {
  cookies = new Map<string, string>();
  csrf = true;
  origin: string | null = ORIGIN;

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...extra };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.origin) headers.origin = this.origin;
    const csrf = this.cookies.get('sc_csrf');
    if (this.csrf && csrf) headers['x-csrf-token'] = csrf;
    let payload: FormData | string | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair!.split('=');
      const val = v.join('=');
      if (!val || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, val);
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data: data as any, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b ?? {});
}

export const PASSWORD = 'Shastra@2026demo';

export async function staff(email: string) {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return c;
}

export async function family(phone: string) {
  const c = new Client();
  await db.q('DELETE FROM otp_challenges WHERE phone = $1', [`+91${phone}`]);
  const r1 = await c.post('/api/auth/otp/request', { phone });
  if (r1.status !== 200) throw new Error('otp request failed');
  const m = await db.q1(`SELECT params FROM wa_messages WHERE kind = 'otp' AND to_phone = $1 ORDER BY created_at DESC LIMIT 1`, [`+91${phone}`]);
  const r2 = await c.post('/api/auth/otp/verify', { phone, code: m.params[0] });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(r2.data)}`);
  return c;
}
