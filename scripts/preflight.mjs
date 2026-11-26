// Production readiness check for .env
//   npm run preflight             -> checks every setting
//   npm run preflight -- --online -> also tests the domain, WhatsApp token and Razorpay keys
import { existsSync, readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';

const online = process.argv.includes('--online');
if (!existsSync('.env')) {
  console.error('No .env file. Copy .env.example to .env first (or run START-HERE.cmd once).');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const results = [];
const ok = (label) => results.push(['ok', label]);
const bad = (label, fix) => results.push(['bad', label, fix]);
const warn = (label, fix) => results.push(['warn', label, fix]);
const weak = (v) => !v || v.length < 24 || /change-me|replace-with|example|password/i.test(v);
const filled = (k) => !!env[k] && !/example\.com|^x+$/i.test(env[k]);

// 1. Switches
env.NODE_ENV === 'production' ? ok('NODE_ENV=production') : bad(`NODE_ENV is "${env.NODE_ENV}"`, 'set NODE_ENV=production');
env.WHATSAPP_PROVIDER === 'meta' ? ok('WhatsApp provider: meta') : bad('WHATSAPP_PROVIDER is not "meta"', 'set WHATSAPP_PROVIDER=meta (messages are otherwise only printed in logs)');
env.PAYMENT_PROVIDER === 'razorpay' ? ok('Payment provider: razorpay') : bad('PAYMENT_PROVIDER is not "razorpay"', 'set PAYMENT_PROVIDER=razorpay (mock is refused in production)');
env.RUN_JOBS_IN_API === 'false' ? ok('Jobs run in the worker container') : warn('RUN_JOBS_IN_API is not false', 'set RUN_JOBS_IN_API=false (docker-compose.prod.yml overrides it anyway)');

// 2. School + domain
for (const k of ['SCHOOL_NAME', 'SCHOOL_CITY']) filled(k) ? ok(`${k}`) : bad(`${k} is empty`, 'fill in the school details');
for (const k of ['SCHOOL_PHONE', 'SCHOOL_ADDRESS']) filled(k) ? ok(`${k}`) : warn(`${k} is empty`, 'recommended: printed on receipts and report cards');
if (!filled('DOMAIN') || /^https?:\/\//.test(env.DOMAIN)) bad('DOMAIN is missing or starts with http', 'e.g. DOMAIN=connect.shastraschool.in (no https://)');
else ok(`DOMAIN=${env.DOMAIN}`);
/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.ACME_EMAIL ?? '') && !/example\.com/.test(env.ACME_EMAIL) ? ok('ACME_EMAIL') : bad('ACME_EMAIL missing', 'an email for HTTPS certificate notices');

// 3. Secrets
for (const k of ['POSTGRES_SUPERUSER_PASSWORD', 'DB_APP_PASSWORD']) weak(env[k]) ? bad(`${k} is weak or a placeholder`, 'use 24+ random characters (start.ps1 generates them)') : ok(`${k} is strong`);
(env.SESSION_SECRET ?? '').length >= 32 && !weak(env.SESSION_SECRET) ? ok('SESSION_SECRET is strong') : bad('SESSION_SECRET is weak or a placeholder', 'use 48+ random characters');
new Set([env.POSTGRES_SUPERUSER_PASSWORD, env.DB_APP_PASSWORD, env.SESSION_SECRET]).size === 3 ? ok('Secrets are all different') : bad('Two secrets are identical', 'every secret must be different');

// 4. WhatsApp
for (const k of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET']) filled(k) ? ok(k) : bad(`${k} is empty`, 'see section 6 of .env and docs/WHATSAPP.md');
(env.WHATSAPP_VERIFY_TOKEN ?? '').length >= 16 ? ok('WHATSAPP_VERIFY_TOKEN') : bad('WHATSAPP_VERIFY_TOKEN is short or empty', 'any 16+ random characters, same value in Meta');

// 5. Razorpay
if (!filled('RAZORPAY_KEY_ID')) bad('RAZORPAY_KEY_ID is empty', 'Razorpay Dashboard > API Keys');
else if (env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) warn('Razorpay TEST keys in use', 'switch to rzp_live_ keys to take real payments');
else ok('RAZORPAY_KEY_ID (live)');
filled('RAZORPAY_KEY_SECRET') ? ok('RAZORPAY_KEY_SECRET') : bad('RAZORPAY_KEY_SECRET is empty', 'Razorpay Dashboard > API Keys');
(env.RAZORPAY_WEBHOOK_SECRET ?? '').length >= 16 ? ok('RAZORPAY_WEBHOOK_SECRET') : bad('RAZORPAY_WEBHOOK_SECRET is short or empty', '16+ random characters, same value in Razorpay > Webhooks');

// 6. Online checks
if (online) {
  if (filled('DOMAIN')) {
    try {
      const a = await lookup(env.DOMAIN);
      ok(`DNS: ${env.DOMAIN} -> ${a.address} (must be your server's IP)`);
    } catch {
      bad(`DNS: ${env.DOMAIN} does not resolve`, 'create an A record pointing to the server IP and wait for it to propagate');
    }
  }
  if (filled('WHATSAPP_ACCESS_TOKEN') && filled('WHATSAPP_PHONE_NUMBER_ID')) {
    try {
      const r = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || 'v23.0'}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      });
      const b = await r.json();
      r.ok ? ok(`WhatsApp: ${b.verified_name} (${b.display_phone_number}), quality ${b.quality_rating}`) : bad(`WhatsApp token rejected: ${b?.error?.message ?? r.status}`, 'check the phone number ID and permanent token');
    } catch (e) {
      bad(`WhatsApp check failed: ${e.message}`, 'check internet access');
    }
  }
  if (filled('RAZORPAY_KEY_ID') && filled('RAZORPAY_KEY_SECRET')) {
    try {
      const r = await fetch('https://api.razorpay.com/v1/orders?count=1', {
        headers: { Authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64') },
        signal: AbortSignal.timeout(15000),
      });
      r.ok ? ok('Razorpay keys accepted') : bad(`Razorpay keys rejected (HTTP ${r.status})`, 'regenerate the key pair in the Razorpay dashboard');
    } catch (e) {
      bad(`Razorpay check failed: ${e.message}`, 'check internet access');
    }
  }
}

const icon = { ok: '\x1b[32m  OK  \x1b[0m', warn: '\x1b[33m WARN \x1b[0m', bad: '\x1b[31m TODO \x1b[0m' };
console.log('\nShastra Connect - production preflight\n');
for (const [s, label, fix] of results) console.log(`${icon[s]} ${label}${fix ? `\n         -> ${fix}` : ''}`);
const todo = results.filter((r) => r[0] === 'bad').length;
const warns = results.filter((r) => r[0] === 'warn').length;
console.log(
  todo
    ? `\n${todo} item(s) must be fixed before going live${warns ? `, ${warns} warning(s)` : ''}.\n`
    : `\nReady for production${warns ? ` (${warns} warning(s))` : ''}.${online ? '' : ' Run "npm run preflight -- --online" to also test the domain, WhatsApp and Razorpay.'}\n`,
);
process.exit(todo ? 1 : 0);
