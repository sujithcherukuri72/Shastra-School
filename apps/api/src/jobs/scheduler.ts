import { env } from '../config/env.ts';
import { pool, q, q1 } from '../db/pool.ts';
import { addDays, fmtDate, fmtMoney, fmtMonth, prevMonthStart, schoolTime, schoolToday } from '../lib/dates.ts';
import { saveBuffer } from '../lib/files.ts';
import { logger } from '../lib/logger.ts';
import { getSetting, notifyFamilies, whatsappFamilies } from '../services/notify.ts';
import { reportCardPdf } from '../services/pdf.ts';
import { monthlyReport } from '../services/performance.ts';
import { enqueueWhatsApp, processOutbox } from './outbox.ts';

/** Claim a run exactly once across all processes. */
async function claim(name: string, key: string) {
  const r = await q1('INSERT INTO job_runs (name, run_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING name', [name, key]);
  return !!r;
}
const finish = (name: string, key: string, result: unknown) =>
  q('UPDATE job_runs SET finished_at = now(), result = $3 WHERE name = $1 AND run_key = $2', [name, key, JSON.stringify(result)]);

interface BirthdaySettings {
  enabled: boolean;
  include_staff: boolean;
  template: string;
  signature: string;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Queue today's birthday wishes. Dedupe keys make this safe to call repeatedly. */
export async function queueBirthdayWishes(day: string): Promise<number> {
  const s = await getSetting<BirthdaySettings>('birthday');
  if (!s?.enabled) return 0;
  const render = (name: string) => s.template.replaceAll('{name}', name).replaceAll('{signature}', '').replace(/\s+/g, ' ').trim();
  const students = await q(
    `SELECT id, full_name FROM students WHERE status = 'active'
       AND extract(month FROM dob) = extract(month FROM $1::date) AND extract(day FROM dob) = extract(day FROM $1::date)`,
    [day],
  );
  let n = 0;
  for (const st of students) {
    const name = firstName(st.full_name);
    await notifyFamilies([st.id], { kind: 'birthday', title: `Happy Birthday, ${name}! 🎂`, body: render(name) });
    n += await whatsappFamilies([st.id], () => ({
      kind: 'birthday',
      template: 'birthday_wish',
      params: [name, render(name), s.signature],
      dedupeKey: `birthday:${st.id}:${day}`,
    }));
  }
  if (s.include_staff) {
    const staff = await q(
      `SELECT id, full_name, phone FROM users WHERE role IN ('principal','office','teacher') AND is_active AND phone IS NOT NULL
         AND to_char(dob, 'MM-DD') = to_char($1::date, 'MM-DD')`,
      [day],
    );
    for (const u of staff) {
      const name = firstName(u.full_name);
      await enqueueWhatsApp({ kind: 'birthday', to: u.phone, template: 'birthday_wish', params: [name, render(name), s.signature], recipientUserId: u.id, dedupeKey: `birthday:staff:${u.id}:${day}` });
      n++;
    }
  }
  return n;
}

/** Remind families N days before a fee is due (default 7 and 1). */
async function queueFeeReminders(day: string) {
  const s = await getSetting<{ enabled: boolean; days_before: number[] }>('fee_reminders');
  if (!s?.enabled) return 0;
  let n = 0;
  for (const before of s.days_before) {
    const due = addDays(day, before);
    const items = await q(
      `SELECT b.id, b.student_id, b.balance, b.due_on FROM fee_item_balances b JOIN students s ON s.id = b.student_id
        WHERE b.due_on = $1 AND b.balance > 0 AND s.status = 'active'`,
      [due],
    );
    for (const it of items) {
      await notifyFamilies([it.student_id], { kind: 'fee_reminder', title: `Fee due ${before === 1 ? 'tomorrow' : `in ${before} days`}`, body: `Rs. ${fmtMoney(it.balance)} due on ${fmtDate(it.due_on)}.`, link: '/family/fees' });
      n += await whatsappFamilies([it.student_id], (g) => ({
        kind: 'fee_reminder',
        template: 'fee_reminder',
        params: [g.student_name, fmtMoney(it.balance), fmtDate(it.due_on), env.SCHOOL_NAME],
        dedupeKey: `fee_auto:${it.id}:${before}`,
      }));
    }
  }
  return n;
}

/** On the 1st, send last month's report card PDF to every family. */
async function queueMonthlyReports(day: string) {
  const s = await getSetting<{ enabled: boolean }>('monthly_report');
  if (!s?.enabled) return 0;
  const month = prevMonthStart(day);
  const students = await q(`SELECT id, full_name FROM students WHERE status = 'active' ORDER BY id`);
  let n = 0;
  for (const st of students) {
    try {
      const already = await q1(`SELECT 1 FROM wa_messages WHERE dedupe_key LIKE $1 LIMIT 1`, [`report:${st.id}:${month}:%`]);
      if (already) continue;
      const report = await monthlyReport(st.id, month);
      if (!report.attendance.total && !report.subjects.length) continue; // nothing to report
      const pdf = await reportCardPdf(report);
      const file = await saveBuffer(pdf, `Report-${st.full_name.replace(/\W+/g, '-')}-${month.slice(0, 7)}.pdf`, 'application/pdf', null);
      await notifyFamilies([st.id], { kind: 'report', title: `${fmtMonth(month)} report card is ready`, link: '/family/progress' });
      n += await whatsappFamilies([st.id], (g) => ({
        kind: 'monthly_report',
        template: 'monthly_report',
        params: [g.student_name, fmtMonth(month), env.SCHOOL_NAME],
        documentFileId: file.id,
        dedupeKey: `report:${st.id}:${month}`,
      }));
    } catch (err) {
      logger.error({ err, student: st.id }, 'monthly report failed');
    }
  }
  return n;
}

async function housekeeping() {
  await q(`DELETE FROM sessions WHERE expires_at < now()`);
  await q(`DELETE FROM otp_challenges WHERE created_at < now() - interval '1 day'`);
  await q(`UPDATE wa_messages SET params = '[]'::jsonb WHERE kind = 'otp' AND params <> '[]'::jsonb AND created_at < now() - interval '15 minutes'`);
  await q(`UPDATE wa_messages SET status = 'queued', next_attempt_at = now() WHERE status = 'sending' AND updated_at < now() - interval '10 minutes'`);
}

type Job = { name: string; at: string; when?: (day: string) => boolean; run: (day: string) => Promise<unknown> };

const JOBS: Job[] = [
  { name: 'birthday', at: env.BIRTHDAY_SEND_TIME, run: queueBirthdayWishes },
  { name: 'fee_reminders', at: env.FEE_REMINDER_TIME, run: queueFeeReminders },
  { name: 'monthly_report', at: env.MONTHLY_REPORT_TIME, when: (d) => d.endsWith('-01'), run: queueMonthlyReports },
  { name: 'housekeeping', at: '02:30', run: housekeeping },
];

/** Runs due jobs. Uses ">=" so a job missed while the server was down still runs later the same day. */
export async function tick(now = new Date()) {
  const day = schoolToday(now);
  const time = schoolTime(now);
  for (const job of JOBS) {
    if (time < job.at || (job.when && !job.when(day))) continue;
    if (!(await claim(job.name, day))) continue;
    try {
      const result = await job.run(day);
      await finish(job.name, day, { ok: true, result });
      logger.info({ job: job.name, day, result }, 'scheduled job finished');
    } catch (err) {
      await finish(job.name, day, { ok: false, error: (err as Error).message });
      logger.error({ err, job: job.name }, 'scheduled job failed');
    }
  }
}

let timers: NodeJS.Timeout[] = [];
let busy = false;

export function startJobs() {
  logger.info({ whatsapp: env.WHATSAPP_PROVIDER }, 'background jobs started');
  timers.push(
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        while ((await processOutbox()) > 0) {}
      } catch (err) {
        logger.error({ err }, 'outbox error');
      } finally {
        busy = false;
      }
    }, 2_000),
  );
  timers.push(setInterval(() => tick().catch((err) => logger.error({ err }, 'scheduler error')), 30_000));
  tick().catch((err) => logger.error({ err }, 'scheduler error'));
}

export function stopJobs() {
  timers.forEach(clearInterval);
  timers = [];
}
