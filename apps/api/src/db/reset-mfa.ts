/**
 * Emergency only (needs server access): clear two-step login for a staff account that lost its phone
 * AND its recovery codes. They set it up again at their next sign-in.
 *   npm run reset-mfa -- --email principal@school.in
 */
import { parseArgs } from 'node:util';
import { audit } from '../security/audit.ts';
import { resetMfa } from '../security/mfa.ts';
import { pool, q, q1 } from './pool.ts';

const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (!values.email) {
  console.error('Usage: npm run reset-mfa -- --email <staff email>');
  process.exit(1);
}
const u = await q1('SELECT id, full_name FROM users WHERE email = $1', [values.email.toLowerCase()]);
if (!u) {
  console.error('No account with that email.');
  process.exitCode = 1;
} else {
  await resetMfa(u.id);
  await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  await audit(null, 'mfa.reset_from_server_console', 'user', u.id, {}, undefined, null);
  console.log(`Two-step login cleared for ${u.full_name}. They will set it up again at their next sign-in.`);
}
await pool.end();
