import { db, ensureMigrated } from "@/lib/db";

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
