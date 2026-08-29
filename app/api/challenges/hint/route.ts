import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Reveal the next hint for a challenge. Each hint costs hint_cost points,
// deducted from the competitor's contest score on the leaderboard.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { challengeId?: number } | null;
  if (!body?.challengeId) return jsonError("challengeId is required.", 400);

  await ensureMigrated();
  const ch = await db.query(`SELECT hints, hint_cost FROM wiserfiles_challenges WHERE id = $1`, [body.challengeId]);
  if (!ch.rows.length) return jsonError("Challenge not found.", 404);

  const hints = Array.isArray(ch.rows[0].hints) ? ch.rows[0].hints : [];
  const hintCost = Number(ch.rows[0].hint_cost) || 0;
  if (!hints.length) return jsonError("This challenge has no hints.", 404);

  const cohortId = await resolveCohortId(userId);
  const revealed = await db.query(
    `SELECT hint_index FROM wiserfiles_hint_reveals WHERE user_id = $1 AND challenge_id = $2 AND cohort_id = $3 ORDER BY hint_index`,
    [userId, body.challengeId, cohortId]
  );
  const nextIndex = revealed.rows.length;
  if (nextIndex >= hints.length) return jsonError("No more hints for this challenge.", 400);

  await db.query(
    `INSERT INTO wiserfiles_hint_reveals (user_id, challenge_id, cohort_id, hint_index, cost) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, challenge_id, cohort_id, hint_index) DO NOTHING`,
    [userId, body.challengeId, cohortId, nextIndex, hintCost]
  );

  return Response.json({
    hint: hints[nextIndex],
    cost: hintCost,
    hintsRevealed: nextIndex + 1,
    hintsTotal: hints.length,
  });
}
