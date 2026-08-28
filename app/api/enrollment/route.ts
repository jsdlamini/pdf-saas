import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { resolveCohortId } from "@/lib/challenges";
import { getUserRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// GET: the caller's enrollments (and the current cohort's enrollment detail).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);
  const current = await db.query(
    `SELECT cohort_id, role, status, student_id, joined_at FROM wiserfiles_enrollments WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );
  const all = await db.query(
    `SELECT e.cohort_id, e.role, e.status, e.student_id, e.joined_at, c.name AS cohort_name
     FROM wiserfiles_enrollments e JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
     WHERE e.user_id = $1 ORDER BY e.joined_at DESC`,
    [userId]
  );

  const cur = current.rows[0];
  return Response.json({
    current: cur ? { cohortId: cur.cohort_id, role: cur.role, status: cur.status, studentId: cur.student_id || "", joinedAt: cur.joined_at } : null,
    enrollments: all.rows,
  });
}

// POST { studentId } — set the student ID for the current cohort. A student may
// set it once; afterwards only a lecturer in that cohort or an admin may change
// it.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { studentId?: string } | null;
  if (!body) return jsonError("Invalid payload.", 400);

  const requested = String(body.studentId || "").trim();
  if (!requested) return jsonError("A student ID is required.", 400);

  await ensureMigrated();
  const cohortId = await resolveCohortId(userId);

  const existing = await db.query(
    `SELECT student_id FROM wiserfiles_enrollments WHERE user_id = $1 AND cohort_id = $2`,
    [userId, cohortId]
  );
  const currentStudentId = existing.rows.length ? (existing.rows[0].student_id || "") : "";

  if (currentStudentId && currentStudentId !== requested) {
    // Only a lecturer in this cohort or an admin may change an existing ID.
    const role = await getUserRole(userId);
    const lecturer = await db.query(
      `SELECT 1 FROM wiserfiles_enrollments WHERE cohort_id = $1 AND role = 'lecturer' AND user_id = $2`,
      [cohortId, userId]
    );
    if (role !== "admin" && !lecturer.rows.length) {
      return jsonError("Your student ID is already set and can only be changed by your lecturer.", 403);
    }
  }

  // If the cohort has an uploaded roster, a student may only claim an ID that
  // appears on it (unclaimed, or already claimed by them). This fixes identity
  // to real institutional IDs rather than self-declared ones.
  const rosterExists = await db.query(`SELECT 1 FROM wiserfiles_roster WHERE cohort_id = $1 LIMIT 1`, [cohortId]);
  if (rosterExists.rows.length) {
    const match = await db.query(
      `SELECT 1 FROM wiserfiles_roster WHERE cohort_id = $1 AND student_id = $2 AND (claimed_by IS NULL OR claimed_by = $3)`,
      [cohortId, requested, userId]
    );
    if (!match.rows.length) {
      return jsonError("That student ID isn't on this cohort's roster — check with your lecturer.", 403);
    }
  }

  await db.query(
    `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status, student_id)
     VALUES ($1, $2, 'student', 'active', $3)
     ON CONFLICT (user_id, cohort_id) DO UPDATE SET student_id = EXCLUDED.student_id`,
    [userId, cohortId, requested]
  );

  await db.query(
    `UPDATE wiserfiles_roster SET claimed_by = $1, claimed_at = NOW() WHERE cohort_id = $2 AND student_id = $3 AND claimed_by IS NULL`,
    [userId, cohortId, requested]
  );

  return Response.json({ ok: true, studentId: requested });
}
