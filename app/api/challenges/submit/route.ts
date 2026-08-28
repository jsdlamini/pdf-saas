import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { gradeIoSubmission, resolveCohortId, activeSeasonId, type HiddenTest } from "@/lib/challenges";

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
  } | null;

  if (!body?.challengeId || !body.language || !Array.isArray(body.files) || !body.files.length) {
    return jsonError("Invalid payload.", 400);
  }

  await ensureMigrated();
  const ch = await db.query(`SELECT * FROM wiserfiles_challenges WHERE id = $1`, [body.challengeId]);
  if (!ch.rows.length) return jsonError("Challenge not found.", 404);
  const challenge = ch.rows[0];

  const tests = Array.isArray(challenge.hidden_tests) ? (challenge.hidden_tests as HiddenTest[]) : [];
  const result = await gradeIoSubmission(body.language, body.files, body.mainPath || body.files[0].path, tests);
  const passed = result.total > 0 && result.passed === result.total;

  const cohortId = await resolveCohortId(userId);
  const seasonId = await activeSeasonId();

  await db.query(
    `INSERT INTO wiserfiles_submissions (user_id, challenge_id, cohort_id, season_id, language, passed, tests_passed, tests_total, output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      body.challengeId,
      cohortId || null,
      seasonId || null,
      body.language,
      passed,
      result.passed,
      result.total,
      JSON.stringify(result.results),
    ]
  );

  let firstSolve = false;
  if (passed) {
    const existing = await db.query(
      `SELECT 1 FROM wiserfiles_challenge_solves WHERE user_id = $1 AND challenge_id = $2 AND cohort_id = $3`,
      [userId, body.challengeId, cohortId]
    );
    if (!existing.rows.length) {
      await db.query(
        `INSERT INTO wiserfiles_challenge_solves (user_id, challenge_id, cohort_id, season_id, points)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, body.challengeId, cohortId, seasonId || null, challenge.points]
      );
      firstSolve = true;
    }
  }

  return Response.json({ passed, firstSolve, total: result.total, results: result.results });
}
