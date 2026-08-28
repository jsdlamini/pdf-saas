import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { getUserRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Lecturer view: who has attempted / solved what in a cohort. Owner or admin
// only. Returns challenges plus a per-member status matrix.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const cohortId = Number(new URL(request.url).searchParams.get("cohortId"));
  if (!cohortId) return jsonError("cohortId is required.", 400);

  await ensureMigrated();

  const cohort = await db.query(`SELECT created_by FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
  if (!cohort.rows.length) return jsonError("Cohort not found.", 404);

  const role = await getUserRole(userId);
  const isOwner = cohort.rows[0].created_by === userId;
  if (!isOwner && role !== "admin") return jsonError("Only the cohort creator can view progress.", 403);

  const challenges = await db.query(
    `SELECT id, slug, language, difficulty, points FROM wiserfiles_challenges ORDER BY CASE language WHEN 'python' THEN 0 ELSE 1 END, difficulty, id`
  );

  const members = await db.query(
    `SELECT user_id, display_name, opted_in FROM wiserfiles_leaderboard_opt_in WHERE cohort_id = $1 ORDER BY user_id`,
    [cohortId]
  );

  const solves = await db.query(
    `SELECT user_id, challenge_id FROM wiserfiles_challenge_solves WHERE cohort_id = $1`,
    [cohortId]
  );
  const attempts = await db.query(
    `SELECT DISTINCT user_id, challenge_id FROM wiserfiles_submissions WHERE cohort_id = $1`,
    [cohortId]
  );

  const solvedSet = new Set(solves.rows.map((r) => `${r.user_id}:${r.challenge_id}`));
  const attemptedSet = new Set(attempts.rows.map((r) => `${r.user_id}:${r.challenge_id}`));

  const rows = members.rows.map((m) => ({
    userId: m.user_id,
    displayName: (m.display_name || "Student").trim() || "Student",
    optedIn: Boolean(m.opted_in),
    statuses: challenges.rows.map((c) => {
      const key = `${m.user_id}:${c.id}`;
      return solvedSet.has(key) ? "solved" : attemptedSet.has(key) ? "attempted" : "none";
    }),
  }));

  return Response.json({
    cohortId,
    challenges: challenges.rows,
    members: rows,
  });
}
