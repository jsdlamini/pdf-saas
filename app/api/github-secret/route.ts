import { auth } from "@clerk/nextjs/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function ensureSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_user_secrets (
      user_id TEXT PRIMARY KEY,
      github_token TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  const res = await pool.query(`SELECT updated_at FROM wiserfiles_user_secrets WHERE user_id = $1`, [userId]);
  await pool.end();

  return Response.json({ hasToken: res.rows.length > 0 });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = (body?.token || "").trim();
  if (!token) return jsonError("A GitHub token is required.", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO wiserfiles_user_secrets (user_id, github_token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET github_token = EXCLUDED.github_token, updated_at = NOW()`,
    [userId, token]
  );
  await pool.end();

  return Response.json({ ok: true });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  await pool.query(`DELETE FROM wiserfiles_user_secrets WHERE user_id = $1`, [userId]);
  await pool.end();

  return Response.json({ ok: true });
}
