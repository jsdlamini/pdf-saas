import { auth } from "@clerk/nextjs/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("Missing projectId", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_project_invites (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL DEFAULT '',
      invited_by TEXT NOT NULL,
      shared_with_email TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `SELECT * FROM wiserfiles_project_invites WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  await pool.end();
  return Response.json({ invites: result.rows });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json();
  const { projectId, projectName, email, accessLevel } = body as {
    projectId?: string; projectName?: string; email?: string; accessLevel?: string;
  };

  if (!projectId || !email || !accessLevel) return jsonError("Missing fields", 400);
  if (!["read", "write", "admin"].includes(accessLevel)) return jsonError("Invalid access level", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_project_invites (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL DEFAULT '',
      invited_by TEXT NOT NULL,
      shared_with_email TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `INSERT INTO wiserfiles_project_invites (project_id, project_name, invited_by, shared_with_email, access_level)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
    [projectId, projectName || "", userId, email.toLowerCase().trim(), accessLevel]
  );
  await pool.end();
  return Response.json({ invite: result.rows[0] });
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const inviteId = url.searchParams.get("id");
  if (!inviteId) return jsonError("Missing invite id", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await pool.query(`DELETE FROM wiserfiles_project_invites WHERE id = $1 AND invited_by = $2`, [inviteId, userId]);
  await pool.end();
  return Response.json({ ok: true });
}
