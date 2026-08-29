import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId, activeSeasonId } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Season + cohort bounded leaderboard. Only opted-in users appear; ranking is
// total points desc, then earliest first-solve asc.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const language = new URL(request.url).searchParams.get("language") || null;

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const seasonId = await activeSeasonId();

  const board = await db.query(
    `SELECT s.user_id, o.display_name,
            SUM(s.points) AS total_points,
            COUNT(*) AS solved_count,
            MIN(s.solved_at) AS first_solve_at
     FROM wiserfiles_challenge_solves s
     JOIN wiserfiles_leaderboard_opt_in o ON o.user_id = s.user_id AND o.cohort_id = s.cohort_id
     JOIN wiserfiles_challenges c ON c.id = s.challenge_id
     WHERE s.cohort_id = $1 AND ($2::int IS NULL OR s.season_id = $2) AND o.opted_in = TRUE
       AND ($3::text IS NULL OR c.language = $3)
       AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = $1)
            OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = $1))
     GROUP BY s.user_id, o.display_name
     ORDER BY total_points DESC, first_solve_at ASC, s.user_id ASC
     LIMIT 100`,
    [cohortId, seasonId || null, language]
  );

  const me = await db.query(
    `SELECT display_name, opted_in FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );

  return Response.json({
    cohortId,
    seasonId,
    entries: board.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      points: Number(r.total_points),
      solved: Number(r.solved_count),
      firstSolveAt: r.first_solve_at,
    })),
    me: me.rows.length
      ? { displayName: me.rows[0].display_name, optedIn: Boolean(me.rows[0].opted_in) }
      : { displayName: "", optedIn: false },
  });
}
