import { Pool } from "pg";

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function ensureUserRolesTable() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_user_roles (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getUserRole(userId: string): Promise<"admin" | "user"> {
  await ensureUserRolesTable();
  const p = getPool();
  const result = await p.query(
    "SELECT role FROM wiserfiles_user_roles WHERE user_id = $1",
    [userId]
  );
  return (result.rows[0]?.role as "admin" | "user") || "user";
}

export async function ensureUserRecord(userId: string, email: string) {
  await ensureUserRolesTable();
  const p = getPool();
  await p.query(
    `INSERT INTO wiserfiles_user_roles (user_id, email, role) VALUES ($1, $2, 'user')
     ON CONFLICT (user_id) DO UPDATE SET email = $2, updated_at = NOW()`,
    [userId, email]
  );
}

export async function listAllUsers() {
  await ensureUserRolesTable();
  const p = getPool();
  const result = await p.query(
    "SELECT user_id, email, role, created_at, updated_at FROM wiserfiles_user_roles ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function setUserRole(userId: string, role: "admin" | "user", email: string) {
  await ensureUserRolesTable();
  const p = getPool();
  await p.query(
    `INSERT INTO wiserfiles_user_roles (user_id, email, role) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET role = $3, updated_at = NOW()`,
    [userId, email, role]
  );
}
