# Shastra Connect

**One app for the whole school.** It connects the Principal, the School Office, class and subject teachers, parents
and students of *Shastra The New Age School, Suryapet*.

> Every update a teacher makes reaches the parent the same day. No lost diaries. No missed notices. No surprise fee calls.

---

## ▶ Start the app on your computer (Windows)

You need **Docker Desktop** and **Node.js** installed once. If you don't have them, open PowerShell and run these two
lines, then restart the computer:

```powershell
winget install Docker.DockerDesktop
winget install OpenJS.NodeJS.LTS
```

Then **double-click `START-HERE.cmd`** in this folder. It does everything:
- starts Docker
- creates `.env` with fresh secrets
- installs the app and starts the database
- loads a demo school the first time
- opens **http://localhost:5173** in your browser

Keep that window open while you use the app. Close it (or press **Ctrl+C**) to stop.

| Sign in as | Login |
| --- | --- |
| **Principal** | `principal@shastra.school` · password `Shastra@2026demo` |
| **School Office** | `office@shastra.school` · password `Shastra@2026demo` |
| **Teacher** (class teacher of 9-A, Maths for Classes 9–10) | `teacher@shastra.school` · password `Shastra@2026demo` |
| **Parent** (children Aarav 9-A and Ananya 6-B) | *Parent / Student* tab → mobile `9000000001` → the 6-digit code appears in the START-HERE window as `OTP for +919000000001: 123456` |
| **Student** | *Parent / Student* tab → mobile `9000000002` |

On your computer, WhatsApp messages are printed in that window instead of being sent. Payments open a
*Simulate successful payment* test dialog, so no real money moves.

To reset the demo data, run `.\start.ps1 -FreshDemo` in PowerShell from this folder.

## What's inside

| Who | Screens |
| --- | --- |
| Principal | Dashboard (attendance today + 4-week trend, fee status, class × subject heat map), students, attendance, exams & results, fees, announcements (+WhatsApp), events, birthday wishes, WhatsApp log, staff & classes, audit log |
| School Office | Fees desk (search, ledger, counter payment + PDF receipt, remind all), fee setup, students + CSV import, birthday wishes, WhatsApp log |
| Teacher (phone) | Home, one-tap attendance (absent → WhatsApp alert), marks with automatic grades, homework diary, uploads (worksheets, papers + answer keys, checked answer sheets) |
| Parent / Student (phone) | Home, homework diary, progress chart vs class average, report card PDF, attendance heat map + absence reasons, library, events, notifications, fees (pay online, receipts) |

Automatic WhatsApp messages cover:
- absence alerts
- fee reminders, 7 days and 1 day before the due date
- the monthly report card PDF on the 1st
- notices and payment receipts
- birthday wishes at 08:00 (Principal and Office only)

## Going to production

1. **Get the values marked `[YOU]` in [.env](.env.example).** The file explains where each one comes from:
   - a domain name
   - a WhatsApp Business account ([docs/WHATSAPP.md](docs/WHATSAPP.md))
   - a Razorpay account
   - the school's phone and address
2. Rent a small Linux server and follow [docs/OPERATIONS.md](docs/OPERATIONS.md). It takes about 30 minutes.
3. Run `npm run preflight -- --online`. It lists anything that is still missing or unsafe.
4. Read the go-live checklist in [SECURITY.md](SECURITY.md).

## Developer commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (:4100) + web app (:5173) with hot reload (START-HERE runs this) |
| `npm run db:up` | Start the Postgres container |
| `npm run db:reset` | **Delete** the local database and start an empty one |
| `npm run migrate` | Apply new database migrations |
| `npm run seed` | Wipe and reload the demo school (refused in production) |
| `npm run create-principal -- --email a@b.in --name "Name"` | Create the first real Principal account |
| `npm run preflight` | Production readiness check of `.env` (`-- --online` also tests the domain, WhatsApp and Razorpay) |
| `npm run check` | Typecheck + lint + tests + dependency audit (run before every release) |
| `npm test` | API integration tests (security + core flows; needs a seeded database) |
| `npm run build` | Production build of the web app |

**Stack (latest stable, Nov 2026):**
- **Runtime:** Node.js 26 LTS
- **API:** Express 5, with TypeScript 7 run directly by Node
- **Database:** PostgreSQL 19
- **Web:** React 19, Vite 8, Tailwind CSS 4, TanStack Query 5 and React Router 8
- **Production:** Caddy 2 for automatic HTTPS, all in Docker Compose

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the design and data model.

```
apps/api      API · src/{config,db,security,routes,services,jobs} · test/
apps/web      React app · src/{pages,components,lib} · Caddyfile (production web server)
docker/       Postgres first-boot script (least-privilege database user)
docs/         Architecture · Operations · WhatsApp
scripts/      dev runner · production preflight
```

*All names, phone numbers, marks and fees in the demo data are fictional.*
