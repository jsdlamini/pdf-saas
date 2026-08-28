import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { isLecturerOrAdmin } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// GET: problem sets for a course (or all the caller's courses' sets).
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  await ensureMigrated();
  const courseId = Number(new URL(request.url).searchParams.get("courseId"));

  const sets = await db.query(
    `SELECT ps.id, ps.course_id, ps.title, ps.due_at, ps.created_by,
            co.code AS course_code, co.title AS course_title
     FROM wiserfiles_problem_sets ps
     JOIN wiserfiles_courses co ON co.id = ps.course_id
     WHERE ($1::int IS NULL OR ps.course_id = $1)
       AND (co.owner_id = $2 OR EXISTS (SELECT 1 FROM wiserfiles_enrollments e
             JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
             WHERE c.course_id = ps.course_id AND e.user_id = $2))
     ORDER BY ps.due_at NULLS LAST, ps.id`,
    [courseId || null, userId]
  );

  const ids = sets.rows.map((s) => s.id);
  let challengesBySet: Record<number, { id: number; slug: string; language: string; points: number }[]> = {};
  if (ids.length) {
    const ch = await db.query(
      `SELECT psc.problem_set_id, c.id, c.slug, c.language, c.points
       FROM wiserfiles_problem_set_challenges psc
       JOIN wiserfiles_challenges c ON c.id = psc.challenge_id
       WHERE psc.problem_set_id = ANY($1::int[])
       ORDER BY psc.position`,
      [ids]
    );
    challengesBySet = ch.rows.reduce((acc: Record<number, { id: number; slug: string; language: string; points: number }[]>, row: { problem_set_id: number; id: number; slug: string; language: string; points: number }) => {
      (acc[row.problem_set_id] ||= []).push({ id: row.id, slug: row.slug, language: row.language, points: row.points });
      return acc;
    }, {});
  }

  return Response.json({ sets: sets.rows, challenges: challengesBySet });
}

// POST: create a problem set (lecturer/admin) with an optional due date and a
// list of challenge slugs.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as {
    courseId?: number;
    title?: string;
    dueAt?: string;
    challengeSlugs?: string[];
  } | null;
  if (!body?.courseId || !body.title?.trim()) return jsonError("courseId and title are required.", 400);

  await ensureMigrated();
  if (!(await isLecturerOrAdmin(userId))) return jsonError("Lecturer access required.", 403);

  const ins = await db.query(
    `INSERT INTO wiserfiles_problem_sets (course_id, title, due_at, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.courseId, body.title.trim(), body.dueAt || null, userId]
  );
  const setId = ins.rows[0].id;

  const slugs = (body.challengeSlugs || []).map((s) => String(s).trim()).filter(Boolean);
  for (let i = 0; i < slugs.length; i++) {
    const ch = await db.query(`SELECT id FROM wiserfiles_challenges WHERE slug = $1`, [slugs[i]]);
    if (ch.rows.length) {
      await db.query(
        `INSERT INTO wiserfiles_problem_set_challenges (problem_set_id, challenge_id, position) VALUES ($1, $2, $3)
         ON CONFLICT (problem_set_id, challenge_id) DO NOTHING`,
        [setId, ch.rows[0].id, i]
      );
    }
  }

  return Response.json({ ok: true, problemSetId: setId });
}
