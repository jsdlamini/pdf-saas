import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";
import { activeSeasonId, resolveCohortId } from "@/lib/challenges";
import { getUserRole, isLecturerOrAdmin } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function joinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

// GET: courses, cohorts (with course + member counts), and the caller's own
// enrollments + current cohort.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  await ensureMigrated();

  const courses = await db.query(
    `SELECT id, code, title, institution, owner_id FROM wiserfiles_courses ORDER BY code`
  );
  const cohorts = await db.query(
    `SELECT c.id, c.name, c.join_code, c.course_id, c.season_id, c.created_by,
            co.code AS course_code, co.title AS course_title,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS member_count
     FROM wiserfiles_cohorts c
     LEFT JOIN wiserfiles_courses co ON co.id = c.course_id
     WHERE c.created_by = 'system' OR c.created_by = $1
     ORDER BY c.id`,
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

  return Response.json({ courses: courses.rows, cohorts: cohorts.rows, myCohortId, enrollments: enrollments.rows });
}

// POST { action: "create" | "join" | "regenerate", ... }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();

  // ── Create a cohort (lecturer/admin only) ────────────────────────
  if (body.action === "create") {
    const name = String(body.name || "").trim();
    if (!name) return jsonError("A cohort name is required.", 400);
    if (!(await isLecturerOrAdmin(userId))) {
      return jsonError("Only a lecturer or admin can create a cohort.", 403);
    }

    const seasonId = await activeSeasonId();
    let courseId = body.courseId ? Number(body.courseId) : null;

    // Create a course on the fly when a code is supplied without a courseId.
    const code = String(body.code || "").trim();
    const title = String(body.title || "").trim();
    if (!courseId && code) {
      const existing = await db.query(`SELECT id FROM wiserfiles_courses WHERE code = $1 AND institution = $2`, [code, String(body.institution || "").trim()]);
      if (existing.rows.length) {
        courseId = existing.rows[0].id;
      } else {
        const ins = await db.query(
          `INSERT INTO wiserfiles_courses (code, title, institution, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [code, title || code, String(body.institution || "").trim(), userId]
        );
        courseId = ins.rows[0].id;
      }
    }

    const maxUses = body.joinCodeMaxUses ? Math.max(1, Number(body.joinCodeMaxUses)) : null;
    const expiresInDays = body.joinCodeExpiresInDays ? Number(body.joinCodeExpiresInDays) : null;
    const ins = await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, season_id, created_by, course_id, join_code_max_uses, join_code_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, join_code, course_id`,
      [
        name,
        joinCode(),
        seasonId || null,
        userId,
        courseId,
        maxUses,
        expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
      ]
    );
    // The creator is the lecturer of their own cohort.
    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status) VALUES ($1, $2, 'lecturer', 'active')
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET role = 'lecturer', status = 'active'`,
      [userId, ins.rows[0].id]
    );
    return Response.json({ cohort: ins.rows[0] });
  }

  // ── Join a cohort by code (enrollment) ───────────────────────────
  if (body.action === "join") {
    const code = String(body.joinCode || "").trim().toUpperCase();
    if (!code) return jsonError("Enter a join code.", 400);

    const cohort = await db.query(
      `SELECT id, season_id, join_code_expires_at, join_code_max_uses, join_code_uses FROM wiserfiles_cohorts WHERE join_code = $1`,
      [code]
    );
    if (!cohort.rows.length) return jsonError("Join code not found.", 404);

    const row = cohort.rows[0];
    if (row.join_code_expires_at && new Date(row.join_code_expires_at).getTime() < Date.now()) {
      return jsonError("This join code has expired — ask your lecturer for a new one.", 410);
    }
    if (row.join_code_max_uses != null && Number(row.join_code_uses) >= Number(row.join_code_max_uses)) {
      return jsonError("This join code has reached its use limit — ask your lecturer for a new one.", 410);
    }

    const cohortId = Number(row.id);
    const seasonId = row.season_id ?? (await activeSeasonId());

    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status)
       VALUES ($1, $2, 'student', 'active')
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET status = 'active', joined_at = NOW()`,
      [userId, cohortId]
    );
    await db.query(`UPDATE wiserfiles_cohorts SET join_code_uses = join_code_uses + 1 WHERE id = $1`, [cohortId]);

    return Response.json({ ok: true, cohortId, seasonId });
  }

  // ── Regenerate a join code (owner or admin) ──────────────────────
  if (body.action === "regenerate") {
    const cohortId = Number(body.cohortId);
    if (!cohortId) return jsonError("cohortId is required.", 400);

    const cohort = await db.query(`SELECT id, created_by FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
    if (!cohort.rows.length) return jsonError("Cohort not found.", 404);

    const role = await getUserRole(userId);
    const isOwner = cohort.rows[0].created_by === userId;
    if (role !== "admin" && !isOwner) return jsonError("Only the cohort creator or an admin can regenerate the code.", 403);

    const maxUses = body.joinCodeMaxUses ? Math.max(1, Number(body.joinCodeMaxUses)) : null;
    const expiresInDays = body.joinCodeExpiresInDays ? Number(body.joinCodeExpiresInDays) : null;
    const updated = await db.query(
      `UPDATE wiserfiles_cohorts SET join_code = $2, join_code_uses = 0, join_code_max_uses = $3, join_code_expires_at = $4 WHERE id = $1 RETURNING join_code`,
      [
        cohortId,
        joinCode(),
        maxUses,
        expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
      ]
    );
    return Response.json({ joinCode: updated.rows[0].join_code });
  }

  return jsonError("Unknown action.", 400);
}
