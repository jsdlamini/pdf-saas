import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId, activeSeasonId } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Season + contest bounded leaderboard. Every joined competitor appears (even
// with zero solves); teams appear in team contests. "solve" ranks by total
// points; "icpc" ranks by solved count then penalty.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const language = new URL(request.url).searchParams.get("language") || null;

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const seasonId = await activeSeasonId();

  const contest = await db.query(
    `SELECT scoring_mode, freeze_at, team_mode FROM wiserfiles_cohorts WHERE id = $1`,
    [cohortId]
  );
  const scoringMode = contest.rows[0]?.scoring_mode || "solve";
  const teamMode = Boolean(contest.rows[0]?.team_mode);
  const freezeAt = contest.rows[0]?.freeze_at || null;
  const frozen = freezeAt ? new Date(freezeAt).getTime() < Date.now() : false;

  // Common filters applied to the solve side of each LEFT JOIN, so a competitor
  // with no (eligible) solves still appears with zero.
  const solveJoin = `
    AND ($2::int IS NULL OR s.season_id = $2)
    AND ($4::timestamptz IS NULL OR s.solved_at <= $4)
    AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = $1)
         OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = $1))
    AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM wiserfiles_challenges c WHERE c.id = s.challenge_id AND c.language = $3))`;

  let board;
  if (teamMode) {
    board = scoringMode === "icpc"
      ? await db.query(
          `SELECT t.id AS team_id, t.name AS display_name,
                  COUNT(s.challenge_id)::int AS solved,
                  COALESCE(SUM(s.penalty_minutes), 0)::int AS total_penalty
           FROM wiserfiles_teams t
           LEFT JOIN wiserfiles_challenge_solves s
             ON s.team_id = t.id AND s.cohort_id = t.contest_id
             ${solveJoin}
           WHERE t.contest_id = $1
           GROUP BY t.id, t.name
           ORDER BY solved DESC, total_penalty ASC, t.id ASC
           LIMIT 200`,
          [cohortId, seasonId || null, null, frozen ? freezeAt : null]
        )
      : await db.query(
          `SELECT t.id AS team_id, t.name AS display_name,
                  COALESCE(SUM(s.points), 0) AS total_points,
                  COUNT(s.challenge_id)::int AS solved_count,
                  MIN(s.solved_at) AS first_solve_at
           FROM wiserfiles_teams t
           LEFT JOIN wiserfiles_challenge_solves s
             ON s.team_id = t.id AND s.cohort_id = t.contest_id
             ${solveJoin}
           WHERE t.contest_id = $1
           GROUP BY t.id, t.name
           ORDER BY total_points DESC, first_solve_at ASC, t.id ASC
           LIMIT 200`,
          [cohortId, seasonId || null, null, frozen ? freezeAt : null]
        );
  } else {
    board = scoringMode === "icpc"
      ? await db.query(
          `SELECT o.user_id, o.display_name,
                  COUNT(s.challenge_id)::int AS solved,
                  COALESCE(SUM(s.penalty_minutes), 0)::int AS total_penalty
           FROM wiserfiles_leaderboard_opt_in o
           LEFT JOIN wiserfiles_challenge_solves s
             ON s.user_id = o.user_id AND s.cohort_id = o.cohort_id
             ${solveJoin}
           WHERE o.cohort_id = $1 AND o.opted_in = TRUE
             AND NOT EXISTS (SELECT 1 FROM wiserfiles_enrollments e WHERE e.user_id = o.user_id AND e.cohort_id = o.cohort_id AND e.is_disqualified)
           GROUP BY o.user_id, o.display_name
           ORDER BY solved DESC, total_penalty ASC, o.user_id ASC
           LIMIT 200`,
          [cohortId, seasonId || null, language, frozen ? freezeAt : null]
        )
      : await db.query(
          `SELECT o.user_id, o.display_name,
                  COALESCE(SUM(s.points), 0) - COALESCE(MAX(h.hint_cost), 0) AS total_points,
                  COUNT(s.challenge_id)::int AS solved_count,
                  MIN(s.solved_at) AS first_solve_at
           FROM wiserfiles_leaderboard_opt_in o
           LEFT JOIN wiserfiles_challenge_solves s
             ON s.user_id = o.user_id AND s.cohort_id = o.cohort_id
             ${solveJoin}
           LEFT JOIN (SELECT user_id, cohort_id, SUM(cost) AS hint_cost FROM wiserfiles_hint_reveals GROUP BY user_id, cohort_id) h
             ON h.user_id = o.user_id AND h.cohort_id = o.cohort_id
           WHERE o.cohort_id = $1 AND o.opted_in = TRUE
             AND NOT EXISTS (SELECT 1 FROM wiserfiles_enrollments e WHERE e.user_id = o.user_id AND e.cohort_id = o.cohort_id AND e.is_disqualified)
           GROUP BY o.user_id, o.display_name
           ORDER BY total_points DESC, first_solve_at ASC, o.user_id ASC
           LIMIT 200`,
          [cohortId, seasonId || null, language, frozen ? freezeAt : null]
        );
  }

  const me = await db.query(
    `SELECT display_name, opted_in FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );

  return Response.json({
    cohortId,
    seasonId,
    scoringMode,
    teamMode,
    frozen,
    entries: board.rows.map((r) => ({
      userId: teamMode ? `team-${r.team_id}` : r.user_id,
      displayName: r.display_name,
      points: scoringMode === "icpc" ? Number(r.solved) : Number(r.total_points),
      solved: Number(r.solved ?? r.solved_count ?? 0),
      penalty: scoringMode === "icpc" ? Number(r.total_penalty) : undefined,
      firstSolveAt: r.first_solve_at,
    })),
    me: me.rows.length
      ? { displayName: me.rows[0].display_name, optedIn: Boolean(me.rows[0].opted_in) }
      : { displayName: "", optedIn: false },
  });
}
