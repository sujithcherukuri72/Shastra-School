import clsx from 'clsx';
import {
  Bell, BookOpen, CalendarDays, CalendarCheck, Cake, ClipboardList, FileText, GraduationCap, Home, IndianRupee, LayoutDashboard,
  LibraryBig, LogOut, Megaphone, Menu, MessageCircle, MoreHorizontal, NotebookPen, ScrollText, Settings2, ShieldCheck, TrendingUp, User, Users, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useApi } from '../lib/api.ts';
import { useAuth, type Role } from '../lib/auth.tsx';
import { Avatar } from './ui.tsx';

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-9 rounded-xl" />
      {!compact && (
        <div className="leading-tight">
          <div className={clsx('font-display text-lg font-semibold', light ? 'text-white' : 'text-navy-800')}>Shastra</div>
          <div className={clsx('text-[10px] font-bold uppercase tracking-[0.18em]', light ? 'text-brand-gold' : 'text-brand-red')}>Connect</div>
        </div>
      )}
    </div>
  );
}

type Item = { to: string; label: string; icon: ReactNode; end?: boolean };
const I = (C: typeof Home) => <C className="size-[18px]" strokeWidth={2} />;

const NAV: Record<'principal' | 'office' | 'teacher', Item[]> = {
  principal: [
    { to: '/principal', label: 'Dashboard', icon: I(LayoutDashboard), end: true },
    { to: '/students', label: 'Students', icon: I(Users) },
    { to: '/attendance', label: 'Attendance', icon: I(CalendarCheck) },
    { to: '/results', label: 'Exams & results', icon: I(GraduationCap) },
    { to: '/fees', label: 'Fees', icon: I(IndianRupee) },
    { to: '/notices', label: 'Announcements', icon: I(Megaphone) },
    { to: '/events', label: 'Events', icon: I(CalendarDays) },
    { to: '/birthdays', label: 'Birthday wishes', icon: I(Cake) },
    { to: '/messages', label: 'WhatsApp log', icon: I(MessageCircle) },
    { to: '/setup', label: 'Staff & classes', icon: I(Settings2) },
    { to: '/audit', label: 'Audit log', icon: I(ShieldCheck) },
  ],
  office: [
    { to: '/office', label: 'Fees desk', icon: I(IndianRupee), end: true },
    { to: '/fees', label: 'Fee setup & reports', icon: I(FileText) },
    { to: '/students', label: 'Students', icon: I(Users) },
    { to: '/birthdays', label: 'Birthday wishes', icon: I(Cake) },
    { to: '/messages', label: 'WhatsApp log', icon: I(MessageCircle) },
    { to: '/notices', label: 'Announcements', icon: I(Megaphone) },
    { to: '/events', label: 'Events', icon: I(CalendarDays) },
  ],
  teacher: [
    { to: '/teacher', label: 'Home', icon: I(Home), end: true },
    { to: '/teacher/attendance', label: 'Attendance', icon: I(CalendarCheck) },
    { to: '/teacher/marks', label: 'Marks', icon: I(ClipboardList) },
    { to: '/teacher/homework', label: 'Diary', icon: I(NotebookPen) },
    { to: '/teacher/library', label: 'Uploads', icon: I(LibraryBig) },
    { to: '/notices', label: 'Notices', icon: I(Megaphone) },
  ],
};

function NotificationBell({ to }: { to: string }) {
  const q = useApi<{ unread: number }>('/notifications', { refetchInterval: 60_000 });
  return (
    <NavLink to={to} className="relative rounded-xl p-2 text-current hover:bg-white/10" aria-label="Notifications">
      <Bell className="size-5" />
      {!!q.data?.unread && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold text-white">
          {q.data.unread > 99 ? '99+' : q.data.unread}
        </span>
      )}
    </NavLink>
  );
}

export function StaffLayout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const role = me!.user.role as 'principal' | 'office' | 'teacher';
  const items = NAV[role];
  const roleLabel = { principal: 'Principal', office: 'School Office', teacher: 'Teacher' }[role];

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white')
          }
        >
          {it.icon}
          {it.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar (desktop) / drawer (mobile) */}
      <aside className={clsx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-800 transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="stripe h-1" />
        <div className="flex items-center justify-between px-5 py-4">
          <Logo light />
          <button className="rounded-lg p-1 text-navy-200 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        {nav}
        <div className="border-t border-white/10 p-3">
          <NavLink to="/profile" className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
            <Avatar name={me!.user.full_name} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{me!.user.full_name}</div>
              <div className="text-xs text-navy-300">{roleLabel}</div>
            </div>
          </NavLink>
          <button onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-navy-200 hover:bg-white/5 hover:text-white">
            <LogOut className="size-[18px]" /> Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-navy-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-navy-100 bg-white/90 px-4 py-2.5 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 text-navy-600 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo compact />
          </div>
          <div className="hidden text-sm text-navy-400 lg:block">{me!.school.name}</div>
        </div>
        <div className="flex items-center gap-1 text-navy-600">
          <NotificationBell to="/notifications" />
        </div>
      </header>

      <main key={loc.pathname} className={clsx('mx-auto max-w-7xl px-4 py-6 lg:px-8', role === 'teacher' && 'pb-24 lg:pb-6')}>
        <Outlet />
      </main>

      {/* Teachers work from the phone: bottom tab bar on small screens */}
      {role === 'teacher' && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-navy-100 bg-white lg:hidden">
          {items.slice(0, 5).map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 pt-2 text-[10px] font-semibold', isActive ? 'text-navy-800' : 'text-navy-300')}>
              {it.icon}
              {it.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

const FAMILY_TABS: Item[] = [
  { to: '/family', label: 'Home', icon: I(Home), end: true },
  { to: '/family/homework', label: 'Diary', icon: I(BookOpen) },
  { to: '/family/progress', label: 'Progress', icon: I(TrendingUp) },
  { to: '/family/fees', label: 'Fees', icon: I(IndianRupee) },
  { to: '/family/more', label: 'More', icon: I(MoreHorizontal) },
];

export function FamilyLayout() {
  const { me, child, setChildId } = useAuth();
  const kids = me?.children ?? [];
  const loc = useLocation();
  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-paper pb-24">
      <header className="sticky top-0 z-20 bg-navy-800 text-white">
        <div className="stripe h-1" />
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Logo light compact />
          {kids.length > 1 ? (
            <select
              value={child?.id}
              onChange={(e) => setChildId(e.target.value)}
              className="min-w-0 flex-1 truncate rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white focus:outline-none"
              aria-label="Choose child"
            >
              {kids.map((k) => (
                <option key={k.id} value={k.id} className="text-navy-800">
                  {k.full_name} · {k.class_name?.replace('Class ', '')}-{k.section_name}
                </option>
              ))}
            </select>
          ) : (
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">
              {child?.full_name} <span className="text-navy-300">· {child?.class_name}-{child?.section_name}</span>
            </div>
          )}
          <NotificationBell to="/family/notifications" />
        </div>
      </header>
      <main key={loc.pathname + (child?.id ?? '')} className="px-4 py-4">
        {child ? <Outlet /> : <div className="py-20 text-center text-sm text-navy-400">No student is linked to this number yet. Please contact the school office.</div>}
      </main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-xl grid-cols-5 border-t border-navy-100 bg-white">
        {FAMILY_TABS.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 pt-2 text-[10px] font-semibold', isActive ? 'text-navy-800' : 'text-navy-300')}>
            {it.icon}
            {it.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export const familyMoreLinks: Item[] = [
  { to: '/family/attendance', label: 'Attendance', icon: I(CalendarCheck) },
  { to: '/family/library', label: 'Library', icon: I(LibraryBig) },
  { to: '/family/events', label: 'Events', icon: I(CalendarDays) },
  { to: '/family/notifications', label: 'Notifications', icon: I(Bell) },
  { to: '/family/notices', label: 'Notices', icon: I(ScrollText) },
  { to: '/family/profile', label: 'Profile & security', icon: I(User) },
];

export const isStaff = (r: Role) => r === 'principal' || r === 'office' || r === 'teacher';
