import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { seedChallenges } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// List challenges (statements + starter code, never hidden tests).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await seedChallenges();

  const res = await db.query(
    `SELECT id, slug, language, difficulty, points, statement_md, starter_code
     FROM wiserfiles_challenges
     ORDER BY CASE language WHEN 'python' THEN 0 ELSE 1 END, CASE difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id`
  );

  return Response.json({ challenges: res.rows });
}
