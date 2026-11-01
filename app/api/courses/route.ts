import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "node:crypto";
import { db, ensureMigrated } from "@/lib/db";
import { isLecturerOrAdmin, isCourseTeacher } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function joinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

function slug(): string {
  return `course-${randomBytes(4).toString("hex")}`;
}

// A course owns one cohort (its membership container). Return that cohort id.
async function courseCohortId(courseId: number): Promise<number | null> {
  const r = await db.query(
    `SELECT id FROM wiserfiles_cohorts WHERE course_id = $1 ORDER BY id LIMIT 1`,
    [courseId]
  );
  return r.rows.length ? Number(r.rows[0].id) : null;
}

// GET: list the caller's courses (teacher view = all courses for a lecturer/
// admin; student view = owned or enrolled courses), or fetch one course.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  await ensureMigrated();

  const url = new URL(request.url);
  const courseId = Number(url.searchParams.get("courseId"));

  // ── Single course + its join-link state ─────────────────────────
  if (courseId) {
    const course = await db.query(
      `SELECT id, code, title, institution, owner_id, created_at FROM wiserfiles_courses WHERE id = $1`,
      [courseId]
    );
    if (!course.rows.length) return jsonError("Course not found.", 404);

    const isTeacher = await isCourseTeacher(userId, courseId);
    const member = await db.query(
      `SELECT e.role, e.status, e.student_id
       FROM wiserfiles_enrollments e
       JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
       WHERE c.course_id = $1 AND e.user_id = $2 AND e.status = 'active'
       ORDER BY e.joined_at DESC LIMIT 1`,
      [courseId, userId]
    );
    if (!isTeacher && !member.rows.length) {
      return jsonError("You are not a member of this course.", 403);
    }

    const cohort = await db.query(
      `SELECT id, name, slug, join_code, join_code_expires_at, join_code_max_uses, join_code_uses,
              (SELECT COUNT(*)::int FROM wiserfiles_enrollments e WHERE e.cohort_id = wiserfiles_cohorts.id AND e.status = 'active') AS member_count
       FROM wiserfiles_cohorts WHERE course_id = $1 ORDER BY id LIMIT 1`,
      [courseId]
    );

    const raw = cohort.rows[0] ?? null;
    return Response.json({
      course: course.rows[0],
      cohort: raw
        ? {
            id: raw.id,
            name: raw.name,
            slug: raw.slug,
            member_count: raw.member_count,
            join_code: isTeacher ? raw.join_code : null,
            join_code_expires_at: isTeacher ? raw.join_code_expires_at : null,
            join_code_max_uses: isTeacher ? raw.join_code_max_uses : null,
            join_code_uses: isTeacher ? raw.join_code_uses : null,
          }
        : null,
      isTeacher,
      role: member.rows[0]?.role ?? null,
    });
  }

  // ── List ────────────────────────────────────────────────────────
  const isTeacher = await isLecturerOrAdmin(userId);
  const courses = await db.query(
    `SELECT c.id, c.code, c.title, c.institution, c.owner_id,
            (SELECT id FROM wiserfiles_cohorts WHERE course_id = c.id ORDER BY id LIMIT 1) AS cohort_id,
            (SELECT join_code FROM wiserfiles_cohorts WHERE course_id = c.id ORDER BY id LIMIT 1) AS join_code,
            (SELECT role FROM wiserfiles_enrollments e
              JOIN wiserfiles_cohorts ch ON ch.id = e.cohort_id
              WHERE ch.course_id = c.id AND e.user_id = $2 AND e.status = 'active'
              ORDER BY e.joined_at DESC LIMIT 1) AS my_role,
            (SELECT COUNT(*)::int FROM wiserfiles_enrollments e2
              JOIN wiserfiles_cohorts ch2 ON ch2.id = e2.cohort_id
              WHERE ch2.course_id = c.id AND e2.status = 'active') AS member_count
     FROM wiserfiles_courses c
     WHERE $1::boolean
        OR c.owner_id = $2
        OR EXISTS (SELECT 1 FROM wiserfiles_enrollments e3
                   JOIN wiserfiles_cohorts ch3 ON ch3.id = e3.cohort_id
                   WHERE ch3.course_id = c.id AND e3.user_id = $2 AND e3.status = 'active')
     ORDER BY c.id DESC`,
    [isTeacher, userId]
  );

  return Response.json({
    canCreate: isTeacher,
    courses: courses.rows.map((r) => {
      const canManage = isTeacher || r.owner_id === userId || r.my_role === "lecturer";
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        institution: r.institution,
        owner_id: r.owner_id,
        cohort_id: r.cohort_id,
        member_count: r.member_count,
        my_role: r.my_role,
        is_owner: r.owner_id === userId,
        is_teacher: canManage,
        join_code: canManage ? r.join_code : null,
      };
    }),
  });
}

// POST { action: "create" | "regenerate-join-code" | "revoke-join", ... }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();

  // ── Create a course (teacher/admin only) ────────────────────────
  if (body.action === "create") {
    if (!(await isLecturerOrAdmin(userId))) return jsonError("Teacher access required.", 403);

    const code = String(body.code || "").trim();
    const title = String(body.title || "").trim();
    if (!code || !title) return jsonError("Course code and title are required.", 400);

    const institution = String(body.institution || "").trim();
    const course = await db.query(
      `INSERT INTO wiserfiles_courses (code, title, institution, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, title, institution, owner_id, created_at`,
      [code, title, institution, userId]
    );

    const courseId = Number(course.rows[0].id);
    const cohort = await db.query(
      `INSERT INTO wiserfiles_cohorts (name, join_code, slug, course_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, join_code, slug`,
      [title, joinCode(), slug(), courseId, userId]
    );

    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status)
       VALUES ($1, $2, 'lecturer', 'active')
       ON CONFLICT (user_id, cohort_id) DO UPDATE SET role = 'lecturer', status = 'active'`,
      [userId, cohort.rows[0].id]
    );

    return Response.json({ course: course.rows[0], cohort: cohort.rows[0] });
  }

  // ── Rotate a course join link (teacher/admin only) ──────────────
  if (body.action === "regenerate-join-code") {
    const courseId = Number(body.courseId);
    if (!courseId) return jsonError("courseId is required.", 400);

    const cohortId = await courseCohortId(courseId);
    if (!cohortId) return jsonError("Course not found.", 404);

    if (!(await isCourseTeacher(userId, courseId))) {
      return jsonError("Teacher access required.", 403);
    }

    const maxUses = body.joinCodeMaxUses ? Math.max(1, Number(body.joinCodeMaxUses)) : null;
    const expiresInDays = body.joinCodeExpiresInDays ? Number(body.joinCodeExpiresInDays) : null;
    const updated = await db.query(
      `UPDATE wiserfiles_cohorts
       SET join_code = $2, join_code_uses = 0, join_code_max_uses = $3, join_code_expires_at = $4
       WHERE course_id = $1
       RETURNING join_code`,
      [
        courseId,
        joinCode(),
        maxUses,
        expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
      ]
    );
    return Response.json({ joinCode: updated.rows[0].join_code });
  }

  // ── Revoke a course join link (teacher/admin only) ──────────────
  if (body.action === "revoke-join") {
    const courseId = Number(body.courseId);
    if (!courseId) return jsonError("courseId is required.", 400);

    const cohortId = await courseCohortId(courseId);
    if (!cohortId) return jsonError("Course not found.", 404);

    if (!(await isCourseTeacher(userId, courseId))) {
      return jsonError("Teacher access required.", 403);
    }

    await db.query(`UPDATE wiserfiles_cohorts SET join_code = NULL WHERE course_id = $1`, [courseId]);
    return Response.json({ ok: true });
  }

  return jsonError("Unknown action.", 400);
}
