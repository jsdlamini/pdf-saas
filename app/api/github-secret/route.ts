import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  const res = await db.query(`SELECT updated_at FROM wiserfiles_user_secrets WHERE user_id = $1`, [userId]);

  return Response.json({ hasToken: res.rows.length > 0 });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = (body?.token || "").trim();
  if (!token) return jsonError("A GitHub token is required.", 400);

  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_user_secrets (user_id, github_token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET github_token = EXCLUDED.github_token, updated_at = NOW()`,
    [userId, encryptSecret(token)]
  );

  return Response.json({ ok: true });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  await db.query(`DELETE FROM wiserfiles_user_secrets WHERE user_id = $1`, [userId]);

  return Response.json({ ok: true });
}
