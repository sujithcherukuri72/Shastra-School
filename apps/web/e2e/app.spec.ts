import { expect, test } from '@playwright/test';
import { loginFamily, loginStaff, PHONE, sql, visit, watch } from './helpers.ts';

// One school day, end to end, in the order it happens. Tests share the database, so they run in sequence.
test.describe.configure({ mode: 'serial' });

test('login page renders (never blank)', async ({ page }) => {
  const w = watch(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Send code on WhatsApp/ })).toBeVisible();
  w.assertClean();
});

test('a stopped server shows a clear message, not a blank page', async ({ page }) => {
  await page.route('**/api/auth/session', (r) => r.fulfill({ status: 502, body: '' }));
  await page.goto('/');
  await expect(page.getByText('Can’t reach the Shastra Connect server')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('Principal: two-step login set-up, then every screen', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const w = watch(page);
  await loginStaff(page, 'principal@shastra.school');
  await expect(page).toHaveURL(/\/principal$/);
  await expect(page.getByText('How is the school today?')).toBeVisible();
  await expect(page.getByText('Where help is needed')).toBeVisible();

  for (const [path, text] of [
    ['/students', '180 students'],
    ['/attendance', 'Class teachers mark attendance'],
    ['/results', 'Exams & results'],
    ['/fees', 'Fee setup & reports'],
    ['/notices', 'Announcements'],
    ['/events', 'Events'],
    ['/birthdays', 'Automatic birthday wishes'],
    ['/messages', 'WhatsApp log'],
    ['/setup', 'Staff accounts'],
    ['/audit', 'mfa.enrolled'],
    ['/profile', 'Two-step login'],
  ] as const) await visit(page, path, text);

  // Staff list shows the two-step status; the principal's own is On.
  await page.goto('/setup');
  await expect(page.getByRole('row', { name: /Dr\. Srinivas Reddy/ }).getByText('On')).toBeVisible();

  // Post an announcement to families with WhatsApp.
  await page.goto('/notices');
  await page.getByLabel('Title').fill('E2E: School closes early on Friday');
  await page.getByLabel('Message').fill('School will close at 1 pm this Friday for staff training.');
  await page.getByLabel('Also send on WhatsApp to parents').check();
  await page.getByRole('button', { name: 'Post announcement' }).click();
  await expect(page.getByText(/Posted · WhatsApp to \d+ parents/)).toBeVisible();
  w.assertClean();
});

test('Principal: second sign-in asks for the 6-digit code', async ({ page }) => {
  const w = watch(page);
  await loginStaff(page, 'principal@shastra.school'); // secret now known -> "verify" path
  await expect(page.getByText('How is the school today?')).toBeVisible();
  w.assertClean();
});

test('Teacher (phone): attendance, marks and homework', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const w = watch(page);
  await loginStaff(page, 'teacher@shastra.school'); // teachers have no two-step login
  await expect(page.getByText(/Good (morning|afternoon), Lakshmi/)).toBeVisible();

  // Attendance: tap Aarav once = Absent, submit -> parents alerted.
  await page.goto('/teacher/attendance');
  await page.getByRole('button', { name: /Aarav Reddy/ }).click();
  await expect(page.getByRole('button', { name: /Aarav Reddy/ })).toContainText('A');
  await page.getByRole('button', { name: /Submit attendance|Update attendance/ }).click();
  await expect(page.getByText(/WhatsApp alert sent|Attendance saved/)).toBeVisible();

  // Marks: enter a mark, grade appears automatically, save.
  await page.goto('/teacher/marks');
  const first = page.getByLabel('Marks for Aarav Reddy');
  await first.fill('23');
  await expect(page.getByText('A1').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save marks' }).click();
  await expect(page.getByText(/Saved marks for \d+ students/)).toBeVisible();

  // Homework diary.
  await page.goto('/teacher/homework');
  await page.getByLabel('Homework').fill('E2E: Exercise 7.1 questions 1-5');
  await page.getByRole('button', { name: 'Post homework' }).click();
  await expect(page.getByText('Homework posted')).toBeVisible();

  await visit(page, '/teacher/library', 'Uploads');
  await visit(page, '/teacher', 'Today’s attendance');
  w.assertClean();
});

test('Parent (phone): sees the absence, adds a reason, sees homework and pays a fee', async ({ page }) => {
  await page.setViewportSize(PHONE);
  const w = watch(page);
  await loginFamily(page, '9000000001');
  await expect(page.getByText('Hello! Here’s Aarav’s day')).toBeVisible();
  await expect(page.getByText('Marked absent today')).toBeVisible();

  // Absence reason.
  await page.getByText('Marked absent today').click();
  await expect(page).toHaveURL(/\/family\/attendance$/);
  await page.getByRole('button', { name: /Add reason/ }).first().click();
  await page.getByLabel('Why was your child away?').fill('E2E: Fever, visited the doctor.');
  await page.getByRole('button', { name: 'Save reason' }).click();
  await expect(page.getByText('Reason sent to the class teacher')).toBeVisible();

  // Homework posted by the teacher is in the diary.
  await visit(page, '/family/homework', 'E2E: Exercise 7.1');

  // Notice from the principal reached the family.
  await visit(page, '/family/notifications', 'E2E: School closes early on Friday');

  // Pay fees (test gateway) -> receipt.
  await page.goto('/family/fees');
  await page.getByRole('button', { name: /Pay .* securely/ }).click();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByText(/Payment received · receipt SHS\//)).toBeVisible();

  for (const [path, text] of [
    ['/family/progress', 'Weekly test trend'],
    ['/family/library', 'Library'],
    ['/family/events', 'Science Exhibition'],
    ['/family/notices', 'E2E: School closes early on Friday'],
    ['/family/more', 'Profile & security'],
    ['/family/profile', 'Profile & security'],
  ] as const) await visit(page, path, text);

  // Switch to the second child.
  await page.goto('/family');
  await page.getByLabel('Choose child').selectOption({ label: 'Ananya Reddy · 6-B' });
  await expect(page.getByText('Hello! Here’s Ananya’s day')).toBeVisible();
  w.assertClean();
});

test('Office: two-step login, fees desk shows the online payment, every screen loads', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const w = watch(page);
  await loginStaff(page, 'office@shastra.school');
  await expect(page).toHaveURL(/\/office$/);
  await page.getByPlaceholder('Search name or admission no.').fill('Aarav Reddy');
  await page.getByRole('button', { name: /Aarav Reddy/ }).first().click();
  await expect(page.getByText(/upi \(online\)|online \(online\)/).first()).toBeVisible();

  for (const [path, text] of [
    ['/fees', 'Fee setup & reports'],
    ['/students', 'Students'],
    ['/birthdays', 'Automatic birthday wishes'],
    ['/messages', 'absence'],
    ['/notices', 'E2E: School closes early on Friday'],
    ['/events', 'Events'],
    ['/profile', 'Two-step login'],
  ] as const) await visit(page, path, text);

  // Office cannot open Principal-only screens.
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/office$/);
  w.assertClean();
});

test('WhatsApp outbox delivered the absence alert and the payment receipt', async () => {
  const kinds = sql(`SELECT string_agg(DISTINCT kind, ',') FROM wa_messages WHERE status IN ('sent','delivered','read') AND created_at > now() - interval '15 minutes'`);
  expect(kinds).toContain('absence');
  expect(kinds).toContain('payment_receipt');
  expect(kinds).toContain('notice');
});
