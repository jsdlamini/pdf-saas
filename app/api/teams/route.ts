import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function teamCode(): string {
  return randomBytes(3).toString("hex").toUpperCase().slice(0, 6);
}

// GET: list teams for a contest and the caller's own team within it.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  const contestId = Number(new URL(request.url).searchParams.get("contestId"));
  if (!contestId) return jsonError("contestId is required.", 400);

  await ensureMigrated();
  const teams = await db.query(
    `SELECT t.id, t.name, t.captain_user_id, t.join_code,
            (SELECT COUNT(*)::int FROM wiserfiles_team_members m WHERE m.team_id = t.id) AS member_count
     FROM wiserfiles_teams t WHERE t.contest_id = $1 ORDER BY t.id`,
    [contestId]
  );
  const mine = await db.query(
    `SELECT tm.team_id FROM wiserfiles_team_members tm JOIN wiserfiles_teams t ON t.id = tm.team_id
     WHERE t.contest_id = $1 AND tm.user_id = $2 LIMIT 1`,
    [contestId, userId]
  );
  return Response.json({ teams: teams.rows, myTeamId: mine.rows.length ? mine.rows[0].team_id : null });
}

// POST { action: "create" | "join", contestId, name?, joinCode? }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();
  const contestId = Number(body.contestId);
  if (!contestId) return jsonError("contestId is required.", 400);

  if (body.action === "create") {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("A team name is required.", 400);
    const ins = await db.query(
      `INSERT INTO wiserfiles_teams (contest_id, name, captain_user_id, join_code) VALUES ($1, $2, $3, $4) RETURNING id, name, join_code`,
      [contestId, name, userId, teamCode()]
    );
    await db.query(
      `INSERT INTO wiserfiles_team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ins.rows[0].id, userId]
    );
    return Response.json({ team: ins.rows[0] });
  }

  if (body.action === "join") {
    const code = String(body.joinCode || "").trim().toUpperCase();
    if (!code) return jsonError("Enter a team code.", 400);
    const team = await db.query(`SELECT id FROM wiserfiles_teams WHERE contest_id = $1 AND join_code = $2`, [contestId, code]);
    if (!team.rows.length) return jsonError("Team code not found.", 404);
    await db.query(
      `INSERT INTO wiserfiles_team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [team.rows[0].id, userId]
    );
    return Response.json({ ok: true, teamId: team.rows[0].id });
  }

  return jsonError("Unknown action.", 400);
}
