import { auth } from "@clerk/nextjs/server";
import { getUserRole, isCourseTeacher, resolveUserIdByEmail, getEmailForUser } from "@/lib/user-roles";
import {
  listGroups,
  joinGroup,
  switchGroup,
  updateGroup,
  createGroup,
  deleteGroup,
  updateGroupMember,
  deleteGroupMember,
  getGroupCourseId,
  listAssignedStaffGroupIds,
  listGroupStaff,
  assignStaff,
  unassignStaff,
} from "@/lib/groups-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  const url = new URL(request.url);
  const courseIdRaw = url.searchParams.get("courseId");
  const courseId = courseIdRaw ? Number(courseIdRaw) : null;

  // The shared Postgres pool can hit a transient connect timeout after a
  // deploy; retry a couple of times so the dialog fills instead of failing.
  let role = "user";
  let groups;
  let assigned = new Set<string>();
  let canManage = false;
  for (let attempt = 0; ; attempt++) {
    try {
      role = userId ? await getUserRole(userId) : "user";
      groups = await listGroups(userId ?? null, courseId);
      if (userId) {
        assigned = await listAssignedStaffGroupIds(userId);
        canManage = courseId != null ? await isCourseTeacher(userId, courseId) : role === "admin";
      }
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || !msg.includes("timeout exceeded when trying to connect")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }

  const withAccess = groups.map((g) => ({
    ...g,
    canAssess: role === "admin" || assigned.has(g.id),
  }));

  return Response.json({
    groups: withAccess,
    signedIn: Boolean(userId),
    isAdmin: role === "admin",
    isAssistant: role === "assistant",
    isCourseTeacher: canManage,
    role,
  });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in to join a group.", 401);

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    groupId?: string;
    toGroupId?: string;
    memberUserId?: string;
    email?: string;
    courseId?: number;
    role?: string;
    name?: string;
    surname?: string;
    programme?: string;
    studentId?: string;
    schedule?: string;
    capacity?: number;
    sessionCount?: number;
    testCount?: number;
    examCount?: number;
  } | null;
  if (!body || typeof body.groupId !== "string") return jsonError("Invalid payload.", 400);

  const courseId = typeof body.courseId === "number" ? body.courseId : null;
  const groupId: string = body.groupId;

  async function groupCourseId(): Promise<number | null> {
    return getGroupCourseId(groupId);
  }

  if (body.action === "create") {
    if (courseId == null) return jsonError("courseId is required.", 400);
    if (!(await isCourseTeacher(userId, courseId))) return jsonError("Teacher access required.", 403);
    const result = await createGroup({
      name: typeof body.name === "string" ? body.name : "",
      schedule: typeof body.schedule === "string" ? body.schedule : "",
      capacity: typeof body.capacity === "number" ? body.capacity : 50,
      sessionCount: typeof body.sessionCount === "number" ? body.sessionCount : 4,
      testCount: typeof body.testCount === "number" ? body.testCount : 1,
      examCount: typeof body.examCount === "number" ? body.examCount : 1,
      courseId,
    });
    if (!result.ok) return jsonError(result.error || "Could not create the group.", 400);
    return Response.json({ ok: true, id: result.id });
  }

  if (body.action === "delete") {
    const gCourseId = await groupCourseId();
    if (gCourseId == null) return jsonError("Group not found.", 404);
    if (!(await isCourseTeacher(userId, gCourseId))) return jsonError("Teacher access required.", 403);
    const ok = await deleteGroup(body.groupId);
    if (!ok) return jsonError("Group not found.", 404);
    return Response.json({ ok: true });
  }

  if (body.action === "update") {
    const gCourseId = await groupCourseId();
    if (gCourseId == null) return jsonError("Group not found.", 404);
    if (!(await isCourseTeacher(userId, gCourseId))) return jsonError("Teacher access required.", 403);
    const ok = await updateGroup(body.groupId, {
      name: typeof body.name === "string" ? body.name : "",
      schedule: typeof body.schedule === "string" ? body.schedule : "",
      capacity: typeof body.capacity === "number" ? body.capacity : 50,
      sessionCount: typeof body.sessionCount === "number" ? body.sessionCount : 4,
      testCount: typeof body.testCount === "number" ? body.testCount : 1,
      examCount: typeof body.examCount === "number" ? body.examCount : 1,
    });
    if (!ok) return jsonError("Group not found.", 404);
    return Response.json({ ok: true });
  }

  if (body.action === "join") {
    if (courseId == null) return jsonError("courseId is required.", 400);
    const result = await joinGroup(userId, body.groupId, courseId, {
      name: typeof body.name === "string" ? body.name : "",
      surname: typeof body.surname === "string" ? body.surname : "",
      programme: typeof body.programme === "string" ? body.programme : "",
      studentId: typeof body.studentId === "string" ? body.studentId : "",
    });
    if (!result.ok) return jsonError(result.error || "Could not join the group.", 409);
    return Response.json({ ok: true, joined: true, members: result.members });
  }

  if (body.action === "switch") {
    if (typeof body.toGroupId !== "string") return jsonError("Target group required.", 400);
    if (courseId == null) return jsonError("courseId is required.", 400);
    const result = await switchGroup(userId, body.groupId, body.toGroupId, courseId);
    if (!result.ok) return jsonError(result.error || "Could not switch groups.", 409);
    return Response.json({ ok: true, joined: true });
  }

  if (body.action === "update-member") {
    const role = await getUserRole(userId);
    if (role !== "admin") return jsonError("Admin access required.", 403);
    if (typeof body.memberUserId !== "string") return jsonError("Invalid payload.", 400);
    const result = await updateGroupMember(body.groupId, body.memberUserId, {
      name: typeof body.name === "string" ? body.name : "",
      surname: typeof body.surname === "string" ? body.surname : "",
      programme: typeof body.programme === "string" ? body.programme : "",
      studentId: typeof body.studentId === "string" ? body.studentId : "",
    });
    if (result.notFound) return jsonError(result.error || "Student not found.", 404);
    if (!result.ok) return jsonError(result.error || "Could not update the student.", 400);
    return Response.json({ ok: true });
  }

  if (body.action === "delete-member") {
    const role = await getUserRole(userId);
    if (role !== "admin") return jsonError("Admin access required.", 403);
    if (typeof body.memberUserId !== "string") return jsonError("Invalid payload.", 400);
    const result = await deleteGroupMember(body.groupId, body.memberUserId);
    if (result.notFound) return jsonError(result.error || "Student not found.", 404);
    if (!result.ok) return jsonError(result.error || "Could not delete the student.", 400);
    return Response.json({ ok: true });
  }

  // ── Staff assignment (assistant/lecturer ↔ group) ──────────────
  if (body.action === "assign-staff") {
    const gCourseId = await groupCourseId();
    if (gCourseId == null) return jsonError("Group not found.", 404);
    if (!(await isCourseTeacher(userId, gCourseId))) return jsonError("Teacher access required.", 403);

    let targetUserId = typeof body.memberUserId === "string" ? body.memberUserId : "";
    if (!targetUserId && typeof body.email === "string" && body.email.trim()) {
      targetUserId = (await resolveUserIdByEmail(body.email.trim())) ?? "";
    }
    if (!targetUserId) return jsonError("memberUserId or a matching email is required.", 400);

    await assignStaff(body.groupId, targetUserId, body.role === "teacher" ? "teacher" : "assistant");
    return Response.json({ ok: true });
  }

  if (body.action === "unassign-staff") {
    const gCourseId = await groupCourseId();
    if (gCourseId == null) return jsonError("Group not found.", 404);
    if (!(await isCourseTeacher(userId, gCourseId))) return jsonError("Teacher access required.", 403);

    const targetUserId = typeof body.memberUserId === "string" ? body.memberUserId : "";
    if (!targetUserId) return jsonError("memberUserId is required.", 400);
    const ok = await unassignStaff(body.groupId, targetUserId);
    if (!ok) return jsonError("Staff assignment not found.", 404);
    return Response.json({ ok: true });
  }

  if (body.action === "list-staff") {
    const gCourseId = await groupCourseId();
    if (gCourseId == null) return jsonError("Group not found.", 404);
    if (!(await isCourseTeacher(userId, gCourseId))) return jsonError("Teacher access required.", 403);

    const staff = await listGroupStaff(body.groupId);
    const withEmail = await Promise.all(
      staff.map(async (s) => ({ userId: s.userId, role: s.role, email: await getEmailForUser(s.userId) }))
    );
    return Response.json({ staff: withEmail });
  }

  return jsonError("Unknown action.", 400);
}
