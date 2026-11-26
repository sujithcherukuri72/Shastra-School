import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError } from '../lib/api.ts';

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-2xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(20,33,61,0.04)]', className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-navy-400">{icon}</div>}
        <div>
          <h3 className="text-[15px] font-bold">{title}</h3>
          {subtitle && <p className="text-xs text-navy-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-red">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
export function Button({ variant = 'primary', loading, className, children, size = 'md', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-[15px]',
        variant === 'primary' && 'bg-navy-800 text-white hover:bg-navy-700',
        variant === 'gold' && 'bg-brand-gold text-navy-800 hover:brightness-95',
        variant === 'secondary' && 'border border-navy-200 bg-white text-navy-800 hover:bg-navy-50',
        variant === 'ghost' && 'text-navy-600 hover:bg-navy-50',
        variant === 'danger' && 'bg-brand-red text-white hover:brightness-95',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-navy-600">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-navy-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-bad">{error}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-navy-200 bg-white px-3 text-sm text-navy-800 placeholder:text-navy-300 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40 disabled:bg-navy-50';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(inputCls, 'h-10', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(inputCls, 'py-2', p.className)} />;
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={clsx(inputCls, 'h-10 pr-8', p.className)}>
    {children}
  </select>
);

type Tone = 'good' | 'bad' | 'warn' | 'info' | 'neutral' | 'gold' | 'navy';
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone | string; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap',
        tone === 'good' && 'bg-green-50 text-good',
        tone === 'bad' && 'bg-red-50 text-bad',
        tone === 'warn' && 'bg-amber-50 text-warn',
        tone === 'info' && 'bg-sky-50 text-sky-700',
        tone === 'neutral' && 'bg-navy-50 text-navy-500',
        tone === 'gold' && 'bg-brand-gold-soft text-navy-800',
        tone === 'navy' && 'bg-navy-800 text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn'; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-navy-400">{label}</span>
        {icon && <span className="text-navy-300">{icon}</span>}
      </div>
      <div className={clsx('mt-1 text-2xl font-extrabold tracking-tight', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-navy-400">{sub}</div>}
    </Card>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-navy-400" role="status">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && <div className="mb-2 text-navy-200">{icon}</div>}
      <div className="text-sm font-semibold text-navy-600">{title}</div>
      {children && <div className="mt-1 max-w-sm text-xs text-navy-400">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  const details = error instanceof ApiError ? error.details : undefined;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-bad" role="alert">
      {msg}
      {details && details.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {details.map((d, i) => (
            <li key={i}>
              {d.field ? `${d.field}: ` : ''}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders loading / error states around query data. */
export function Async<T>({ q, children }: { q: { data: T | undefined; isLoading: boolean; error: unknown }; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorBox error={q.error} /></div>;
  if (q.data === undefined) return null;
  return <>{children(q.data)}</>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className={clsx('m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-navy-800 shadow-2xl backdrop:bg-navy-900/50', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3">
            <h2 className="font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-lg p-1 text-navy-400 hover:bg-navy-50" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl bg-navy-50 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-lg px-3 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-white text-navy-800 shadow-sm' : 'text-navy-400 hover:text-navy-700')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-50">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={clsx('px-4 py-2.5', className)}>{children}</td>;

// ── Toasts ─────────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; tone: 'good' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'good' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg', t.tone === 'good' ? 'bg-navy-800 text-white' : 'bg-brand-red text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return <div className={clsx('flex shrink-0 items-center justify-center rounded-full bg-brand-gold-soft font-bold text-navy-800', className ?? 'size-9 text-xs')}>{letters}</div>;
}

export function Progress({ value, tone = 'navy' }: { value: number; tone?: 'navy' | 'good' | 'bad' | 'gold' }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-navy-50">
      <div
        className={clsx('h-full rounded-full', tone === 'navy' && 'bg-navy-800', tone === 'good' && 'bg-good', tone === 'bad' && 'bg-bad', tone === 'gold' && 'bg-brand-gold')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
