import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { FamilyLayout, StaffLayout } from './components/layouts.tsx';
import { Spinner } from './components/ui.tsx';
import { ServerUnavailable } from './components/resilience.tsx';
import { homeFor, useAuth, type Role } from './lib/auth.tsx';
import {
  EventsList, FamilyAttendance, FamilyFees, FamilyHome, FamilyHomework, FamilyLibrary, FamilyMore, FamilyProgress, NoticesList, Notifications,
} from './pages/family.tsx';
import {
  AttendanceOverview, AuditPage, BirthdaysPage, EventsAdmin, FeesAdmin, MessagesPage, NoticesAdmin, OfficeDesk, PrincipalDashboard, ResultsPage, SetupPage, StudentsPage,
} from './pages/leadership.tsx';
import Login from './pages/Login.tsx';
import Profile from './pages/Profile.tsx';
import { TeacherAttendancePicker, TeacherAttendanceRoute, TeacherHome, TeacherHomework, TeacherLibrary, TeacherMarks } from './pages/teacher.tsx';

/** Client-side guard for navigation only — every permission is enforced again by the API. */
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!roles.includes(me.user.role)) return <Navigate to={homeFor(me.user.role)} replace />;
  return <>{children}</>;
}

const P: Role[] = ['principal'];
const PO: Role[] = ['principal', 'office'];
const POT: Role[] = ['principal', 'office', 'teacher'];
const PT: Role[] = ['principal', 'teacher'];
const T: Role[] = ['teacher'];
const F: Role[] = ['parent', 'student'];

export default function App() {
  const { me, loading, offline, refresh } = useAuth();
  if (loading) return <Spinner label="Opening Shastra Connect…" />;
  if (offline) return <ServerUnavailable onRetry={refresh} />;
  const g = (roles: Role[], el: ReactNode) => <Guard roles={roles}>{el}</Guard>;

  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to={homeFor(me.user.role)} replace /> : <Login />} />

      <Route element={g(POT, <StaffLayout />)}>
        <Route path="/principal" element={g(P, <PrincipalDashboard />)} />
        <Route path="/attendance" element={g(P, <AttendanceOverview />)} />
        <Route path="/results" element={g(P, <ResultsPage />)} />
        <Route path="/setup" element={g(P, <SetupPage />)} />
        <Route path="/audit" element={g(P, <AuditPage />)} />

        <Route path="/office" element={g(PO, <OfficeDesk />)} />
        <Route path="/fees" element={g(PO, <FeesAdmin />)} />
        <Route path="/birthdays" element={g(PO, <BirthdaysPage />)} />
        <Route path="/messages" element={g(PO, <MessagesPage />)} />

        <Route path="/students" element={g(POT, <StudentsPage />)} />
        <Route path="/notices" element={g(POT, <NoticesAdmin />)} />
        <Route path="/events" element={g(POT, <EventsAdmin />)} />
        <Route path="/notifications" element={g(POT, <Notifications />)} />
        <Route path="/profile" element={g(POT, <Profile />)} />

        <Route path="/teacher" element={g(T, <TeacherHome />)} />
        <Route path="/teacher/attendance" element={g(T, <TeacherAttendancePicker />)} />
        <Route path="/teacher/attendance/:sectionId" element={g(PT, <TeacherAttendanceRoute />)} />
        <Route path="/teacher/marks" element={g(T, <TeacherMarks />)} />
        <Route path="/teacher/homework" element={g(T, <TeacherHomework />)} />
        <Route path="/teacher/library" element={g(T, <TeacherLibrary />)} />
      </Route>

      <Route element={g(F, <FamilyLayout />)}>
        <Route path="/family" element={<FamilyHome />} />
        <Route path="/family/homework" element={<FamilyHomework />} />
        <Route path="/family/progress" element={<FamilyProgress />} />
        <Route path="/family/attendance" element={<FamilyAttendance />} />
        <Route path="/family/library" element={<FamilyLibrary />} />
        <Route path="/family/events" element={<EventsList />} />
        <Route path="/family/notices" element={<NoticesList />} />
        <Route path="/family/notifications" element={<Notifications />} />
        <Route path="/family/fees" element={<FamilyFees />} />
        <Route path="/family/more" element={<FamilyMore />} />
        <Route path="/family/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<Navigate to={me ? homeFor(me.user.role) : '/login'} replace />} />
    </Routes>
  );
}
