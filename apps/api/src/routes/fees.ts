import { Router } from 'express';
import { z } from 'zod';
import { env, isProd } from '../config/env.ts';
import { q, q1, tx } from '../db/pool.ts';
import { fmtDate, fmtMoney, schoolToday } from '../lib/dates.ts';
import { badRequest, forbidden, id, isoDate, notFound, optText, parse, text, uuid } from '../lib/http.ts';
import { logger } from '../lib/logger.ts';
import { assertFamilyOf, assertStudentAccess } from '../security/access.ts';
import { audit } from '../security/audit.ts';
import { limits, requireRole } from '../security/middleware.ts';
import { finalisePayment, ledger, lockBalances, receiptData } from '../services/fees.ts';
import { notifyFamilies, whatsappFamilies } from '../services/notify.ts';
import { paymentProvider } from '../services/payments.ts';
import { receiptPdf } from '../services/pdf.ts';

const r = Router();
const office = requireRole('principal', 'office');
const feeReaders = requireRole('principal', 'office', 'parent', 'student');

r.get('/students/:id', feeReaders, async (req, res) => {
  const sid = parse(uuid, req.params.id);
  await assertStudentAccess(req.auth!, sid);
  res.json(await ledger(sid));
});

/** Fees desk search: name or admission number, with outstanding balance. */
r.get('/search', office, async (req, res) => {
  const term = parse(z.string().trim().max(80).default(''), req.query.q);
  const onlyDue = req.query.due === '1';
  const like = term.replace(/[%_\\]/g, '\\$&');
  res.json(
    await q(
      `SELECT s.id, s.full_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              COALESCE(SUM(b.amount), 0) AS total, COALESCE(SUM(b.balance), 0) AS balance,
              MIN(b.due_on) FILTER (WHERE b.balance > 0) AS next_due
         FROM students s LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
         LEFT JOIN fee_item_balances b ON b.student_id = s.id
        WHERE s.status = 'active' AND ($1 = '' OR s.full_name ILIKE '%' || $1 || '%' OR s.admission_no ILIKE '%' || $1 || '%')
        GROUP BY s.id, c.name, c.sort_order, sec.name
       HAVING NOT $2 OR COALESCE(SUM(b.balance), 0) > 0
        ORDER BY c.sort_order, sec.name, s.full_name LIMIT 100`,
      [like, onlyDue],
    ),
  );
});

r.get('/summary', office, async (_req, res) => {
  const [byStatus, byTerm, today] = await Promise.all([
    q1(`SELECT COUNT(*) FILTER (WHERE balance <= 0) AS paid, COUNT(*) FILTER (WHERE balance > 0 AND paid > 0) AS part_paid,
               COUNT(*) FILTER (WHERE paid = 0) AS not_paid, SUM(amount) AS billed, SUM(paid) AS collected, SUM(balance) AS outstanding,
               SUM(balance) FILTER (WHERE due_on < CURRENT_DATE) AS overdue
          FROM (SELECT student_id, SUM(amount) AS amount, SUM(paid) AS paid, SUM(balance) AS balance, MIN(due_on) AS due_on
                  FROM fee_item_balances b WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current) GROUP BY student_id) per_student`),
    q(`SELECT term, SUM(amount) AS billed, SUM(paid) AS collected, SUM(balance) AS outstanding, MIN(due_on) AS due_on
         FROM fee_item_balances WHERE academic_year_id = (SELECT id FROM academic_years WHERE is_current)
        GROUP BY term ORDER BY MIN(due_on)`),
    q1(`SELECT COUNT(*) AS payments, COALESCE(SUM(amount), 0) AS amount FROM payments
         WHERE status = 'paid' AND paid_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`, [env.SCHOOL_TIMEZONE]),
  ]);
  res.json({ students: byStatus, terms: byTerm, today });
});

r.get('/payments/recent', office, async (_req, res) => {
  res.json(
    await q(`SELECT p.id, p.receipt_no, p.amount, p.method, p.provider, p.paid_at, s.full_name AS student, s.admission_no, u.full_name AS recorded_by
               FROM payments p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.recorded_by
              WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 50`),
  );
});

/** Set fees for many students at once (e.g. next term for a whole class). */
r.post('/items', office, async (req, res) => {
  const b = parse(
    z
      .strictObject({
        student_ids: z.array(uuid).max(5000).optional(),
        class_id: id.optional(),
        section_id: id.optional(),
        term: text(40),
        title: text(80),
        amount: z.number().positive().max(10_000_000),
        due_on: isoDate,
      })
      .refine((v) => v.student_ids?.length || v.class_id || v.section_id, 'Choose students, a class or a section'),
    req.body,
  );
  const created = await q(
    `INSERT INTO fee_items (student_id, academic_year_id, term, title, amount, due_on, created_by)
     SELECT s.id, (SELECT id FROM academic_years WHERE is_current), $4, $5, $6, $7, $8
       FROM students s LEFT JOIN sections sec ON sec.id = s.section_id
      WHERE s.status = 'active'
        AND ($1::uuid[] IS NULL OR s.id = ANY($1)) AND ($2::int IS NULL OR sec.class_id = $2) AND ($3::int IS NULL OR s.section_id = $3)
     ON CONFLICT (student_id, academic_year_id, term, title) DO NOTHING
     RETURNING id`,
    [b.student_ids ?? null, b.class_id ?? null, b.section_id ?? null, b.term, b.title, b.amount, b.due_on, req.auth!.user.id],
  );
  await audit(req, 'fees.items_created', 'fee_items', null, { count: created.length, term: b.term, title: b.title, amount: b.amount });
  res.status(201).json({ created: created.length });
});

r.delete('/items/:id', office, async (req, res) => {
  const fid = parse(uuid, req.params.id);
  const used = await q1('SELECT 1 FROM payment_allocations WHERE fee_item_id = $1', [fid]);
  if (used) throw badRequest('This fee has payments against it and cannot be deleted');
  const gone = await q1('DELETE FROM fee_items WHERE id = $1 RETURNING student_id, title, amount', [fid]);
  if (!gone) throw notFound();
  await audit(req, 'fees.item_deleted', 'fee_item', fid, gone);
  res.json({ ok: true });
});

/** Counter payment recorded by the office (cash / UPI / cheque / card). Partial payments allowed. */
r.post('/payments', office, async (req, res) => {
  const b = parse(
    z.strictObject({
      student_id: uuid,
      fee_item_ids: z.array(uuid).min(1).max(50),
      method: z.enum(['cash', 'upi', 'card', 'cheque', 'netbanking']),
      amount: z.number().positive().max(10_000_000).optional(),
      reference: optText(80),
      note: optText(300),
    }),
    req.body,
  );
  const payment = await tx(async (db) => {
    const due = await lockBalances(db, b.student_id, b.fee_item_ids);
    const total = due.reduce((a, d) => a + d.balance, 0);
    const amount = b.amount ?? total;
    if (amount > total + 0.001) throw badRequest(`Amount is more than the outstanding Rs. ${fmtMoney(total)}`);
    const p = await q1(
      `INSERT INTO payments (student_id, amount, method, status, reference, note, recorded_by, initiated_by)
       VALUES ($1,$2,$3,'created',$4,$5,$6,$6) RETURNING id`,
      [b.student_id, amount, b.method, b.reference, b.note, req.auth!.user.id],
      db,
    );
    let left = amount;
    for (const d of due) {
      if (left <= 0) break;
      const part = Math.min(left, d.balance);
      await q('INSERT INTO payment_allocations (payment_id, fee_item_id, amount) VALUES ($1,$2,$3)', [p!.id, d.id, part], db);
      left = Math.round((left - part) * 100) / 100;
    }
    return finalisePayment(db, p!.id, {});
  });
  await audit(req, 'payment.counter', 'payment', payment.id, { amount: payment.amount, method: b.method, receipt: payment.receipt_no });
  res.status(201).json({ id: payment.id, receipt_no: payment.receipt_no, amount: payment.amount });
});

r.get('/payments/:id/receipt.pdf', feeReaders, async (req, res) => {
  const pid = parse(uuid, req.params.id);
  const data = await receiptData(pid);
  if (!data) throw notFound('Receipt not found');
  await assertStudentAccess(req.auth!, data.student_id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="receipt-${data.receipt_no.replace(/\//g, '-')}.pdf"`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(await receiptPdf(data));
});

/** One click: remind every family with dues (in-app + WhatsApp). At most once per family per day. */
r.post('/remind', office, async (req, res) => {
  const b = parse(z.strictObject({ class_id: id.optional(), overdue_only: z.boolean().default(false) }), req.body ?? {});
  const today = schoolToday();
  const result = await tx(async (db) => {
    const dues = await q(
      `SELECT b.student_id, SUM(b.balance) AS balance, MIN(b.due_on) AS due_on
         FROM fee_item_balances b JOIN students s ON s.id = b.student_id LEFT JOIN sections sec ON sec.id = s.section_id
        WHERE b.balance > 0 AND s.status = 'active' AND ($1::int IS NULL OR sec.class_id = $1) AND (NOT $2 OR b.due_on < CURRENT_DATE)
        GROUP BY b.student_id`,
      [b.class_id ?? null, b.overdue_only],
      db,
    );
    let messages = 0;
    for (const d of dues) {
      await notifyFamilies([d.student_id], { kind: 'fee_reminder', title: `Fee due · Rs. ${fmtMoney(d.balance)}`, body: `Due on ${fmtDate(d.due_on)}. Tap to pay.`, link: '/family/fees' }, db);
      messages += await whatsappFamilies(
        [d.student_id],
        (g) => ({ kind: 'fee_reminder', template: 'fee_reminder', params: [g.student_name, fmtMoney(d.balance), fmtDate(d.due_on), env.SCHOOL_NAME], dedupeKey: `fee_manual:${d.student_id}:${today}` }),
        db,
      );
    }
    return { students: dues.length, whatsapp: messages };
  });
  await audit(req, 'fees.reminded', 'fees', null, result);
  res.json(result);
});

// ── Online payments by parents ──────────────────────────────────────────────
r.post('/online/orders', requireRole('parent', 'student'), limits.payment, async (req, res) => {
  const b = parse(z.strictObject({ student_id: uuid, fee_item_ids: z.array(uuid).min(1).max(50) }), req.body);
  await assertFamilyOf(req.auth!, b.student_id);
  const out = await tx(async (db) => {
    // Re-use an open order for the same items instead of creating duplicates.
    const due = await lockBalances(db, b.student_id, b.fee_item_ids);
    const amount = Math.round(due.reduce((a, d) => a + d.balance, 0) * 100) / 100;
    const p = await q1(
      `INSERT INTO payments (student_id, amount, method, status, provider, initiated_by) VALUES ($1,$2,'online','created',$3,$4) RETURNING id`,
      [b.student_id, amount, paymentProvider.name, req.auth!.user.id],
      db,
    );
    for (const d of due) await q('INSERT INTO payment_allocations (payment_id, fee_item_id, amount) VALUES ($1,$2,$3)', [p!.id, d.id, d.balance], db);
    const order = await paymentProvider.createOrder(Math.round(amount * 100), p!.id, { payment_id: p!.id, student_id: b.student_id });
    await q('UPDATE payments SET provider_order_id = $2 WHERE id = $1', [p!.id, order.orderId], db);
    return { payment_id: p!.id, order_id: order.orderId, amount, amount_paise: order.amountPaise, items: due };
  });
  await audit(req, 'payment.order_created', 'payment', out.payment_id, { amount: out.amount });
  res.status(201).json({ ...out, provider: paymentProvider.name, key_id: paymentProvider.publicKey, school: env.SCHOOL_NAME, user: { name: req.auth!.user.full_name, phone: req.auth!.user.phone } });
});

r.post('/online/verify', requireRole('parent', 'student'), limits.payment, async (req, res) => {
  const b = parse(
    z.strictObject({ order_id: z.string().max(100), payment_id: z.string().max(100).optional(), signature: z.string().max(200).optional() }),
    req.body,
  );
  const p = await q1('SELECT id, student_id, status, provider FROM payments WHERE provider_order_id = $1', [b.order_id]);
  if (!p) throw notFound('Payment not found');
  await assertFamilyOf(req.auth!, p.student_id);
  if (p.status === 'paid') return void res.json({ ok: true, payment_id: p.id });

  if (paymentProvider.name === 'mock') {
    if (isProd) throw forbidden();
  } else if (!b.payment_id || !b.signature || !paymentProvider.verifyCheckout(b.order_id, b.payment_id, b.signature)) {
    await audit(req, 'payment.signature_invalid', 'payment', p.id);
    throw badRequest('We could not verify this payment. If money was deducted, it will be confirmed automatically.');
  }
  const done = await tx((db) => finalisePayment(db, p.id, { providerPaymentId: b.payment_id ?? `mock_pay_${p.id}` }));
  await audit(req, 'payment.online', 'payment', p.id, { amount: done.amount, receipt: done.receipt_no });
  res.json({ ok: true, payment_id: p.id, receipt_no: done.receipt_no });
});

/** Razorpay server-to-server webhook (raw body + HMAC). Mounted without session/CSRF. */
export async function razorpayWebhook(req: import('express').Request, res: import('express').Response) {
  const sig = req.get('x-razorpay-signature') ?? '';
  if (!req.rawBody || !paymentProvider.verifyWebhook(req.rawBody, sig)) {
    logger.warn({ ip: req.ip }, 'Rejected Razorpay webhook with bad signature');
    return void res.status(400).json({ error: 'invalid signature' });
  }
  const evt = JSON.parse(req.rawBody.toString('utf8'));
  const entity = evt?.payload?.payment?.entity;
  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && entity?.order_id) {
    const p = await q1('SELECT id, amount FROM payments WHERE provider_order_id = $1', [entity.order_id]);
    if (p && Math.round(Number(p.amount) * 100) === Number(entity.amount)) {
      const methodMap: Record<string, string> = { upi: 'upi', card: 'card', netbanking: 'netbanking' };
      await tx((db) => finalisePayment(db, p.id, { providerPaymentId: entity.id, method: methodMap[entity.method] ?? 'online' }));
      await audit(null, 'payment.webhook', 'payment', p.id, { event: evt.event });
    } else if (p) {
      logger.error({ order: entity.order_id }, 'Webhook amount mismatch — payment NOT marked as paid');
    }
  }
  if (evt.event === 'payment.failed' && entity?.order_id) {
    await q(`UPDATE payments SET status = 'failed' WHERE provider_order_id = $1 AND status = 'created'`, [entity.order_id]);
  }
  res.json({ ok: true });
}

export default r;
