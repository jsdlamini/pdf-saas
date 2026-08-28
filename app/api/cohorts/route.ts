import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";
import { activeSeasonId, resolveCohortId } from "@/lib/challenges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function joinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

// GET: the cohorts available (the default plus any the user created).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  await ensureMigrated();

  const res = await db.query(
    `SELECT id, name, join_code, season_id FROM wiserfiles_cohorts WHERE created_by = 'system' OR created_by = $1 ORDER BY id`,
    [userId]
  );
  const myCohortId = await resolveCohortId(userId);
  return Response.json({ cohorts: res.rows, myCohortId });
}

// POST { action: "create", name } or { action: "join", joinCode }.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { action?: string; name?: string; joinCode?: string } | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();

  if (body.action === "create") {
    const name = (body.name || "").trim();
    if (!name) return jsonError("A cohort name is required.", 400);
    const seasonId = await activeSeasonId();
    const code = joinCode();
    const ins = await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, season_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, join_code`,
      [name, code, seasonId || null, userId]
    );
    return Response.json({ cohort: ins.rows[0] });
  }

  if (body.action === "join") {
    const code = (body.joinCode || "").trim().toUpperCase();
    if (!code) return jsonError("Enter a join code.", 400);
    const cohort = await db.query(`SELECT id, season_id FROM wiserfiles_cohorts WHERE join_code = $1`, [code]);
    if (!cohort.rows.length) return jsonError("Join code not found.", 404);

    const cohortId = cohort.rows[0].id;
    const seasonId = cohort.rows[0].season_id ?? (await activeSeasonId());
    await db.query(
      `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, season_id, display_name, opted_in)
       VALUES ($1, $2, $3, '', FALSE)
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET cohort_id = EXCLUDED.cohort_id`,
      [userId, cohortId, seasonId]
    );
    return Response.json({ ok: true, cohortId });
  }

  return jsonError("Unknown action.", 400);
}
