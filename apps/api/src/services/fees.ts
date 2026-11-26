import type pg from 'pg';
import { env } from '../config/env.ts';
import { type Db, pool, q, q1 } from '../db/pool.ts';
import { badRequest, conflict, notFound } from '../lib/http.ts';
import { fmtMoney } from '../lib/dates.ts';
import { notifyFamilies, whatsappFamilies } from './notify.ts';

export async function ledger(studentId: string, db: Db = pool) {
  const items = await q(
    `SELECT b.id, b.term, b.title, b.amount, b.paid, b.balance, b.due_on, ay.name AS academic_year,
            CASE WHEN b.balance <= 0 THEN 'paid' WHEN b.paid > 0 THEN 'part_paid'
                 WHEN b.due_on < CURRENT_DATE THEN 'overdue' ELSE 'due' END AS status
       FROM fee_item_balances b LEFT JOIN academic_years ay ON ay.id = b.academic_year_id
      WHERE b.student_id = $1
      ORDER BY b.due_on, b.title`,
    [studentId],
    db,
  );
  const payments = await q(
    `SELECT p.id, p.amount, p.method, p.status, p.receipt_no, p.reference, p.paid_at, p.provider, u.full_name AS recorded_by
       FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.student_id = $1 AND p.status = 'paid'
      ORDER BY p.paid_at DESC`,
    [studentId],
    db,
  );
  const sum = (k: string) => items.reduce((a, i) => a + Number(i[k]), 0);
  return { items, payments, totals: { amount: sum('amount'), paid: sum('paid'), balance: sum('balance') } };
}

/**
 * Lock the chosen fee items and work out how much is outstanding on each.
 * The amount charged is always computed here — never taken from the client.
 */
export async function lockBalances(db: pg.PoolClient, studentId: string, feeItemIds: string[]) {
  if (!feeItemIds.length) throw badRequest('Choose at least one fee item');
  await q('SELECT id FROM fee_items WHERE id = ANY($1::uuid[]) AND student_id = $2 FOR UPDATE', [feeItemIds, studentId], db);
  const rows = await q(
    'SELECT id, term, title, balance FROM fee_item_balances WHERE id = ANY($1::uuid[]) AND student_id = $2',
    [feeItemIds, studentId],
    db,
  );
  if (rows.length !== new Set(feeItemIds).size) throw notFound('Fee item not found for this student');
  const due = rows.filter((r) => r.balance > 0);
  if (!due.length) throw conflict('These fees are already paid');
  return due as { id: string; term: string; title: string; balance: number }[];
}

async function nextReceiptNo(db: Db) {
  const r = await q1(
    `SELECT nextval('receipt_seq') AS n, (SELECT name FROM academic_years WHERE is_current) AS year`,
    [],
    db,
  );
  return `${env.RECEIPT_PREFIX}/${r!.year ?? new Date().getFullYear()}/${String(r!.n).padStart(6, '0')}`;
}

/** Mark a payment as paid, give it a receipt number and tell the family (in-app + WhatsApp). */
export async function finalisePayment(db: pg.PoolClient, paymentId: string, patch: { method?: string; providerPaymentId?: string | null }) {
  const p = await q1('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId], db);
  if (!p) throw notFound('Payment not found');
  if (p.status === 'paid') return p; // idempotent: webhook + browser callback may both arrive
  const receipt = await nextReceiptNo(db);
  const done = await q1(
    `UPDATE payments SET status = 'paid', receipt_no = $2, paid_at = now(),
            method = COALESCE($3, method), provider_payment_id = COALESCE($4, provider_payment_id)
      WHERE id = $1 RETURNING *`,
    [paymentId, receipt, patch.method ?? null, patch.providerPaymentId ?? null],
    db,
  );
  const st = await q1('SELECT full_name FROM students WHERE id = $1', [p.student_id], db);
  await notifyFamilies(
    [p.student_id],
    { kind: 'fee_paid', title: `Payment received · Rs. ${fmtMoney(p.amount)}`, body: `Receipt ${receipt} for ${st?.full_name}.`, link: '/family/fees' },
    db,
  );
  await whatsappFamilies(
    [p.student_id],
    (g) => ({
      kind: 'payment_receipt',
      template: 'payment_receipt',
      params: [g.student_name, fmtMoney(p.amount), receipt, env.SCHOOL_NAME],
      dedupeKey: `receipt:${paymentId}`,
    }),
    db,
  );
  return done;
}

export async function receiptData(paymentId: string, db: Db = pool) {
  const p = await q1(
    `SELECT p.*, s.full_name AS student_name, s.admission_no, c.name AS class_name, sec.name AS section_name
       FROM payments p JOIN students s ON s.id = p.student_id
       LEFT JOIN sections sec ON sec.id = s.section_id LEFT JOIN classes c ON c.id = sec.class_id
      WHERE p.id = $1 AND p.status = 'paid'`,
    [paymentId],
    db,
  );
  if (!p) return null;
  const items = await q(
    `SELECT fi.term, fi.title, pa.amount FROM payment_allocations pa JOIN fee_items fi ON fi.id = pa.fee_item_id
      WHERE pa.payment_id = $1 ORDER BY fi.due_on`,
    [paymentId],
    db,
  );
  return {
    student_id: p.student_id as string,
    receipt_no: p.receipt_no as string,
    paid_at: new Date(p.paid_at).toISOString(),
    amount: Number(p.amount),
    method: p.method as string,
    reference: p.reference as string | null,
    student_name: p.student_name as string,
    admission_no: p.admission_no as string,
    class_label: p.class_name ? `${p.class_name} – ${p.section_name}` : '',
    items: items.map((i) => ({ term: i.term, title: i.title, amount: Number(i.amount) })),
  };
}
