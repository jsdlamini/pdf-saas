import { db, ensureMigrated } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";

export async function ensureUserRolesTable() {
  await ensureMigrated();
}

export async function getUserRole(userId: string): Promise<"admin" | "user"> {
  await ensureMigrated();
  const result = await db.query(
    "SELECT role FROM wiserfiles_user_roles WHERE user_id = $1",
    [userId]
  );
  return (result.rows[0]?.role as "admin" | "user") || "user";
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

export async function setUserRole(userId: string, role: "admin" | "user", email: string) {
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

// A lecturer is an admin, or someone whose verified email matches a configured
// institutional domain (e.g. "uneswa.ac.sz" in wiserfiles_settings
// 'lecturer_email_domains').
export async function isLecturerOrAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === "admin") return true;
  const email = await getVerifiedEmail(userId);
  if (!email) return false;
  const r = await db.query(`SELECT value FROM wiserfiles_settings WHERE key = 'lecturer_email_domains'`);
  const domains = (r.rows[0]?.value || "")
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
