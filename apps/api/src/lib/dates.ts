import { env } from '../config/env.ts';

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.SCHOOL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
};

/** Today's date in the school's timezone, as YYYY-MM-DD. */
export function schoolToday(now = new Date()) {
  const p = parts(now);
  return `${p.y}-${p.m}-${p.d}`;
}

/** Current HH:MM in the school's timezone. */
export function schoolTime(now = new Date()) {
  const p = parts(now);
  return `${p.hh}:${p.mm}`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthStart(iso: string) {
  return iso.slice(0, 8) + '01';
}

export function prevMonthStart(iso: string) {
  const d = new Date(`${iso.slice(0, 8)}01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtMonth(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function fmtMoney(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
