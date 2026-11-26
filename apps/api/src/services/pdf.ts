import PDFDocument from 'pdfkit';
import { env } from '../config/env.ts';
import { fmtDate, fmtMoney, fmtMonth } from '../lib/dates.ts';
import type { monthlyReport } from './performance.ts';

const NAVY = '#14213D';
const RED = '#E31B23';
const GOLD = '#FFB81C';
const MUTED = '#5B6478';
const STRIPE = ['#D7312B', '#F27D16', '#FBD10F', '#77C13D', '#55C6E2', '#3F8BC1', '#475D92'];

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string) {
  const w = doc.page.width;
  doc.rect(0, 0, w, 86).fill(NAVY);
  STRIPE.forEach((c, i) => doc.rect((w / STRIPE.length) * i, 86, w / STRIPE.length + 1, 5).fill(c));
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(env.SCHOOL_NAME, 40, 26);
  const contact = [env.SCHOOL_ADDRESS || env.SCHOOL_CITY, env.SCHOOL_PHONE].filter(Boolean).join('  ·  ');
  doc.fillColor('#D9DEEA').font('Helvetica').fontSize(9).text(contact, 40, 50, { width: w - 220 });
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(), 40, 28, { align: 'right', width: w - 80 });
  doc.moveDown(0).fillColor(NAVY);
  doc.y = 112;
}

function kv(doc: PDFKit.PDFDocument, pairs: [string, string][], x: number, y: number, colW: number) {
  pairs.forEach(([k, v], i) => {
    const cx = x + (i % 2) * colW;
    const cy = y + Math.floor(i / 2) * 34;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(k.toUpperCase(), cx, cy);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(v || '—', cx, cy + 11, { width: colW - 10 });
  });
  return y + Math.ceil(pairs.length / 2) * 34;
}

type Report = Awaited<ReturnType<typeof monthlyReport>>;

export async function reportCardPdf(r: Report): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Report card – ${r.student?.full_name}`, Author: env.SCHOOL_NAME } });
  header(doc, `Progress report · ${fmtMonth(r.month)}`);
  const st = r.student ?? {};
  let y = kv(
    doc,
    [
      ['Student', st.full_name],
      ['Class', st.class_name ? `${st.class_name} – ${st.section_name}` : ''],
      ['Admission no.', st.admission_no],
      ['Roll no.', st.roll_no ? String(st.roll_no) : ''],
      ['Attendance', r.attendance.pct == null ? 'No school days recorded' : `${r.attendance.pct}%  (${r.attendance.present}/${r.attendance.total} days)`],
      ['Overall', r.overall ? `${r.overall.pct}%  ·  Grade ${r.overall.grade}` : 'No published tests this month'],
    ],
    40,
    112,
    258,
  );

  y += 14;
  const cols = [40, 250, 345, 440];
  doc.rect(40, y, 515, 24).fill('#F1F3F8');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9);
  ['SUBJECT', 'SCORE %', 'CLASS AVG %', 'GRADE'].forEach((h, i) => doc.text(h, cols[i]! + 8, y + 8));
  y += 24;
  doc.font('Helvetica').fontSize(10);
  if (!r.subjects.length) {
    doc.fillColor(MUTED).text('No published marks for this month.', 48, y + 10);
    y += 34;
  }
  for (const s of r.subjects) {
    doc.fillColor(NAVY).text(s.subject, cols[0]! + 8, y + 8);
    doc.text(s.pct == null ? '—' : String(s.pct), cols[1]! + 8, y + 8);
    doc.fillColor(MUTED).text(s.class_avg == null ? '—' : String(s.class_avg), cols[2]! + 8, y + 8);
    doc.fillColor(s.grade && s.grade <= 'B2' ? NAVY : RED).font('Helvetica-Bold').text(s.grade ?? '—', cols[3]! + 8, y + 8);
    doc.font('Helvetica');
    y += 26;
    doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor('#E2E6EF').stroke();
  }

  y += 18;
  if (r.strongest || r.focus) {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10);
    if (r.strongest) doc.text(`Strongest subject: ${r.strongest.subject} (${r.strongest.pct}%)`, 40, y);
    if (r.focus) doc.text(`Needs focus: ${r.focus.subject} (${r.focus.pct}%)`, 300, y);
    y += 26;
  }
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text("CLASS TEACHER'S REMARK", 40, y);
  doc.fillColor(NAVY).font('Helvetica-Oblique').fontSize(11).text(r.remark ?? '—', 40, y + 12, { width: 515 });
  y = doc.y + 40;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(st.class_teacher ? `Class teacher: ${st.class_teacher}` : 'Class teacher', 40, y);
  doc.text('Principal', 40, y, { align: 'right', width: 515 });
  doc.fontSize(7).text(`Grades: A1 91–100 · A2 81–90 · B1 71–80 · B2 61–70 · C1 51–60 · C2 41–50 · D 33–40 · E below 33.  Generated ${fmtDate(new Date().toISOString().slice(0, 10))}.`, 40, 790, { width: 515, align: 'center' });
  return toBuffer(doc);
}

export interface ReceiptData {
  receipt_no: string;
  paid_at: string;
  amount: number;
  method: string;
  reference: string | null;
  student_name: string;
  admission_no: string;
  class_label: string;
  items: { term: string; title: string; amount: number }[];
}

export async function receiptPdf(r: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A5', margin: 32, info: { Title: `Receipt ${r.receipt_no}`, Author: env.SCHOOL_NAME } });
  header(doc, 'Fee receipt');
  let y = kv(
    doc,
    [
      ['Receipt no.', r.receipt_no],
      ['Date', fmtDate(r.paid_at.slice(0, 10))],
      ['Student', r.student_name],
      ['Class', r.class_label],
      ['Admission no.', r.admission_no],
      ['Paid by', r.method.toUpperCase() + (r.reference ? ` · ${r.reference}` : '')],
    ],
    32,
    112,
    180,
  );
  y += 12;
  doc.rect(32, y, doc.page.width - 64, 22).fill('#F1F3F8');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('FEE ITEM', 40, y + 7).text('AMOUNT (Rs.)', 32, y + 7, { align: 'right', width: doc.page.width - 72 });
  y += 26;
  doc.font('Helvetica').fontSize(10);
  for (const it of r.items) {
    doc.fillColor(NAVY).text(`${it.term} · ${it.title}`, 40, y);
    doc.text(fmtMoney(it.amount), 32, y, { align: 'right', width: doc.page.width - 72 });
    y += 20;
  }
  doc.moveTo(32, y).lineTo(doc.page.width - 32, y).strokeColor(NAVY).lineWidth(1).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(12).text('Total paid', 40, y).text(`Rs. ${fmtMoney(r.amount)}`, 32, y, { align: 'right', width: doc.page.width - 72 });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('This is a computer-generated receipt and does not need a signature.', 32, doc.page.height - 50, { align: 'center', width: doc.page.width - 64 });
  return toBuffer(doc);
}

/** A simple placeholder PDF (used by the demo seed for textbooks, worksheets and papers). */
export async function samplePdf(title: string, lines: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  header(doc, 'Library');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text(title, 50, 130);
  doc.moveDown().font('Helvetica').fontSize(11).fillColor(MUTED);
  for (const l of lines) doc.text(l).moveDown(0.5);
  return toBuffer(doc);
}
