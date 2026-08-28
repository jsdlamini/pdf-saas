import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId, activeSeasonId } from "@/lib/challenges";
import { getUserRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const res = await db.query(
    `SELECT display_name, opted_in, student_id FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );
  return Response.json(
    res.rows.length
      ? { displayName: res.rows[0].display_name, optedIn: Boolean(res.rows[0].opted_in), studentId: res.rows[0].student_id || "" }
      : { displayName: "", optedIn: false, studentId: "" }
  );
}

// Set the leaderboard display name, opt-in state, and (once) the student ID.
// A student can only set their student ID once; after that only their teacher
// (cohort creator) or an admin can change it.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { displayName?: string; optedIn?: boolean; studentId?: string } | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const seasonId = await activeSeasonId();

  // Resolve the current student ID and enforce set-once.
  const current = await db.query(
    `SELECT student_id FROM wiserfiles_leaderboard_opt_in WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );
  const existingStudentId = current.rows.length ? (current.rows[0].student_id || "") : "";

  let studentId = existingStudentId;
  const requestedStudentId = (body.studentId ?? "").trim();
  if (requestedStudentId && requestedStudentId !== existingStudentId) {
    if (existingStudentId) {
      // Already set — only the teacher (cohort creator) or an admin may change it.
      const role = await getUserRole(userId);
      const cohort = await db.query(`SELECT created_by FROM wiserfiles_cohorts WHERE id = $1`, [cohortId]);
      const isTeacher = cohort.rows.length > 0 && cohort.rows[0].created_by === userId;
      if (role !== "admin" && !isTeacher) {
        return jsonError("Your student ID is already set and can only be changed by your teacher.", 403);
      }
    }
    studentId = requestedStudentId;
  }

  await db.query(
    `INSERT INTO wiserfiles_leaderboard_opt_in (user_id, cohort_id, season_id, display_name, opted_in, student_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, cohort_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       opted_in = EXCLUDED.opted_in,
       student_id = EXCLUDED.student_id`,
    [userId, cohortId, seasonId || null, (body.displayName || "").trim(), Boolean(body.optedIn), studentId || null]
  );

  return Response.json({ ok: true, studentId });
}
