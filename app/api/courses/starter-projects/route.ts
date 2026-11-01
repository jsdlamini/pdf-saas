import { auth } from "@clerk/nextjs/server";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { db, ensureMigrated } from "@/lib/db";
import { isCourseTeacher } from "@/lib/user-roles";
import {
  forkResearchProjectForUser,
  listResearchProjectsForCourse,
  type StoredResearchProjectWithOwner,
} from "@/lib/research-project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS_ROOT = process.env.PROJECT_ASSETS_DIR || "/app/data/assets";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function sanitizeRelPath(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

// A course's membership container is its single cohort. Mirror the active
// membership check used by GET /api/courses and the materials route.
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

function starterSummary(project: StoredResearchProjectWithOwner, viewerId: string) {
  const entries = project.entries ?? [];
  const editorMode = entries.some((e) => e.path.endsWith(".py"))
    ? "python"
    : entries.some((e) => e.path.endsWith(".cpp"))
      ? "cpp"
      : "latex";
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    courseId: project.courseId ?? null,
    editorMode,
    isOwner: project.userId === viewerId,
  };
}

// A starter project is a research project owned by a course teacher (admin,
// the course owner, or an enrolled lecturer) with course_id set. We resolve
// teacher status per unique owner with a cache so Clerk lookups happen at
// most once per owner.
async function filterTeacherOwned(
  projects: StoredResearchProjectWithOwner[],
  courseId: number
): Promise<StoredResearchProjectWithOwner[]> {
  const cache = new Map<string, boolean>();
  const starters: StoredResearchProjectWithOwner[] = [];
  for (const project of projects) {
    let isTeacher = cache.get(project.userId);
    if (isTeacher === undefined) {
      isTeacher = await isCourseTeacher(project.userId, courseId);
      cache.set(project.userId, isTeacher);
    }
    if (isTeacher) starters.push(project);
  }
  return starters;
}

// Best-effort copy of project figure assets so a forked project's images keep
// resolving (the project JSON stores image entries with empty content; the
// bytes live under the source owner's asset directory).
async function copyProjectAssets(
  fromUserId: string,
  fromProjectId: string,
  toUserId: string,
  toProjectId: string
) {
  try {
    const src = join(ASSETS_ROOT, fromUserId, sanitizeRelPath(fromProjectId));
    const dst = join(ASSETS_ROOT, toUserId, sanitizeRelPath(toProjectId));
    await cp(src, dst, { recursive: true, force: true });
  } catch {
    // The source may have no assets; a failed copy must never block the fork.
  }
}

// GET: list a course's starter projects, allowed for the course teacher or any
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

  const all = await listResearchProjectsForCourse(courseId);
  const starters = await filterTeacherOwned(all, courseId);

  return Response.json({ isTeacher, starterProjects: starters.map((p) => starterSummary(p, userId)) });
}

// POST { action: "fork", courseId, projectId } — duplicate a starter project
// into the caller's own projects. Only the course teacher or an active member
// may fork; a teacher may fork too.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.action !== "fork") return jsonError("Unknown action.", 400);

  await ensureMigrated();

  const courseId = Number(body.courseId);
  const projectId = String(body.projectId || "");
  if (!courseId || !projectId) return jsonError("courseId and projectId are required.", 400);

  const course = await db.query(`SELECT id FROM wiserfiles_courses WHERE id = $1`, [courseId]);
  if (!course.rows.length) return jsonError("Course not found.", 404);

  const isTeacher = await isCourseTeacher(userId, courseId);
  if (!isTeacher && !(await isActiveMember(userId, courseId))) {
    return jsonError("You are not a member of this course.", 403);
  }

  const all = await listResearchProjectsForCourse(courseId);
  const source = all.find((p) => p.id === projectId);
  if (!source) return jsonError("Starter project not found.", 404);

  // Only a teacher-owned starter may be forked; never a student's own copy.
  if (!(await isCourseTeacher(source.userId, courseId))) {
    return jsonError("Starter project not found.", 404);
  }

  const forked = await forkResearchProjectForUser(userId, source);
  await copyProjectAssets(source.userId, source.id, userId, forked.id);

  return Response.json({ project: starterSummary({ ...forked, userId }, userId) });
}
