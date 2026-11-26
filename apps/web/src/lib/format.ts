const TZ = 'Asia/Kolkata';

export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export const fmtDate = (d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d).toLocaleDateString('en-IN', { timeZone: TZ, ...opts }) : '—';

export const fmtDateLong = (d: string | null | undefined) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const fmtTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '';

export const fmtDateTime = (d: string | null | undefined) => (d ? `${fmtDate(d)} · ${fmtTime(d)}` : '—');

export const rupees = (n: number | string | null | undefined) =>
  '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const pct = (n: number | string | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(Number(n) % 1 ? 1 : 0)}%`);

export const relDays = (iso: string) => {
  const diff = Math.round((new Date(`${iso}T00:00:00+05:30`).getTime() - new Date(`${todayISO()}T00:00:00+05:30`).getTime()) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export const gradeTone = (g: string | null | undefined) =>
  !g ? 'neutral' : g.startsWith('A') ? 'good' : g.startsWith('B') ? 'info' : g.startsWith('C') ? 'warn' : 'bad';
