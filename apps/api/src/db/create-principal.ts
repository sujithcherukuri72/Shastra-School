/**
 * Create the first Principal account on a fresh (production) database.
 *   npm run create-principal -- --email principal@school.in --name "Dr. A. Reddy" [--phone 9876543210]
 * A strong random password is generated and printed once. Change it after the first sign-in.
 */
import { parseArgs } from 'node:util';
import { randomToken } from '../security/crypto.ts';
import { hashPassword } from '../security/password.ts';
import { migrate } from './migrate.ts';
import { pool, q1 } from './pool.ts';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' } } });
if (!values.email || !values.name) {
  console.error('Usage: npm run create-principal -- --email <email> --name "<full name>" [--phone <mobile>]');
  process.exit(1);
}
const phone = values.phone ? (/^\d{10}$/.test(values.phone) ? `+91${values.phone}` : values.phone) : null;

await migrate(() => {});
const password = `${randomToken(9)}-${Math.floor(Math.random() * 90 + 10)}`;
try {
  await q1(`INSERT INTO users (role, full_name, email, phone, password_hash) VALUES ('principal', $1, $2, $3, $4)`, [
    values.name,
    values.email.toLowerCase(),
    phone,
    await hashPassword(password),
  ]);
  console.log(`\nPrincipal account created.\n  Email:    ${values.email.toLowerCase()}\n  Password: ${password}\n\nSign in and change this password from Profile → Change password.\n`);
} catch (e) {
  console.error((e as Error).message.includes('users_email_uq') ? 'An account with this email already exists.' : (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
