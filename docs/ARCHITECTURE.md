# Shastra Connect — Architecture

One app for the whole school: Principal, School Office, Class/Subject Teachers, Parents and Students.
Teachers enter information once; families see it the same day in the app, and the urgent things also arrive on WhatsApp.

## System overview

```
                           Internet (HTTPS only)
                                   │
                    ┌──────────────▼──────────────┐
                    │  Caddy 2  (web container)   │  automatic Let's Encrypt TLS, HSTS, strict CSP
                    │  • serves the React SPA     │  security headers, gzip/zstd
                    │  • /api/* → api:4000        │
                    └──────────────┬──────────────┘
                     frontend net  │
        ┌──────────────────────────▼───────────────────────────┐
        │  API  (Node 26 · Express 5 · TypeScript, no build)    │
        │  helmet · sessions · CSRF · RBAC · object-level authz │
        │  zod validation · rate limits · audit log · pino      │
        └───────┬─────────────────────────────┬────────────────┘
                │ backend net (internal,      │ writes rows to the
                │ no internet)                │ WhatsApp outbox
        ┌───────▼────────┐            ┌───────▼─────────────────────────┐
        │ PostgreSQL 19   │◄──────────│ Worker (same image)              │
        │ least-privilege │  claims   │ • outbox → WhatsApp Cloud API    │
        │ app role        │  jobs     │ • 08:00 birthday wishes          │
        └───────┬────────┘            │ • 09:00 fee reminders (7d, 1d)   │
                │                     │ • 1st 10:00 monthly report PDFs  │
        ┌───────▼────────┐            │ • nightly housekeeping           │
        │ backup (pg_dump │            └──────────────────────────────────┘
        │ nightly, 14 d)  │
        └────────────────┘
       External: WhatsApp Business Cloud API (Meta) · Razorpay (UPI / cards / net banking)
```

## Repository layout

```
shastra-connect/
├─ apps/
│  ├─ api/                        Node 26 + Express 5, TypeScript run natively by Node (type stripping)
│  │  ├─ src/
│  │  │  ├─ config/env.ts         zod-validated environment; refuses insecure production config
│  │  │  ├─ db/                   pool, SQL migrations (001_init.sql), migrate runner, demo seed
│  │  │  ├─ security/             sessions, CSRF, argon2id, access (object-level authz), audit, rate limits
│  │  │  ├─ routes/               auth · school · students · attendance · academics · learning · fees · comms · dashboard · webhooks
│  │  │  ├─ services/             performance analytics, grades, fees ledger, payments, PDF (report card, receipt), notify
│  │  │  ├─ jobs/                 WhatsApp providers, transactional outbox, scheduler
│  │  │  ├─ app.ts / server.ts / worker.ts
│  │  ├─ test/                   integration tests (node:test) — security + core flows
│  │  └─ Dockerfile
│  └─ web/                        React 19 + Vite 8 + Tailwind 4 + TanStack Query + React Router 8
│     ├─ src/pages/               family.tsx · teacher.tsx · leadership.tsx · Login · Profile
│     ├─ src/components/          layouts (staff sidebar / teacher tab bar / parent app), UI kit
│     ├─ Caddyfile                production web server, TLS and security headers
│     └─ Dockerfile
├─ docker/postgres/               first-boot script creating the least-privilege DB role
├─ docker-compose.yml             development: Postgres only
├─ docker-compose.prod.yml        production: db · api · worker · web (Caddy) · backup
└─ docs/
```

## Who sees what (RBAC + object-level checks)

| Role | Main screens | Can change |
| --- | --- | --- |
| **Principal** | Dashboard (attendance today + 4-week trend, fee status, class × subject heat map), students, attendance, results, fees, announcements, events, birthday wishes, WhatsApp log, staff & classes, audit log | Everything; publishes results; announcements & events |
| **School Office** | Fees desk, fee setup & reports, students, birthday wishes, WhatsApp log | Fee items, counter payments, reminders, student records & CSV import, birthday settings |
| **Class teacher** | Attendance for *their* sections | Daily attendance (last 3 days), report-card remark, publish results for their class |
| **Subject teacher** | Marks, homework diary, uploads | Marks, homework, worksheets, papers + answer keys, checked answer sheets — only for the section/subject they are assigned |
| **Parent** | Home, diary, progress, attendance heat map, library, events, notifications, fees | Absence reasons, homework ticks, worksheet uploads, online payments — only for their own children |
| **Student** | Same as parent for themselves | Same as parent for themselves |

Birthday wishes and the WhatsApp log are **Principal & Office only**; parents and teachers cannot see or send them.

Enforcement happens on the server in two layers: `requireRole()` per route, then `security/access.ts`
(`assertStudentAccess`, `assertCanMarkAttendance`, `assertCanTeach`, …) for every record id in a request.
The SPA's route guards are only for navigation.

## Key flows

**Morning attendance → WhatsApp alert.** The class teacher taps absentees and submits. In one transaction the API
upserts the register, writes in-app notifications and inserts WhatsApp rows into `wa_messages` with
`dedupe_key = absence:<student>:<date>:<parent>`. Re-submitting never sends twice. The worker delivers within seconds
and Meta's delivery/read webhooks update the status.

**Marks → analytics → monthly report.** Subject teachers enter marks (grades are computed with CBSE 8-point bands).
After publishing, parents see the trend against the class average, subject grades, strongest subject and focus area.
On the 1st of each month the worker builds every student's report-card PDF and sends it on WhatsApp.

**Fees.** The office sets fee items per class/section/term. Parents pay online: the server computes the amount from
locked balances (never from the client), creates a Razorpay order and finalises on a verified signature **or** the
HMAC-verified webhook (idempotent). Counter payments (cash/UPI/cheque) are recorded at the desk. Both issue a
sequential receipt (`SHS/2026-27/001234`), a PDF and a WhatsApp receipt.

**Birthdays.** At 08:00 (school time) the scheduler claims `job_runs(birthday, <date>)` once across all processes and
queues one wish per guardian (and staff, if enabled), signed by the Principal & teachers.

## Data model (main tables)

`users` (all roles) · `sessions` · `otp_challenges` · `audit_logs` · `academic_years` · `classes` · `sections`
(class teacher) · `subjects` · `teaching_assignments` · `students` · `guardians` · `holidays` · `attendance` ·
`exams` · `marks` · `report_remarks` · `files` · `homework` · `homework_done` · `library_items` ·
`worksheet_submissions` · `answer_sheets` · `fee_items` · `payments` · `payment_allocations` ·
`fee_item_balances` (view) · `events` · `notices` · `notifications` · `wa_messages` (outbox) · `job_runs` · `settings`.

## Technology choices (latest stable, Nov 2026)

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js 26 LTS | Runs TypeScript natively, so there is no build step for the API. Ships `import.meta.main` and `process.loadEnvFile`. |
| API | Express 5.3, zod 4, pg 8 | Express 5 forwards async errors on its own, and plain parameterised SQL leaves nothing hidden. |
| Database | PostgreSQL 19 | Built-in `uuidv7()`, `FOR UPDATE SKIP LOCKED` outbox, robust and familiar |
| Passwords | Argon2id (@node-rs/argon2, prebuilt) | OWASP-recommended parameters. Prebuilt binaries mean no install scripts run. |
| Web | React 19.3, Vite 8, Tailwind 4, TanStack Query 5, React Router 8, Recharts 3 | Current, fast, small surface |
| Type checking | TypeScript 7 (native compiler) | Fast `tsc` for both apps |
| Edge | Caddy 2 | Automatic HTTPS, simple security headers |
