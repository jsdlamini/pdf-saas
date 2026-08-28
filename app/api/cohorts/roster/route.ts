import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { getUserRole, isLecturerOrAdmin } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// GET: list a cohort's roster (lecturer/admin).
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  const cohortId = Number(new URL(request.url).searchParams.get("cohortId"));
  if (!cohortId) return jsonError("cohortId is required.", 400);

  await ensureMigrated();
  if (!(await isLecturerOrAdmin(userId))) return jsonError("Lecturer access required.", 403);

  const rows = await db.query(
    `SELECT student_id, claimed_by, claimed_at FROM wiserfiles_roster WHERE cohort_id = $1 ORDER BY student_id`,
    [cohortId]
  );
  return Response.json({ roster: rows.rows });
}

// POST: upload a roster. Accepts { cohortId, rosterText } where rosterText is
// newline-separated student numbers (CSV column is fine — we take the first
// field per line). Each row is stored unclaimed; a student claims it by setting
// the matching student ID on their enrollment.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { cohortId?: number; rosterText?: string; replace?: boolean } | null;
  if (!body?.cohortId || typeof body.rosterText !== "string") return jsonError("cohortId and rosterText are required.", 400);

  await ensureMigrated();
  if (!(await isLecturerOrAdmin(userId))) return jsonError("Lecturer access required.", 403);

  const cohortId = Number(body.cohortId);

  const lines = body.rosterText
    .split(/\r?\n/)
    .map((l) => l.split(",")[0].trim())
    .filter((s) => s.length > 0 && s.length <= 64);

  if (!lines.length) return jsonError("No student numbers found in the roster.", 400);

  if (body.replace) {
    await db.query(`DELETE FROM wiserfiles_roster WHERE cohort_id = $1 AND claimed_by IS NULL`, [cohortId]);
  }

  let inserted = 0;
  for (const studentId of lines) {
    const res = await db.query(
      `INSERT INTO wiserfiles_roster (cohort_id, student_id) VALUES ($1, $2)
       ON CONFLICT (cohort_id, student_id) DO NOTHING RETURNING student_id`,
      [cohortId, studentId]
    );
    if (res.rows.length) inserted += 1;
  }

  return Response.json({ inserted, total: lines.length });
}
