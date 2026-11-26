import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Shastra@2026demo';
export const PHONE = { width: 390, height: 844 };

/** Read-only queries against the local dev database (for OTP codes sent to the console). */
export function sql(query: string) {
  return execFileSync('docker', ['exec', 'shastra-dev-db-1', 'psql', '-U', 'postgres', '-d', 'shastra', '-tAc', query], { encoding: 'utf8' }).trim();
}

// ── TOTP (same algorithm as authenticator apps) ─────────────────────────────
function base32(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.replace(/\s/g, '').toUpperCase()) {
    val = (val << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret: string, step: number) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32(secret)).update(c).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1e6).padStart(6, '0');
}
const secrets = new Map<string, string>();

/** A code the server has not seen yet for this user (waits for the next 30-second window if needed). */
async function freshCode(email: string) {
  const secret = secrets.get(email)!;
  for (;;) {
    const last = Number(sql(`SELECT COALESCE(totp_last_step, -1) FROM users WHERE email = '${email}'`));
    const t = Math.floor(Date.now() / 30000);
    for (const s of [t, t + 1]) if (s > last) return totpAt(secret, s);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Collects anything that would mean a broken screen. Call `assertClean()` at the end of a test. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Download the React DevTools/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return {
    problems,
    assertClean: () => expect(problems, problems.join('\n')).toEqual([]),
  };
}

/** Staff sign-in, including two-step login (first time: scan/enrol; later: 6-digit code). */
export async function loginStaff(page: Page, email: string) {
  if (!secrets.has(email)) {
    // Unknown secret (fresh run): start from "not set up" so the enrolment screen is exercised.
    sql(`UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE email = '${email}'`);
  }
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByRole('tab', { name: 'School staff' }).click();
  await page.getByPlaceholder('you@shastra.school').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const enroll = page.getByText('Set up two-step login');
  const verify = page.getByText('Open your authenticator app');
  const home = page.locator('main');
  await expect(enroll.or(verify).or(home)).toBeVisible();

  if (await enroll.isVisible()) {
    const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
    secrets.set(email, secret);
    await page.getByLabel('Authenticator code').fill(totpAt(secret, Math.floor(Date.now() / 30000)));
    await page.getByRole('button', { name: 'Turn on two-step login' }).click();
    await expect(page.getByTestId('recovery-codes')).toBeVisible();
    await page.getByLabel('I have saved these codes').check();
    await page.getByRole('button', { name: 'Continue to Shastra Connect' }).click();
  } else if (await verify.isVisible()) {
    await page.getByLabel('Authenticator code').fill(await freshCode(email));
    await page.getByRole('button', { name: /Verify/ }).click();
  }
  await expect(page.locator('main')).toBeVisible();
}

export async function loginFamily(page: Page, phone: string) {
  sql(`DELETE FROM otp_challenges WHERE phone = '+91${phone}'`);
  await page.goto('/login');
  await page.getByPlaceholder('98765 43210').fill(phone);
  await page.getByRole('button', { name: /Send code/ }).click();
  await expect(page.getByText('6-digit code', { exact: true })).toBeVisible();
  let code = '';
  for (let i = 0; i < 20 && !/^\d{6}$/.test(code); i++) {
    code = sql(`SELECT COALESCE(params->>0, '') FROM wa_messages WHERE kind = 'otp' AND to_phone = '+91${phone}' ORDER BY created_at DESC LIMIT 1`);
    if (!/^\d{6}$/.test(code)) await new Promise((r) => setTimeout(r, 250));
  }
  await page.locator('input[autocomplete=one-time-code]').fill(code);
  await page.getByRole('button', { name: /Verify/ }).click();
  await expect(page.locator('main')).toBeVisible();
}

/** Visit a route and check it rendered real content (not blank, not the crash screen). */
export async function visit(page: Page, path: string, expectText: string | RegExp) {
  await page.goto(path);
  await expect(page.locator('main')).toContainText(expectText);
  await expect(page.getByText('Something went wrong on this screen')).toHaveCount(0);
  await expect(page.getByText('Can’t reach the Shastra Connect server')).toHaveCount(0);
}
