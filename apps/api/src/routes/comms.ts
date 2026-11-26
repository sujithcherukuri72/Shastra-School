import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { q, q1, tx } from '../db/pool.ts';
import { schoolToday } from '../lib/dates.ts';
import { id, notFound, optText, parse, text, uuid } from '../lib/http.ts';
import { familyClassIds } from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { requireRole } from '../security/middleware.ts';
import type { AuthCtx } from '../security/sessions.ts';
import { enqueueWhatsApp } from '../jobs/outbox.ts';
import { getSetting, notifyFamilies, notifyUsers, putSetting } from '../services/notify.ts';
import { queueBirthdayWishes } from '../jobs/scheduler.ts';

const r = Router();
const leadership = requireRole('principal', 'office');
const isFamily = (a: AuthCtx) => a.user.role === 'parent' || a.user.role === 'student';

// ── Events ──────────────────────────────────────────────────────────────────
r.get('/events', async (req, res) => {
  const a = req.auth!;
  const classes = isFamily(a) ? await familyClassIds(a) : null;
  const past = req.query.past === '1';
  res.json(
    await q(
      `SELECT e.id, e.title, e.description, e.kind, e.starts_at, e.ends_at, e.location, e.class_id, c.name AS class_name
         FROM events e LEFT JOIN classes c ON c.id = e.class_id
        WHERE ($1::int[] IS NULL OR e.class_id IS NULL OR e.class_id = ANY($1))
          AND (CASE WHEN $2 THEN e.starts_at < now() ELSE COALESCE(e.ends_at, e.starts_at) >= now() - interval '1 day' END)
        ORDER BY e.starts_at ${past ? 'DESC' : 'ASC'} LIMIT 200`,
      [classes, past],
    ),
  );
});

const eventIn = z.strictObject({
  title: text(200),
  description: optText(4000),
  kind: z.enum(['exam', 'meeting', 'sports', 'holiday', 'celebration', 'exhibition', 'other']).default('other'),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }).optional().nullable(),
  location: optText(200),
  class_id: id.optional().nullable(),
});

r.post('/events', requireRole('principal'), async (req, res) => {
  const b = parse(eventIn, req.body);
  const ev = await tx(async (db) => {
    const row = await q1(
      `INSERT INTO events (title, description, kind, starts_at, ends_at, location, class_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.title, b.description, b.kind, b.starts_at, b.ends_at ?? null, b.location, b.class_id ?? null, req.auth!.user.id],
      db,
    );
    const studs = await q(
      `SELECT s.id FROM students s LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.status = 'active' AND ($1::int IS NULL OR sec.class_id = $1)`,
      [b.class_id ?? null],
      db,
    );
    await notifyFamilies(studs.map((s) => s.id), { kind: 'event', title: `New event · ${b.title}`, body: b.location, link: '/family/events' }, db);
    return row!;
  });
  await audit(req, 'event.created', 'event', ev.id);
  res.status(201).json(ev);
});

r.delete('/events/:id', requireRole('principal'), async (req, res) => {
  const eid = parse(uuid, req.params.id);
  const gone = await q1('DELETE FROM events WHERE id = $1 RETURNING id', [eid]);
  if (!gone) throw notFound();
  await audit(req, 'event.deleted', 'event', eid);
  res.json({ ok: true });
});

// ── Notices / announcements ─────────────────────────────────────────────────
r.get('/notices', async (req, res) => {
  const a = req.auth!;
  const fam = isFamily(a);
  const classes = fam ? await familyClassIds(a) : null;
  res.json(
    await q(
      `SELECT n.id, n.title, n.body, n.priority, n.audience, n.class_id, c.name AS class_name, n.send_whatsapp, n.created_at,
              u.full_name AS created_by
         FROM notices n LEFT JOIN classes c ON c.id = n.class_id LEFT JOIN users u ON u.id = n.created_by
        WHERE ($1::int[] IS NULL OR n.class_id IS NULL OR n.class_id = ANY($1))
          AND ($2::text IS NULL OR n.audience IN ('everyone', $2))
        ORDER BY n.created_at DESC LIMIT 100`,
      [classes, fam ? 'families' : a.user.role === 'principal' ? null : 'staff'],
    ),
  );
});

r.post('/notices', requireRole('principal'), async (req, res) => {
  const b = parse(
    z.strictObject({
      title: text(200),
      body: text(4000),
      priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
      audience: z.enum(['everyone', 'families', 'staff']).default('everyone'),
      class_id: id.optional().nullable(),
      send_whatsapp: z.boolean().default(false),
    }),
    req.body,
  );
  const result = await tx(async (db) => {
    const n = await q1(
      `INSERT INTO notices (title, body, priority, audience, class_id, send_whatsapp, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.title, b.body, b.priority, b.audience, b.class_id ?? null, b.send_whatsapp, req.auth!.user.id],
      db,
    );
    let whatsapp = 0;
    if (b.audience !== 'staff') {
      const studs = (
        await q(
          `SELECT s.id FROM students s LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.status = 'active' AND ($1::int IS NULL OR sec.class_id = $1)`,
          [b.class_id ?? null],
          db,
        )
      ).map((s) => s.id);
      await notifyFamilies(studs, { kind: 'notice', title: b.title, body: b.body.slice(0, 200), link: '/family/notifications' }, db);
      if (b.send_whatsapp) {
        // One message per parent even with several children.
        const seen = new Set<string>();
        const gs = await q(
          `SELECT DISTINCT ON (u.id) u.id AS user_id, u.phone FROM guardians g JOIN users u ON u.id = g.user_id
            WHERE g.student_id = ANY($1::uuid[]) AND g.whatsapp_opt_in AND u.is_active AND u.phone IS NOT NULL`,
          [studs],
          db,
        );
        for (const g of gs) {
          if (seen.has(g.user_id)) continue;
          seen.add(g.user_id);
          await enqueueWhatsApp({ kind: 'notice', to: g.phone, template: 'school_notice', params: [b.title, b.body.slice(0, 900), env.SCHOOL_NAME], recipientUserId: g.user_id, dedupeKey: `notice:${n!.id}:${g.user_id}` }, db);
          whatsapp++;
        }
      }
    }
    if (b.audience !== 'families') {
      const staff = (await q(`SELECT id FROM users WHERE role IN ('principal','office','teacher') AND is_active AND id <> $1`, [req.auth!.user.id], db)).map((u) => u.id);
      await notifyUsers(staff, { kind: 'notice', title: b.title, body: b.body.slice(0, 200), link: '/notices' }, db);
    }
    return { id: n!.id, whatsapp };
  });
  await audit(req, 'notice.created', 'notice', result.id, { whatsapp: result.whatsapp, audience: b.audience });
  res.status(201).json(result);
});

r.delete('/notices/:id', requireRole('principal'), async (req, res) => {
  const nid = parse(uuid, req.params.id);
  const gone = await q1('DELETE FROM notices WHERE id = $1 RETURNING id', [nid]);
  if (!gone) throw notFound();
  await audit(req, 'notice.deleted', 'notice', nid);
  res.json({ ok: true });
});

// ── In-app notifications ────────────────────────────────────────────────────
r.get('/notifications', async (req, res) => {
  const rows = await q(
    `SELECT n.id, n.kind, n.title, n.body, n.link, n.read_at, n.created_at, n.student_id, s.full_name AS student_name
       FROM notifications n LEFT JOIN students s ON s.id = n.student_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
    [req.auth!.user.id],
  );
  const unread = await q1('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.auth!.user.id]);
  res.json({ unread: unread?.n ?? 0, rows });
});

r.post('/notifications/read', async (req, res) => {
  const b = parse(z.strictObject({ ids: z.array(z.number().int().positive()).max(200).optional() }), req.body ?? {});
  await q(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
    [req.auth!.user.id, b.ids ?? null],
  );
  res.json({ ok: true });
});

// ── Birthday wishes (Principal & Office ONLY) ───────────────────────────────
r.get('/birthdays', leadership, async (req, res) => {
  const days = parse(z.coerce.number().int().min(0).max(60).default(14), req.query.days);
  const today = schoolToday();
  const [settings, upcoming, staff, sent] = await Promise.all([
    getSetting('birthday'),
    q(
      `WITH d AS (SELECT (CAST($1 AS date) + g) AS day FROM generate_series(0, $2) g)
       SELECT d.day, s.id, s.full_name, s.dob, c.name AS class_name, sec.name AS section_name,
              (extract(year FROM d.day) - extract(year FROM s.dob))::int AS turning
         FROM d JOIN students s ON extract(month FROM s.dob) = extract(month FROM d.day) AND extract(day FROM s.dob) = extract(day FROM d.day)
         LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
        WHERE s.status = 'active' ORDER BY d.day, c.sort_order, s.full_name`,
      [today, days],
    ),
    q(
      `WITH d AS (SELECT (CAST($1 AS date) + g) AS day FROM generate_series(0, $2) g)
       SELECT d.day, u.id, u.full_name, u.role, u.dob FROM d
         JOIN users u ON to_char(u.dob, 'MM-DD') = to_char(d.day, 'MM-DD')
        WHERE u.role IN ('principal','office','teacher') AND u.is_active
        ORDER BY d.day, u.full_name`,
      [today, days],
    ),
    q(
      `SELECT w.id, w.status, w.preview, w.created_at, w.updated_at, w.last_error, s.full_name AS student_name, u.full_name AS recipient
         FROM wa_messages w LEFT JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.recipient_user_id
        WHERE w.kind = 'birthday' AND w.created_at > now() - interval '30 days' ORDER BY w.created_at DESC LIMIT 200`,
    ),
  ]);
  res.json({ settings, sendTime: env.BIRTHDAY_SEND_TIME, today, upcoming, staff, sent });
});

r.put('/birthdays/settings', leadership, async (req, res) => {
  const b = parse(
    z.strictObject({
      enabled: z.boolean(),
      include_staff: z.boolean(),
      template: text(600).refine((t) => t.includes('{name}'), 'The message must contain {name}'),
      signature: text(150),
    }),
    req.body,
  );
  await putSetting('birthday', b, req.auth!.user.id);
  await audit(req, 'birthday.settings', 'settings', 'birthday', { enabled: b.enabled, include_staff: b.include_staff });
  res.json({ ok: true });
});

/** Send today's wishes now (normally automatic at BIRTHDAY_SEND_TIME). Still exactly-once per person per day. */
r.post('/birthdays/send-now', leadership, async (req, res) => {
  const n = await queueBirthdayWishes(schoolToday());
  await audit(req, 'birthday.send_now', 'settings', 'birthday', { queued: n });
  res.json({ queued: n });
});

// ── WhatsApp message log (Principal & Office) ───────────────────────────────
r.get('/messages', leadership, async (req, res) => {
  const f = parse(
    z.object({
      kind: z.enum(['absence', 'fee_reminder', 'monthly_report', 'notice', 'birthday', 'payment_receipt']).optional(),
      status: z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed']).optional(),
    }),
    req.query,
  );
  const [rows, stats] = await Promise.all([
    q(
      `SELECT w.id, w.kind, w.status, w.preview, w.to_phone, w.attempts, w.last_error, w.created_at, w.updated_at,
              s.full_name AS student_name, u.full_name AS recipient
         FROM wa_messages w LEFT JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.recipient_user_id
        WHERE w.kind <> 'otp' AND ($1::text IS NULL OR w.kind = $1) AND ($2::text IS NULL OR w.status = $2)
        ORDER BY w.created_at DESC LIMIT 300`,
      [f.kind ?? null, f.status ?? null],
    ),
    q(`SELECT kind, status, COUNT(*) AS n FROM wa_messages WHERE kind <> 'otp' AND created_at > now() - interval '30 days' GROUP BY kind, status`),
  ]);
  res.json({
    stats,
    rows: rows.map((m) => ({ ...m, to_phone: m.to_phone.slice(0, 3) + '•••••' + m.to_phone.slice(-4) })),
  });
});

r.post('/messages/:id/retry', leadership, async (req, res) => {
  const mid = parse(uuid, req.params.id);
  const row = await q1(`UPDATE wa_messages SET status = 'queued', next_attempt_at = now(), attempts = 0 WHERE id = $1 AND status = 'failed' AND kind <> 'otp' RETURNING id`, [mid]);
  if (!row) throw notFound('Only failed messages can be retried');
  res.json({ ok: true });
});

export default r;
