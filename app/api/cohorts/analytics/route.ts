import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { isCohortLecturer } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Lecturer analytics for a cohort: per-challenge attempt/pass rates, integrity
// flags for byte-identical submissions, and the lowest pass-rate challenges.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const cohortId = Number(new URL(request.url).searchParams.get("cohortId"));
  if (!cohortId) return jsonError("cohortId is required.", 400);

  await ensureMigrated();
  if (!(await isCohortLecturer(userId, cohortId))) return jsonError("Lecturer access required.", 403);

  // Per-challenge: attempts and pass rate (graded submissions only).
  const perChallenge = await db.query(
    `SELECT c.id, c.slug, c.language, c.points,
            COUNT(s.id)::int AS attempts,
            COUNT(DISTINCT s.user_id)::int AS students,
            COUNT(*) FILTER (WHERE s.passed)::int AS passes,
            ROUND(100.0 * COUNT(*) FILTER (WHERE s.passed) / NULLIF(COUNT(*), 0), 1) AS pass_rate
     FROM wiserfiles_challenges c
     LEFT JOIN wiserfiles_submissions s ON s.challenge_id = c.id AND s.cohort_id = $1 AND s.practice = FALSE
     GROUP BY c.id, c.slug, c.language, c.points
     ORDER BY pass_rate ASC NULLS FIRST, attempts DESC`,
    [cohortId]
  );

  // Integrity: identical (non-practice) source hashes shared by >1 student.
  const identical = await db.query(
    `SELECT challenge_id, source_hash, COUNT(DISTINCT user_id)::int AS students, COUNT(*)::int AS submissions
     FROM wiserfiles_submissions
     WHERE cohort_id = $1 AND practice = FALSE AND source_hash IS NOT NULL
     GROUP BY challenge_id, source_hash
     HAVING COUNT(DISTINCT user_id) > 1
     ORDER BY students DESC, submissions DESC
     LIMIT 50`,
    [cohortId]
  );

  // Where the class is stuck: challenges with attempts but zero passes.
  const stuck = perChallenge.rows.filter((r) => Number(r.attempts) > 0 && Number(r.passes) === 0);

  return Response.json({
    cohortId,
    perChallenge: perChallenge.rows,
    identical,
    stuck,
  });
}
