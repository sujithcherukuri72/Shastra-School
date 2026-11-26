import { sql } from './helpers.ts';

/** The tests enrol the demo Principal/Office with throw-away authenticator secrets; undo that so a
 *  person can set up two-step login with their own phone afterwards. */
export default function globalTeardown() {
  sql(`UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE role IN ('principal','office')`);
  sql(`DELETE FROM mfa_recovery_codes WHERE user_id IN (SELECT id FROM users WHERE role IN ('principal','office'))`);
}
