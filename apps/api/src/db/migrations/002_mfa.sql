-- Two-step login (TOTP authenticator app) for Principal and Office accounts.

ALTER TABLE users
  ADD COLUMN totp_secret_enc text,          -- AES-256-GCM encrypted base32 secret
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step  bigint;        -- last accepted 30-second step (blocks code replay)

-- One-time recovery codes: only a SHA-256 of each code is stored.
CREATE TABLE mfa_recovery_codes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  bytea NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user_idx ON mfa_recovery_codes (user_id);

-- The step between "password correct" and "second factor correct". No session exists yet.
CREATE TABLE mfa_challenges (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash         bytea NOT NULL UNIQUE,
  purpose            text NOT NULL CHECK (purpose IN ('verify', 'enroll')),
  pending_secret_enc text,                  -- secret shown during enrolment, saved only after a correct code
  attempts           integer NOT NULL DEFAULT 0,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges (user_id);
