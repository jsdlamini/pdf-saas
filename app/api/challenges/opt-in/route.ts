import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Leaderboard consent only. Enrollment (cohort membership, student_id) lives in
// wiserfiles_enrollments and is managed by /api/enrollment and /api/cohorts.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const res = await db.query(
    `SELECT display_name, opted_in FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );
  return Response.json(
    res.rows.length ? { displayName: res.rows[0].display_name, optedIn: Boolean(res.rows[0].opted_in) } : { displayName: "", optedIn: false }
  );
}

// Set the leaderboard display name and opt-in state.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { displayName?: string; optedIn?: boolean } | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);

  await db.query(
    `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, display_name, opted_in)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, cohort_id) DO UPDATE SET display_name = EXCLUDED.display_name, opted_in = EXCLUDED.opted_in`,
    [userId, cohortId, (body.displayName || "").trim(), Boolean(body.optedIn)]
  );

  return Response.json({ ok: true });
}
