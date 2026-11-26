import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useApi } from './api.ts';

export type Role = 'principal' | 'office' | 'teacher' | 'parent' | 'student';

export interface Child {
  id: string;
  full_name: string;
  admission_no: string;
  roll_no: number | null;
  dob: string | null;
  section_id: number | null;
  section_name: string | null;
  class_id: number | null;
  class_name: string | null;
}
export interface Me {
  user: { id: string; role: Role; full_name: string; email: string | null; phone: string | null };
  school: { name: string; shortName: string; city: string };
  payments: { provider: 'mock' | 'razorpay'; keyId: string | null };
  children?: Child[];
  mfa?: { enabled: boolean; enabled_at: string | null; recovery_left: number };
  classTeacherOf?: { section_id: number; section_name: string; class_id: number; class_name: string }[];
  teaches?: { section_id: number; section_name: string; class_id: number; class_name: string; subject_id: number; subject_name: string }[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** The API could not be reached (server down / network) - distinct from 'signed out'. */
  offline: boolean;
  child: Child | null;
  setChildId: (id: string) => void;
  logout: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQ = useApi<Me | { user: null }>('/auth/session', { retry: 1, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const me = meQ.error instanceof ApiError && meQ.error.status === 401 ? null : meQ.data?.user ? (meQ.data as Me) : null;
  const [childId, setChildId] = useState<string | null>(() => sessionStorage.getItem('sc_child'));

  useEffect(() => {
    const onOut = () => void qc.invalidateQueries({ queryKey: ['/auth/session'] });
    window.addEventListener('sc:signed-out', onOut);
    return () => window.removeEventListener('sc:signed-out', onOut);
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const kids = me?.children ?? [];
    const child = kids.find((c) => c.id === childId) ?? kids[0] ?? null;
    return {
      me,
      loading: meQ.isLoading,
      offline: !!meQ.error && !(meQ.error instanceof ApiError && meQ.error.status < 500),
      child,
      setChildId: (id) => {
        sessionStorage.setItem('sc_child', id);
        setChildId(id);
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        sessionStorage.clear();
        qc.clear();
        window.location.assign('/login');
      },
      refresh: () => void meQ.refetch(),
    };
  }, [me, meQ.isLoading, childId, qc, meQ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export const homeFor = (role: Role) =>
  ({ principal: '/principal', office: '/office', teacher: '/teacher', parent: '/family', student: '/family' })[role];
