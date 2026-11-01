import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { isCourseTeacher } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

const MATERIAL_KINDS = ["note", "link", "video"] as const;
type MaterialKind = (typeof MATERIAL_KINDS)[number];

function isMaterialKind(value: unknown): value is MaterialKind {
  return typeof value === "string" && (MATERIAL_KINDS as readonly string[]).includes(value);
}

// A course's membership container is its single cohort. Mirror the active
// membership check used by GET /api/courses so any enrolled student (not just
// teachers) can read materials for their own course.
async function isActiveMember(userId: string, courseId: number): Promise<boolean> {
  const member = await db.query(
    `SELECT 1 FROM wiserfiles_enrollments e
     JOIN wiserfiles_cohorts c ON c.id = e.cohort_id
     WHERE c.course_id = $1 AND e.user_id = $2 AND e.status = 'active'
     LIMIT 1`,
    [courseId, userId]
  );
  return member.rows.length > 0;
}

// GET: list materials for a course, allowed for the course teacher or any
// active member. Non-members get a 403 (they must not learn about the course).
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  await ensureMigrated();

  const url = new URL(request.url);
  const courseId = Number(url.searchParams.get("courseId"));
  if (!courseId) return jsonError("courseId is required.", 400);

  const course = await db.query(`SELECT id FROM wiserfiles_courses WHERE id = $1`, [courseId]);
  if (!course.rows.length) return jsonError("Course not found.", 404);

  const isTeacher = await isCourseTeacher(userId, courseId);
  if (!isTeacher && !(await isActiveMember(userId, courseId))) {
    return jsonError("You are not a member of this course.", 403);
  }

  const materials = await db.query(
    `SELECT id, course_id, author_id, kind, title, body, created_at, updated_at
     FROM wiserfiles_course_materials
     WHERE course_id = $1
     ORDER BY created_at DESC, id DESC`,
    [courseId]
  );

  return Response.json({ isTeacher, materials: materials.rows });
}

// POST { action: "create" | "update" | "delete", ... } — course teacher/admin
// only. Every mutation re-checks the teacher gate server-side; a student must
// never be able to create, edit, or delete materials regardless of the UI.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Invalid payload.", 400);

  await ensureMigrated();

  const courseId = Number(body.courseId);
  if (!courseId) return jsonError("courseId is required.", 400);

  // Guard against a teacher/admin operating on a nonexistent course id.
  const course = await db.query(`SELECT id FROM wiserfiles_courses WHERE id = $1`, [courseId]);
  if (!course.rows.length) return jsonError("Course not found.", 404);

  if (!(await isCourseTeacher(userId, courseId))) {
    return jsonError("Teacher access required.", 403);
  }

  if (body.action === "create") {
    const kind = body.kind ?? "note";
    if (!isMaterialKind(kind)) return jsonError("Invalid material kind.", 400);
    const title = String(body.title || "").trim();
    const content = String(body.body ?? "").trim();
    if (!title) return jsonError("Title is required.", 400);
    if (kind !== "note" && !content) return jsonError("URL is required.", 400);

    const material = await db.query(
      `INSERT INTO wiserfiles_course_materials (course_id, author_id, kind, title, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, course_id, author_id, kind, title, body, created_at, updated_at`,
      [courseId, userId, kind, title, content]
    );
    return Response.json({ material: material.rows[0] });
  }

  if (body.action === "update") {
    const materialId = Number(body.materialId);
    if (!materialId) return jsonError("materialId is required.", 400);
    const kind = body.kind ?? "note";
    if (!isMaterialKind(kind)) return jsonError("Invalid material kind.", 400);
    const title = String(body.title || "").trim();
    const content = String(body.body ?? "").trim();
    if (!title) return jsonError("Title is required.", 400);
    if (kind !== "note" && !content) return jsonError("URL is required.", 400);

    const existing = await db.query(
      `SELECT id FROM wiserfiles_course_materials WHERE id = $1 AND course_id = $2`,
      [materialId, courseId]
    );
    if (!existing.rows.length) return jsonError("Material not found.", 404);

    const material = await db.query(
      `UPDATE wiserfiles_course_materials
       SET kind = $3, title = $4, body = $5, updated_at = NOW()
       WHERE id = $1 AND course_id = $2
       RETURNING id, course_id, author_id, kind, title, body, created_at, updated_at`,
      [materialId, courseId, kind, title, content]
    );
    return Response.json({ material: material.rows[0] });
  }

  if (body.action === "delete") {
    const materialId = Number(body.materialId);
    if (!materialId) return jsonError("materialId is required.", 400);

    const existing = await db.query(
      `SELECT id FROM wiserfiles_course_materials WHERE id = $1 AND course_id = $2`,
      [materialId, courseId]
    );
    if (!existing.rows.length) return jsonError("Material not found.", 404);

    await db.query(
      `DELETE FROM wiserfiles_course_materials WHERE id = $1 AND course_id = $2`,
      [materialId, courseId]
    );
    return Response.json({ ok: true });
  }

  return jsonError("Unknown action.", 400);
}
