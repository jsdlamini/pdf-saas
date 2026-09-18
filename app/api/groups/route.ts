import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { listGroups, joinGroup, switchGroup, updateGroup, createGroup, deleteGroup } from "@/lib/groups-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  // The shared Postgres pool can hit a transient connect timeout after a
  // deploy; retry a couple of times so the dialog fills instead of failing.
  let role = "user";
  let groups;
  for (let attempt = 0; ; attempt++) {
    try {
      role = userId ? await getUserRole(userId) : "user";
      groups = await listGroups(userId ?? null);
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || !msg.includes("timeout exceeded when trying to connect")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  return Response.json({
    groups,
    signedIn: Boolean(userId),
    isAdmin: role === "admin",
    isAssistant: role === "assistant",
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

  if (body.action === "create") {
    const role = await getUserRole(userId);
    if (role !== "admin") return jsonError("Admin access required.", 403);
    const result = await createGroup({
      name: typeof body.name === "string" ? body.name : "",
      schedule: typeof body.schedule === "string" ? body.schedule : "",
      capacity: typeof body.capacity === "number" ? body.capacity : 50,
      sessionCount: typeof body.sessionCount === "number" ? body.sessionCount : 4,
      testCount: typeof body.testCount === "number" ? body.testCount : 1,
      examCount: typeof body.examCount === "number" ? body.examCount : 1,
    });
    if (!result.ok) return jsonError(result.error || "Could not create the group.", 400);
    return Response.json({ ok: true, id: result.id });
  }

  if (body.action === "delete") {
    const role = await getUserRole(userId);
    if (role !== "admin") return jsonError("Admin access required.", 403);
    const ok = await deleteGroup(body.groupId);
    if (!ok) return jsonError("Group not found.", 404);
    return Response.json({ ok: true });
  }

  if (body.action === "update") {
    const role = await getUserRole(userId);
    if (role !== "admin") return jsonError("Admin access required.", 403);
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
    const result = await joinGroup(userId, body.groupId, {
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
    const result = await switchGroup(userId, body.groupId, body.toGroupId);
    if (!result.ok) return jsonError(result.error || "Could not switch groups.", 409);
    return Response.json({ ok: true, joined: true });
  }

  return jsonError("Unknown action.", 400);
}
