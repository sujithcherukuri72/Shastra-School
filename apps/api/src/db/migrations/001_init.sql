-- Shastra Connect — initial schema (PostgreSQL 18+; uses built-in uuidv7()).
-- Conventions: every table has created_at; money is numeric(12,2) in INR; dates are school-local.

-- ─── People & access ────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('principal', 'office', 'teacher', 'parent', 'student');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  role          user_role NOT NULL,
  full_name     text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 150),
  email         text CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone         text CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  password_hash text,
  dob           date,
  is_active     boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL;

-- Opaque session tokens: only a SHA-256 of the token is stored.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           inet,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- One-time login codes for parents/students: HMAC of the code is stored, never the code.
CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  phone       text NOT NULL,
  code_hash   bytea NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_challenges (phone, created_at DESC);

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  ip         inet,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, created_at DESC);

-- ─── Academic structure ─────────────────────────────────────────────────────
CREATE TABLE academic_years (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE,            -- '2026-27'
  starts_on  date NOT NULL,
  ends_on    date NOT NULL CHECK (ends_on > starts_on),
  is_current boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX one_current_year ON academic_years (is_current) WHERE is_current;

CREATE TABLE classes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE,            -- 'Class 9'
  grade      smallint NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE sections (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id         integer NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  name             text NOT NULL,             -- 'A'
  class_teacher_id uuid REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE subjects (
  id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE
);

-- Which teacher teaches which subject to which section.
CREATE TABLE teaching_assignments (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  section_id integer NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  subject_id integer NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  UNIQUE (section_id, subject_id)
);
CREATE INDEX ta_teacher_idx ON teaching_assignments (teacher_id);

CREATE TABLE students (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  admission_no text NOT NULL UNIQUE,
  full_name    text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 150),
  dob          date,
  gender       text CHECK (gender IN ('male', 'female', 'other')),
  blood_group  text,
  address      text,
  section_id   integer REFERENCES sections (id) ON DELETE SET NULL,
  roll_no      integer CHECK (roll_no > 0),
  user_id      uuid UNIQUE REFERENCES users (id) ON DELETE SET NULL, -- optional student login
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, roll_no)
);
CREATE INDEX students_section_idx ON students (section_id) WHERE status = 'active';
CREATE INDEX students_dob_md_idx ON students ((extract(month FROM dob)), (extract(day FROM dob)));
CREATE INDEX students_name_idx ON students (lower(full_name));

CREATE TABLE guardians (
  student_id      uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  relation        text NOT NULL DEFAULT 'parent' CHECK (relation IN ('father', 'mother', 'guardian', 'parent')),
  is_primary      boolean NOT NULL DEFAULT false,
  whatsapp_opt_in boolean NOT NULL DEFAULT true,
  PRIMARY KEY (student_id, user_id)
);
CREATE INDEX guardians_user_idx ON guardians (user_id);

-- ─── Attendance ─────────────────────────────────────────────────────────────
CREATE TABLE holidays (
  day  date PRIMARY KEY,
  name text NOT NULL
);

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'leave');

CREATE TABLE attendance (
  student_id    uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  day           date NOT NULL,
  status        attendance_status NOT NULL,
  section_id    integer REFERENCES sections (id) ON DELETE SET NULL,
  marked_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  parent_reason text CHECK (length(parent_reason) <= 500),
  reason_at     timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, day)
);
CREATE INDEX attendance_day_idx ON attendance (day, section_id);

-- ─── Exams & marks ──────────────────────────────────────────────────────────
CREATE TABLE exams (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('weekly_test', 'unit_test', 'term_exam')),
  class_id         integer NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  exam_date        date NOT NULL,
  max_marks        numeric(6, 2) NOT NULL CHECK (max_marks > 0),
  academic_year_id integer REFERENCES academic_years (id),
  published_at     timestamptz,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, name, exam_date)
);

CREATE TABLE marks (
  exam_id    integer NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  subject_id integer NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  marks      numeric(6, 2) CHECK (marks >= 0),
  is_absent  boolean NOT NULL DEFAULT false,
  remark     text CHECK (length(remark) <= 300),
  entered_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, student_id, subject_id),
  CHECK (is_absent OR marks IS NOT NULL)
);
CREATE INDEX marks_student_idx ON marks (student_id);

CREATE TABLE report_remarks (
  student_id uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  month      date NOT NULL CHECK (extract(day FROM month) = 1),
  remark     text NOT NULL CHECK (length(remark) <= 500),
  written_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, month)
);

-- ─── Files (stored outside the web root, served only through authorised routes) ──
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  storage_key   text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime          text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL,
  uploaded_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Homework diary ─────────────────────────────────────────────────────────
CREATE TABLE homework (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  section_id integer NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  subject_id integer NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  teacher_id uuid REFERENCES users (id) ON DELETE SET NULL,
  title      text NOT NULL CHECK (length(title) <= 200),
  details    text CHECK (length(details) <= 4000),
  due_on     date NOT NULL,
  file_id    uuid REFERENCES files (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX homework_section_idx ON homework (section_id, due_on DESC);

CREATE TABLE homework_done (
  homework_id uuid NOT NULL REFERENCES homework (id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  done_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (homework_id, student_id)
);

-- ─── Library ────────────────────────────────────────────────────────────────
CREATE TABLE library_items (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  kind               text NOT NULL CHECK (kind IN ('textbook', 'worksheet', 'paper')),
  class_id           integer NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  subject_id         integer NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (length(title) <= 200),
  exam_name          text,
  year               smallint,
  due_on             date,
  file_id            uuid NOT NULL REFERENCES files (id),
  answer_key_file_id uuid REFERENCES files (id),
  uploaded_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_class_idx ON library_items (class_id, kind);

CREATE TABLE worksheet_submissions (
  item_id      uuid NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files (id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, student_id)
);

CREATE TABLE answer_sheets (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  exam_id     integer NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  subject_id  integer NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files (id),
  comments    text CHECK (length(comments) <= 1000),
  uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, subject_id)
);

-- ─── Fees & payments ────────────────────────────────────────────────────────
CREATE TABLE fee_items (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  student_id       uuid NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  academic_year_id integer REFERENCES academic_years (id),
  term             text NOT NULL,             -- 'Term 1'
  title            text NOT NULL,             -- 'Tuition fee'
  amount           numeric(12, 2) NOT NULL CHECK (amount > 0),
  due_on           date NOT NULL,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id, term, title)
);
CREATE INDEX fee_items_student_idx ON fee_items (student_id);
CREATE INDEX fee_items_due_idx ON fee_items (due_on);

CREATE SEQUENCE receipt_seq START 1001;

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  student_id          uuid NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  amount              numeric(12, 2) NOT NULL CHECK (amount > 0),
  method              text NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'netbanking', 'cheque', 'online')),
  status              text NOT NULL CHECK (status IN ('created', 'paid', 'failed')),
  receipt_no          text UNIQUE,
  provider            text,                   -- 'razorpay' | 'mock' | null (counter)
  provider_order_id   text UNIQUE,
  provider_payment_id text UNIQUE,
  reference           text,                   -- cheque no / UPI ref for counter payments
  note                text,
  paid_at             timestamptz,
  recorded_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  initiated_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'paid' OR (receipt_no IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX payments_student_idx ON payments (student_id, created_at DESC);

CREATE TABLE payment_allocations (
  payment_id  uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  fee_item_id uuid NOT NULL REFERENCES fee_items (id) ON DELETE RESTRICT,
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, fee_item_id)
);
CREATE INDEX allocations_item_idx ON payment_allocations (fee_item_id);

-- Outstanding per fee item (only paid payments count).
CREATE VIEW fee_item_balances AS
SELECT fi.*,
       COALESCE(p.paid, 0)::numeric(12, 2)               AS paid,
       (fi.amount - COALESCE(p.paid, 0))::numeric(12, 2) AS balance
FROM fee_items fi
LEFT JOIN (
  SELECT pa.fee_item_id, SUM(pa.amount) AS paid
  FROM payment_allocations pa
  JOIN payments pm ON pm.id = pa.payment_id AND pm.status = 'paid'
  GROUP BY pa.fee_item_id
) p ON p.fee_item_id = fi.id;

-- ─── Communication ──────────────────────────────────────────────────────────
CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  title       text NOT NULL CHECK (length(title) <= 200),
  description text CHECK (length(description) <= 4000),
  kind        text NOT NULL DEFAULT 'other' CHECK (kind IN ('exam', 'meeting', 'sports', 'holiday', 'celebration', 'exhibition', 'other')),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  location    text,
  class_id    integer REFERENCES classes (id) ON DELETE CASCADE, -- null = whole school
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_start_idx ON events (starts_at);

CREATE TABLE notices (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  title         text NOT NULL CHECK (length(title) <= 200),
  body          text NOT NULL CHECK (length(body) <= 4000),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  audience      text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'families', 'staff')),
  class_id      integer REFERENCES classes (id) ON DELETE CASCADE,
  send_whatsapp boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notices_created_idx ON notices (created_at DESC);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id uuid REFERENCES students (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- WhatsApp outbox: every message is queued here, then delivered by the worker.
CREATE TABLE wa_messages (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  kind                text NOT NULL CHECK (kind IN ('absence', 'fee_reminder', 'monthly_report', 'notice', 'birthday', 'otp', 'payment_receipt')),
  to_phone            text NOT NULL CHECK (to_phone ~ '^\+[1-9][0-9]{7,14}$'),
  template            text NOT NULL,
  lang                text NOT NULL DEFAULT 'en',
  params              jsonb NOT NULL DEFAULT '[]',
  preview             text NOT NULL,          -- human-readable text shown in the office log
  document_file_id    uuid REFERENCES files (id) ON DELETE SET NULL,
  dedupe_key          text UNIQUE,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text UNIQUE,
  last_error          text,
  student_id          uuid REFERENCES students (id) ON DELETE SET NULL,
  recipient_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_queue_idx ON wa_messages (next_attempt_at) WHERE status = 'queued';
CREATE INDEX wa_kind_idx ON wa_messages (kind, created_at DESC);

-- Scheduler idempotency: one row per job run (e.g. birthday:2026-11-25).
CREATE TABLE job_runs (
  name       text NOT NULL,
  run_key    text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result     jsonb,
  PRIMARY KEY (name, run_key)
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('birthday', jsonb_build_object(
     'enabled', true,
     'include_staff', false,
     'template', 'Dear {name}, wishing you a wonderful year ahead filled with joy, good health and great success.',
     'signature', 'The Principal & Teachers, Shastra The New Age School'
  )),
  ('fee_reminders', jsonb_build_object('enabled', true, 'days_before', jsonb_build_array(7, 1))),
  ('absence_alerts', jsonb_build_object('enabled', true)),
  ('monthly_report', jsonb_build_object('enabled', true));
