import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Public (or member-only) contest page: contest info, its problem set, and the
// leaderboard. Hidden tests and starter code are never exposed here.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { userId } = await auth();

  await ensureMigrated();

  const contest = await db.query(
    `SELECT c.id, c.name, c.slug, c.description, c.starts_at, c.ends_at, c.scoring_mode, c.is_public, c.prizes, c.join_code, c.created_by,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS member_count
     FROM wiserfiles_cohorts c WHERE c.slug = $1`,
    [slug]
  );
  if (!contest.rows.length) return jsonError("Contest not found.", 404);
  const row = contest.rows[0];

  // Private contests require membership or hosting.
  if (!row.is_public) {
    if (!userId) return jsonError("Sign in required.", 401);
    const member = await db.query(
      `SELECT 1 FROM wiserfiles_enrollments WHERE cohort_id = $1 AND user_id = $2 AND status = 'active'`,
      [row.id, userId]
    );
    if (!member.rows.length) return jsonError("This contest is private.", 403);
  }

  const challenges = await db.query(
    `SELECT ch.id, ch.slug, ch.language, ch.difficulty, ch.points, ch.statement_md
     FROM wiserfiles_contest_challenges cc
     JOIN wiserfiles_challenges ch ON ch.id = cc.challenge_id
     WHERE cc.contest_id = $1
     ORDER BY cc.position`,
    [row.id]
  );

  const board = await db.query(
    `SELECT s.user_id, o.display_name, SUM(s.points) AS total_points, COUNT(*) AS solved_count
     FROM wiserfiles_challenge_solves s
     JOIN wiserfiles_leaderboard_opt_in o ON o.user_id = s.user_id AND o.cohort_id = s.cohort_id
     WHERE s.cohort_id = $1 AND o.opted_in = TRUE
     GROUP BY s.user_id, o.display_name
     ORDER BY total_points DESC, MIN(s.solved_at) ASC, s.user_id ASC
     LIMIT 100`,
    [row.id]
  );

  return Response.json({
    contest: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      scoringMode: row.scoring_mode,
      isPublic: row.is_public,
      prizes: row.prizes,
      joinCode: row.is_public ? null : row.join_code, // never leak the code publicly
      memberCount: row.member_count,
      isHost: row.created_by === userId,
    },
    challenges: challenges.rows,
    leaderboard: board.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      points: Number(r.total_points),
      solved: Number(r.solved_count),
    })),
  });
}
