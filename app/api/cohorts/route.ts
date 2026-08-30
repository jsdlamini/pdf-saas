import { auth, currentUser } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";
import { activeSeasonId, resolveCohortId } from "@/lib/challenges";
import { isCohortLecturer } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function joinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

function slug(): string {
  return `c-${randomBytes(4).toString("hex")}`;
}

// GET: contests (the caller's, plus public ones) and the caller's memberships.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  await ensureMigrated();

  const contests = await db.query(
    `SELECT c.id, c.name, c.join_code, c.slug, c.description, c.starts_at, c.ends_at,
            c.scoring_mode, c.is_public, c.team_mode, c.prizes, c.course_id, c.season_id, c.created_by,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS member_count,
            (SELECT COUNT(*)::int FROM wiserfiles_contest_challenges cc WHERE cc.contest_id = c.id) AS challenge_count
     FROM wiserfiles_cohorts c
     WHERE c.created_by = 'system' OR c.created_by = $1 OR c.is_public = TRUE
     ORDER BY c.id DESC`,
    [userId]
  );
  const enrollments = await db.query(
    `SELECT e.cohort_id, e.role, e.status, e.student_id, e.joined_at
     FROM wiserfiles_enrollments e
     WHERE e.user_id = $1 AND e.status = 'active'
     ORDER BY e.joined_at DESC`,
    [userId]
  );
  const myCohortId = await resolveCohortId(userId);

  return Response.json({ contests: contests.rows, myCohortId, enrollments: enrollments.rows });
}

// POST { action: "create" | "join" | "regenerate", ... }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();

  // ── Create a contest (anyone can host) ──────────────────────────
  if (body.action === "create") {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("A contest name is required.", 400);

    const seasonId = await activeSeasonId();
    const description = String(body.description || "").trim();
    const startsAt = body.startsAt ? new Date(String(body.startsAt)).toISOString() : null;
    const endsAt = body.endsAt ? new Date(String(body.endsAt)).toISOString() : null;
    const scoringMode = body.scoringMode === "icpc" ? "icpc" : "solve";
    const isPublic = Boolean(body.isPublic);
    const teamMode = Boolean(body.teamMode);
    const prizes = Array.isArray(body.prizes) ? JSON.stringify(body.prizes) : null;

    const ins = await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, slug, description, starts_at, ends_at, scoring_mode, is_public, prizes, season_id, created_by, team_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12) RETURNING id, name, join_code, slug`,
      [name, joinCode(), slug(), description, startsAt, endsAt, scoringMode, isPublic, prizes, seasonId || null, userId, teamMode]
    );

    // The creator is the host of their own contest.
    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status) VALUES ($1, $2, 'lecturer', 'active')
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET role = 'lecturer', status = 'active'`,
      [userId, ins.rows[0].id]
    );

    // Assign the selected challenges.
    const slugs = (Array.isArray(body.challengeSlugs) ? body.challengeSlugs : []).map((s) => String(s).trim()).filter(Boolean);
    for (let i = 0; i < slugs.length; i++) {
      const ch = await db.query(`SELECT id FROM wiserfiles_challenges WHERE slug = $1`, [slugs[i]]);
      if (ch.rows.length) {
        await db.query(
          `INSERT INTO wiserfiles_contest_challenges (contest_id, challenge_id, position) VALUES ($1, $2, $3)
           ON CONFLICT (contest_id, challenge_id) DO NOTHING`,
          [ins.rows[0].id, ch.rows[0].id, i]
        );
      }
    }

    return Response.json({ contest: ins.rows[0] });
  }

  // ── Join a contest by invite code ───────────────────────────────
  if (body.action === "join") {
    const code = String(body.joinCode || "").trim().toUpperCase();
    if (!code) return jsonError("Enter an invite code.", 400);

    const contest = await db.query(
      `SELECT id, season_id, join_code_expires_at, join_code_max_uses, join_code_uses FROM wiserfiles_cohorts WHERE join_code = $1`,
      [code]
    );
    if (!contest.rows.length) return jsonError("Invite code not found.", 404);

    const row = contest.rows[0];
    if (row.join_code_expires_at && new Date(row.join_code_expires_at).getTime() < Date.now()) {
      return jsonError("This invite code has expired — ask the host for a new one.", 410);
    }
    if (row.join_code_max_uses != null && Number(row.join_code_uses) >= Number(row.join_code_max_uses)) {
      return jsonError("This invite code has reached its use limit — ask the host for a new one.", 410);
    }

    const contestId = Number(row.id);
    const seasonId = row.season_id ?? (await activeSeasonId());

    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status)
       VALUES ($1, $2, 'student', 'active')
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET status = 'active', joined_at = NOW()`,
      [userId, contestId]
    );
    await db.query(`UPDATE wiserfiles_cohorts SET join_code_uses = join_code_uses + 1 WHERE id = $1`, [contestId]);

    // Auto-opt the competitor into the leaderboard with a default display name.
    const user = await currentUser();
    const displayName = user?.username || user?.firstName || "Competitor";
    await db.query(
      `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, display_name, opted_in)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (user_id, cohort_id) DO NOTHING`,
      [userId, contestId, displayName]
    );

    return Response.json({ ok: true, contestId, seasonId });
  }

  // ── Regenerate an invite code (host or admin) ───────────────────
  if (body.action === "regenerate") {
    const contestId = Number(body.contestId ?? body.cohortId);
    if (!contestId) return jsonError("contestId is required.", 400);

    const contest = await db.query(`SELECT id, created_by FROM wiserfiles_cohorts WHERE id = $1`, [contestId]);
    if (!contest.rows.length) return jsonError("Contest not found.", 404);

    if (!(await isCohortLecturer(userId, contestId))) return jsonError("Only the host can regenerate the code.", 403);

    const maxUses = body.joinCodeMaxUses ? Math.max(1, Number(body.joinCodeMaxUses)) : null;
    const expiresInDays = body.joinCodeExpiresInDays ? Number(body.joinCodeExpiresInDays) : null;
    const updated = await db.query(
      `UPDATE wiserfiles_cohorts SET join_code = $2, join_code_uses = 0, join_code_max_uses = $3, join_code_expires_at = $4 WHERE id = $1 RETURNING join_code`,
      [
        contestId,
        joinCode(),
        maxUses,
        expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
      ]
    );
    return Response.json({ joinCode: updated.rows[0].join_code });
  }

  // ── Update contest settings (host only) ───────────────────────
  if (body.action === "update") {
    const contestId = Number(body.contestId);
    if (!contestId) return jsonError("contestId is required.", 400);
    if (!(await isCohortLecturer(userId, contestId))) return jsonError("Only the host can update this contest.", 403);

    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => { fields.push(`${col} = $${values.length + 2}`); values.push(val); };

    if (body.name !== undefined) push("name", String(body.name).trim());
    if (body.description !== undefined) push("description", String(body.description).trim());
    if (body.endsAt !== undefined) push("ends_at", body.endsAt ? new Date(String(body.endsAt)).toISOString() : null);
    if (body.freezeAt !== undefined) push("freeze_at", body.freezeAt ? new Date(String(body.freezeAt)).toISOString() : null);
    if (body.scoringMode !== undefined) push("scoring_mode", body.scoringMode === "icpc" ? "icpc" : "solve");
    if (body.isPublic !== undefined) push("is_public", Boolean(body.isPublic));
    if (body.prizes !== undefined) push("prizes", Array.isArray(body.prizes) ? JSON.stringify(body.prizes) : null);

    if (!fields.length) return jsonError("Nothing to update.", 400);
    await db.query(`UPDATE wiserfiles_cohorts SET ${fields.join(", ")} WHERE id = $1`, [contestId, ...values]);
    return Response.json({ ok: true });
  }

  // ── Replace the contest's problem set (host only) ─────────────
  if (body.action === "setChallenges") {
    const contestId = Number(body.contestId);
    if (!contestId) return jsonError("contestId is required.", 400);
    if (!(await isCohortLecturer(userId, contestId))) return jsonError("Only the host can change problems.", 403);

    const slugs = (Array.isArray(body.challengeSlugs) ? body.challengeSlugs : []).map((s) => String(s).trim()).filter(Boolean);
    await db.query(`DELETE FROM wiserfiles_contest_challenges WHERE contest_id = $1`, [contestId]);
    for (let i = 0; i < slugs.length; i++) {
      const ch = await db.query(`SELECT id FROM wiserfiles_challenges WHERE slug = $1`, [slugs[i]]);
      if (ch.rows.length) {
        await db.query(
          `INSERT INTO wiserfiles_contest_challenges (contest_id, challenge_id, position) VALUES ($1, $2, $3)`,
          [contestId, ch.rows[0].id, i]
        );
      }
    }
    return Response.json({ ok: true });
  }

  // ── Disqualify / reinstate a competitor (host only) ───────────
  if (body.action === "disqualify") {
    const contestId = Number(body.contestId);
    if (!contestId || !body.userId) return jsonError("contestId and userId are required.", 400);
    if (!(await isCohortLecturer(userId, contestId))) return jsonError("Only the host can disqualify competitors.", 403);
    await db.query(
      `UPDATE wiserfiles_enrollments SET is_disqualified = $3 WHERE cohort_id = $1 AND user_id = $2`,
      [contestId, String(body.userId), Boolean(body.disqualified)]
    );
    return Response.json({ ok: true });
  }

  return jsonError("Unknown action.", 400);
}
