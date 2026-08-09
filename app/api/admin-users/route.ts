import { auth, clerkClient } from "@clerk/nextjs/server";
import { setUserRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  return Response.json({ users: [], message: "User list temporarily unavailable" });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json();
  const { userId: targetId, role } = body as { userId?: string; role?: string };
  if (!targetId || !role) return jsonError("userId and role required", 400);
  if (!["admin", "user"].includes(role)) return jsonError("Invalid role", 400);

  const client = await clerkClient();
  const targetUser = await client.users.getUser(targetId);
  const email = targetUser.emailAddresses[0]?.emailAddress || "";
  await setUserRole(targetId, role as "admin" | "user", email);
  return Response.json({ ok: true, userId: targetId, role });
}
