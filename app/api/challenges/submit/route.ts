import { auth } from "@clerk/nextjs/server";
import { createHash } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";
import { gradeIoSubmission, gradeUnitSubmission, resolveCohortId, resolveTeamId, activeSeasonId, type HiddenTest, type UnitTestSpec } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Grade a submission against the challenge's hidden tests. IO tests feed stdin
// and compare trimmed stdout; results are recorded and a first solve is stored.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as {
    challengeId?: number;
    language?: "python" | "cpp";
    files?: { path: string; content: string }[];
    mainPath?: string;
    practice?: boolean;
  } | null;

  if (!body?.challengeId || !body.language || !Array.isArray(body.files) || !body.files.length) {
    return jsonError("Invalid payload.", 400);
  }

  await ensureMigrated();
  const ch = await db.query(`SELECT * FROM wiserfiles_challenges WHERE id = $1`, [body.challengeId]);
  if (!ch.rows.length) return jsonError("Challenge not found.", 404);
  const challenge = ch.rows[0];

  const mode = (challenge.test_mode as "io" | "pytest" | "doctest") || "io";
  let result;
  if (mode === "io") {
    const tests = Array.isArray(challenge.hidden_tests) ? (challenge.hidden_tests as HiddenTest[]) : [];
    result = await gradeIoSubmission(body.language, body.files, body.mainPath || body.files[0].path, tests);
  } else {
    const spec = challenge.hidden_tests as UnitTestSpec;
    result = await gradeUnitSubmission(mode, body.files, spec.test_file_path, spec.test_file);
  }
  const passed = result.total > 0 && result.passed === result.total;

  const cohortId = await resolveCohortId(userId);
  const seasonId = await activeSeasonId();

  // Team contests require the competitor to be on a team to submit.
  const teamId = await resolveTeamId(userId, cohortId);
  if (teamId === null) {
    const tm = await db.query(`SELECT team_mode FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
    if (tm.rows.length && tm.rows[0].team_mode) {
      return jsonError("This contest uses teams — join or create a team first.", 403);
    }
  }

  // Integrity: hash the (normalised) source so identical submissions within a
  // cohort can be surfaced by the analytics view.
  const sourceHash = createHash("sha256")
    .update(body.files.map((f) => `${f.path}:${f.content}`).join("\u0000"))
    .digest("hex");

  await db.query(
    `INSERT INTO wiserfiles_submissions (user_id, team_id, challenge_id, cohort_id, season_id, language, passed, tests_passed, tests_total, output, practice, source_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      userId,
      teamId,
      body.challengeId,
      cohortId || null,
      seasonId || null,
      body.language,
      passed,
      result.passed,
      result.total,
      JSON.stringify(result.results),
      Boolean(body.practice),
      sourceHash,
    ]
  );

  let firstSolve = false;
  // Practice runs never record a solve — no points, no leaderboard entry.
  if (passed && !body.practice) {
    const existing = teamId
      ? await db.query(
          `SELECT 1 FROM wiserfiles_challenge_solves WHERE team_id = $1 AND challenge_id = $2 AND cohort_id = $3`,
          [teamId, body.challengeId, cohortId]
        )
      : await db.query(
          `SELECT 1 FROM wiserfiles_challenge_solves WHERE user_id = $1 AND challenge_id = $2 AND cohort_id = $3`,
          [userId, body.challengeId, cohortId]
        );
    if (!existing.rows.length) {
      // ICPC penalty: wrong attempts before this solve, and minutes elapsed
      // since the contest started (+20 per wrong attempt).
      const wrong = teamId
        ? await db.query(
            `SELECT COUNT(*)::int AS n FROM wiserfiles_submissions
             WHERE team_id = $1 AND challenge_id = $2 AND cohort_id = $3 AND passed = FALSE`,
            [teamId, body.challengeId, cohortId]
          )
        : await db.query(
            `SELECT COUNT(*)::int AS n FROM wiserfiles_submissions
             WHERE user_id = $1 AND challenge_id = $2 AND cohort_id = $3 AND passed = FALSE`,
            [userId, body.challengeId, cohortId]
          );
      const wrongAttempts = wrong.rows[0]?.n || 0;

      let penaltyMinutes: number | null = null;
      const contest = await db.query(
        `SELECT starts_at, scoring_mode FROM wiserfiles_cohorts WHERE id = $1`,
        [cohortId]
      );
      if (contest.rows.length && contest.rows[0].scoring_mode === "icpc" && contest.rows[0].starts_at) {
        const elapsedMin = Math.max(0, Math.floor((Date.now() - new Date(contest.rows[0].starts_at).getTime()) / 60000));
        penaltyMinutes = elapsedMin + 20 * wrongAttempts;
      }

      await db.query(
        `INSERT INTO wiserfiles_challenge_solves (user_id, team_id, challenge_id, cohort_id, season_id, points, wrong_attempts, penalty_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, teamId, body.challengeId, cohortId, seasonId || null, challenge.points, wrongAttempts, penaltyMinutes]
      );
      firstSolve = true;
    }
  }

  return Response.json({ passed, firstSolve, total: result.total, results: result.results });
}
