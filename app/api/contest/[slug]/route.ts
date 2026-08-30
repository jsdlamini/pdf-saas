import { auth, currentUser } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Public (or member-only) contest page: contest info, problem set, and a
// ranked leaderboard with winners. Hidden tests and starter code are never
// exposed here.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { userId } = await auth();
  const code = new URL(request.url).searchParams.get("code") || "";

  await ensureMigrated();

  const contest = await db.query(
    `SELECT c.id, c.name, c.slug, c.description, c.starts_at, c.ends_at, c.scoring_mode, c.is_public, c.prizes, c.join_code, c.created_by, c.freeze_at, c.team_mode,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS member_count
     FROM wiserfiles_cohorts c WHERE c.slug = $1`,
    [slug]
  );
  if (!contest.rows.length) return jsonError("Contest not found.", 404);
  const row = contest.rows[0];

  let isMember = false;
  if (userId) {
    const member = await db.query(
      `SELECT 1 FROM wiserfiles_enrollments WHERE cohort_id = $1 AND user_id = $2 AND status = 'active'`,
      [row.id, userId]
    );
    isMember = member.rows.length > 0;
  }

  // Private contests require membership, hosting, or a valid invite code
  // (so a QR/deep link carrying ?code= can open the page and allow joining).
  let canJoin = false;
  if (!row.is_public && !isMember) {
    if (code && code.toUpperCase() === String(row.join_code || "").toUpperCase()) {
      canJoin = true;
    } else {
      return jsonError("This contest is private.", 403);
    }
  }

  const challenges = await db.query(
    `SELECT ch.id, ch.slug, ch.language, ch.difficulty, ch.points, ch.statement_md
     FROM wiserfiles_contest_challenges cc
     JOIN wiserfiles_challenges ch ON ch.id = cc.challenge_id
     WHERE cc.contest_id = $1
     ORDER BY cc.position`,
    [row.id]
  );

  // Mark which challenges the viewer has already solved.
  const solvedSet = new Set<number>();
  if (userId) {
    const solves = await db.query(
      `SELECT challenge_id FROM wiserfiles_challenge_solves WHERE user_id = $1 AND cohort_id = $2`,
      [userId, row.id]
    );
    for (const s of solves.rows) solvedSet.add(Number(s.challenge_id));
  }
  const challengeList = challenges.rows.map((c) => ({ ...c, solved: solvedSet.has(Number(c.id)) }));

  const scoringMode = row.scoring_mode || "solve";
  const teamMode = Boolean(row.team_mode);
  const freezeAt = row.freeze_at || null;
  const frozen = freezeAt ? new Date(freezeAt).getTime() < Date.now() : false;

  const board = teamMode
    ? (scoringMode === "icpc"
        ? await db.query(
            `WITH ranked AS (
               SELECT t.id AS team_id, t.name AS display_name,
                      COUNT(s.challenge_id)::int AS solved,
                      COALESCE(SUM(s.penalty_minutes), 0)::int AS total_penalty
               FROM wiserfiles_teams t
               LEFT JOIN wiserfiles_challenge_solves s
                 ON s.team_id = t.id AND s.cohort_id = t.contest_id
                AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = t.contest_id)
                     OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = t.contest_id))
                AND ($1::timestamptz IS NULL OR s.solved_at <= $1)
               WHERE t.contest_id = $2
               GROUP BY t.id, t.name
             )
             SELECT *, ROW_NUMBER() OVER (ORDER BY solved DESC, total_penalty ASC, team_id ASC) AS rank
             FROM ranked ORDER BY rank LIMIT 200`,
            [frozen ? freezeAt : null, row.id]
          )
        : await db.query(
            `WITH ranked AS (
               SELECT t.id AS team_id, t.name AS display_name,
                      COALESCE(SUM(s.points), 0) AS total_points,
                      COUNT(s.challenge_id)::int AS solved_count,
                      MIN(s.solved_at) AS first_solve_at
               FROM wiserfiles_teams t
               LEFT JOIN wiserfiles_challenge_solves s
                 ON s.team_id = t.id AND s.cohort_id = t.contest_id
                AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = t.contest_id)
                     OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = t.contest_id))
                AND ($1::timestamptz IS NULL OR s.solved_at <= $1)
               WHERE t.contest_id = $2
               GROUP BY t.id, t.name
             )
             SELECT *, ROW_NUMBER() OVER (ORDER BY total_points DESC, first_solve_at ASC, team_id ASC) AS rank
             FROM ranked ORDER BY rank LIMIT 200`,
            [frozen ? freezeAt : null, row.id]
          ))
    : (scoringMode === "icpc"
        ? await db.query(
            `WITH ranked AS (
               SELECT o.user_id, o.display_name,
                      COUNT(s.challenge_id)::int AS solved,
                      COALESCE(SUM(s.penalty_minutes), 0)::int AS total_penalty
               FROM wiserfiles_leaderboard_opt_in o
               LEFT JOIN wiserfiles_challenge_solves s
                 ON s.user_id = o.user_id AND s.cohort_id = o.cohort_id
                AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = o.cohort_id)
                     OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = o.cohort_id))
                AND ($1::timestamptz IS NULL OR s.solved_at <= $1)
               WHERE o.cohort_id = $2 AND o.opted_in = TRUE
                 AND NOT EXISTS (SELECT 1 FROM wiserfiles_enrollments e WHERE e.user_id = o.user_id AND e.cohort_id = o.cohort_id AND e.is_disqualified)
               GROUP BY o.user_id, o.display_name
             )
             SELECT *, ROW_NUMBER() OVER (ORDER BY solved DESC, total_penalty ASC, user_id ASC) AS rank
             FROM ranked ORDER BY rank LIMIT 200`,
            [frozen ? freezeAt : null, row.id]
          )
        : await db.query(
            `WITH ranked AS (
               SELECT o.user_id, o.display_name,
                      COALESCE(SUM(s.points), 0) - COALESCE(MAX(h.hint_cost), 0) AS total_points,
                      COUNT(s.challenge_id)::int AS solved_count,
                      MIN(s.solved_at) AS first_solve_at
               FROM wiserfiles_leaderboard_opt_in o
               LEFT JOIN wiserfiles_challenge_solves s
                 ON s.user_id = o.user_id AND s.cohort_id = o.cohort_id
                AND (NOT EXISTS (SELECT 1 FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = o.cohort_id)
                     OR s.challenge_id IN (SELECT challenge_id FROM wiserfiles_contest_challenges WHERE contest_id = o.cohort_id))
                AND ($1::timestamptz IS NULL OR s.solved_at <= $1)
               LEFT JOIN (SELECT user_id, cohort_id, SUM(cost) AS hint_cost FROM wiserfiles_hint_reveals GROUP BY user_id, cohort_id) h
                 ON h.user_id = o.user_id AND h.cohort_id = o.cohort_id
               WHERE o.cohort_id = $2 AND o.opted_in = TRUE
                 AND NOT EXISTS (SELECT 1 FROM wiserfiles_enrollments e WHERE e.user_id = o.user_id AND e.cohort_id = o.cohort_id AND e.is_disqualified)
               GROUP BY o.user_id, o.display_name
             )
             SELECT *, ROW_NUMBER() OVER (ORDER BY total_points DESC, first_solve_at ASC, user_id ASC) AS rank
             FROM ranked ORDER BY rank LIMIT 200`,
            [frozen ? freezeAt : null, row.id]
          ));

  const prizes = Array.isArray(row.prizes) ? row.prizes : [];
  const winnerCount = prizes.length;
  const leaderboard = board.rows.map((r) => {
    const rank = Number(r.rank);
    return {
      rank,
      userId: teamMode ? `team-${r.team_id}` : r.user_id,
      displayName: r.display_name,
      points: scoringMode === "icpc" ? Number(r.solved) : Number(r.total_points),
      solved: Number(r.solved ?? r.solved_count ?? 0),
      penalty: scoringMode === "icpc" ? Number(r.total_penalty) : undefined,
      isWinner: winnerCount > 0 && rank <= winnerCount,
      prize: winnerCount > 0 && rank <= winnerCount ? prizes[rank - 1]?.label || null : null,
    };
  });

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
      teamMode,
      freezeAt: row.freeze_at,
      frozen,
      prizes,
      joinCode: row.is_public ? null : row.join_code, // never leak the code publicly
      memberCount: row.member_count,
      isHost: row.created_by === userId,
      isMember,
      canJoin,
    },
    challenges: challengeList,
    leaderboard,
  });
}

// Join a public contest directly from its page (frictionless: sign in and go).
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();

  const contest = await db.query(
    `SELECT id, is_public, join_code, join_code_expires_at, join_code_max_uses, join_code_uses FROM wiserfiles_cohorts WHERE slug = $1`,
    [slug]
  );
  if (!contest.rows.length) return jsonError("Contest not found.", 404);
  const row = contest.rows[0];

  // Private contests require the invite code (carried by the QR/deep link).
  if (!row.is_public) {
    const code = String((await request.json().catch(() => null))?.code || "").trim().toUpperCase();
    if (!code || code !== String(row.join_code || "").toUpperCase()) {
      return jsonError("This contest is private — enter the invite code to join.", 403);
    }
  }

  if (row.join_code_expires_at && new Date(row.join_code_expires_at).getTime() < Date.now()) {
    return jsonError("Registration has closed for this contest.", 410);
  }
  if (row.join_code_max_uses != null && Number(row.join_code_uses) >= Number(row.join_code_max_uses)) {
    return jsonError("This contest is full.", 410);
  }

  const contestId = Number(row.id);
  await db.query(
    `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status)
     VALUES ($1, $2, 'student', 'active')
     ON CONFLICT (user_id, cohort_id) DO UPDATE SET status = 'active', joined_at = NOW()`,
    [userId, contestId]
  );
  await db.query(`UPDATE wiserfiles_cohorts SET join_code_uses = join_code_uses + 1 WHERE id = $1`, [contestId]);

  // Auto-opt the competitor into the leaderboard with a default display name,
  // so they show up without a separate opt-in step.
  const user = await currentUser();
  const displayName = user?.username || user?.firstName || "Competitor";
  await db.query(
    `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, display_name, opted_in)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (user_id, cohort_id) DO NOTHING`,
    [userId, contestId, displayName]
  );

  return Response.json({ ok: true, contestId });
}
