import { db, ensureMigrated } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";

export async function ensureUserRolesTable() {
  await ensureMigrated();
}

export type UserRole = "admin" | "assistant" | "user";

export async function getUserRole(userId: string): Promise<UserRole> {
  await ensureMigrated();
  const result = await db.query(
    "SELECT role FROM wiserfiles_user_roles WHERE user_id = $1",
    [userId]
  );
  return (result.rows[0]?.role as UserRole) || "user";
}

export async function ensureUserRecord(userId: string, email: string) {
  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_user_roles (user_id, email, role) VALUES ($1, $2, 'user')
     ON CONFLICT (user_id) DO UPDATE SET email = $2, updated_at = NOW()`,
    [userId, email]
  );
}

export async function listAllUsers() {
  await ensureMigrated();
  const result = await db.query(
    "SELECT user_id, email, role, created_at, updated_at FROM wiserfiles_user_roles ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function setUserRole(userId: string, role: UserRole, email: string) {
  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_user_roles (user_id, email, role) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET role = $3, updated_at = NOW()`,
    [userId, email, role]
  );
}

export async function getVerifiedEmail(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primary = user.primaryEmailAddress?.emailAddress || "";
    return user.primaryEmailAddress?.verification?.status === "verified" ? primary : "";
  } catch {
    return "";
  }
}

export const LECTURER_EMAIL_DOMAINS_KEY = "lecturer_email_domains";
export const LECTURER_EMAIL_DOMAINS_DEFAULT = "uneswa.ac.sz";

// The configured lecturer email domains (comma-separated, lowercased). Falls
// back to the default institution domain only when the setting has never been
// written; an explicitly empty value means "domain gating is off".
export async function getLecturerEmailDomains(): Promise<string> {
  await ensureMigrated();
  const r = await db.query(`SELECT value FROM wiserfiles_settings WHERE key = $1`, [LECTURER_EMAIL_DOMAINS_KEY]);
  if (r.rows.length === 0) return LECTURER_EMAIL_DOMAINS_DEFAULT;
  return r.rows[0]?.value ?? LECTURER_EMAIL_DOMAINS_DEFAULT;
}

export async function setLecturerEmailDomains(value: string): Promise<string> {
  await ensureMigrated();
  const normalized = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
  await db.query(
    `INSERT INTO wiserfiles_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [LECTURER_EMAIL_DOMAINS_KEY, normalized]
  );
  return normalized;
}

// A lecturer is an admin, or someone whose verified email matches a configured
// institutional domain (default "uneswa.ac.sz", admin-settable).
export async function isLecturerOrAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === "admin") return true;
  const email = await getVerifiedEmail(userId);
  if (!email) return false;
  const domains = (await getLecturerEmailDomains())
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!domains.length) return false;
  return domains.some((d: string) => email.toLowerCase().endsWith(d));
}

// Per-cohort lecturer: an admin, the cohort creator, or anyone enrolled with
// role = 'lecturer' in that cohort. Used to gate cohort management (roster,
// analytics, progress, join-code regeneration).
export async function isCohortLecturer(userId: string, cohortId: number): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === "admin") return true;
  const cohort = await db.query(`SELECT created_by FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
  if (cohort.rows[0]?.created_by === userId) return true;
  const enr = await db.query(
    `SELECT 1 FROM wiserfiles_enrollments WHERE cohort_id = $1 AND user_id = $2 AND role = 'lecturer'`,
    [cohortId, userId]
  );
  return enr.rows.length > 0;
}

// Per-course teacher: an admin/lecturer, the course owner, or someone enrolled
// as a lecturer in one of the course's cohorts. Used to gate course management
// (join-code regeneration/revocation). Assistants do NOT count — they assess
// but never manage courses.
export async function isCourseTeacher(userId: string, courseId: number): Promise<boolean> {
  if (await isLecturerOrAdmin(userId)) return true;
  const course = await db.query(`SELECT owner_id FROM wiserfiles_courses WHERE id = $1`, [courseId]);
  if (course.rows[0]?.owner_id === userId) return true;
  const enr = await db.query(
    `SELECT 1 FROM wiserfiles_enrollments e
     JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
     WHERE c.course_id = $1 AND e.user_id = $2 AND e.role = 'lecturer'`,
    [courseId, userId]
  );
  return enr.rows.length > 0;
}
