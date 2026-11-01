import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Public (pre-sign-in) course join-link resolver. A join link carries the
// course's cohort join_code; this endpoint maps it back to the course name so
// the /join landing page can render before the visitor signs in, while still
// enforcing the same revoked / expired / use-limit states as the join action.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() || "";
  if (!code) return jsonError("Enter a join code to continue.", 400);

  await ensureMigrated();

  const cohort = await db.query(
    `SELECT c.id AS cohort_id, c.join_code_expires_at, c.join_code_max_uses, c.join_code_uses, c.name,
            co.id AS course_id, co.code, co.title, co.institution,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = c.id AND e.status = 'active') AS member_count
     FROM wiserfiles_cohorts c
     JOIN wiserfiles_courses co ON co.id = c.course_id
     WHERE c.join_code = $1
     ORDER BY c.id DESC LIMIT 1`,
    [code]
  );

  if (!cohort.rows.length) {
    return jsonError("This join link is no longer valid — ask your teacher for a new one.", 404);
  }

  const row = cohort.rows[0];
  if (row.join_code_expires_at && new Date(row.join_code_expires_at).getTime() < Date.now()) {
    return jsonError("This join link has expired — ask your teacher for a new one.", 410);
  }
  if (row.join_code_max_uses != null && Number(row.join_code_uses) >= Number(row.join_code_max_uses)) {
    return jsonError("This join link has reached its use limit — ask your teacher for a new one.", 410);
  }

  const { userId } = await auth();
  let alreadyMember = false;
  if (userId) {
    const member = await db.query(
      `SELECT 1 FROM wiserfiles_enrollments WHERE cohort_id = $1 AND user_id = $2 AND status = 'active'`,
      [row.cohort_id, userId]
    );
    alreadyMember = member.rows.length > 0;
  }

  return Response.json({
    course: {
      id: Number(row.course_id),
      code: row.code,
      title: row.title,
      institution: row.institution,
    },
    cohort: {
      id: Number(row.cohort_id),
      name: row.name,
      member_count: row.member_count,
    },
    alreadyMember,
  });
}
