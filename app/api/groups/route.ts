import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { listGroups, joinGroup, leaveGroup } from "@/lib/groups-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  const [groups, isAdmin] = await Promise.all([
    listGroups(userId ?? null),
    userId ? getUserRole(userId).then((r) => r === "admin") : Promise.resolve(false),
  ]);
  return Response.json({ groups, signedIn: Boolean(userId), isAdmin });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in to join a group.", 401);

  const body = (await request.json().catch(() => null)) as { action?: string; groupId?: string } | null;
  if (!body || typeof body.groupId !== "string") return jsonError("Invalid payload.", 400);

  if (body.action === "join") {
    const result = await joinGroup(userId, body.groupId);
    if (!result.ok) return jsonError(result.error || "Could not join the group.", 409);
    return Response.json({ ok: true, joined: true, members: result.members });
  }

  if (body.action === "leave") {
    const result = await leaveGroup(userId, body.groupId);
    return Response.json({ ok: true, joined: false, members: result.members });
  }

  return jsonError("Unknown action.", 400);
}
