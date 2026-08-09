import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { DASHBOARD_ALLOWED } from "@/lib/dashboard-access";
import {
  getUserRole,
  ensureUserRecord,
  listAllUsers,
  setUserRole,
} from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function checkAdmin() {
  const user = await currentUser();
  if (!user) throw new Error("Sign in required");

  const email = user.emailAddresses[0]?.emailAddress || "";
  // email extracted from currentUser above
  //

  if (!DASHBOARD_ALLOWED.includes(email)) {
    const role = await getUserRole(user.id);
    if (role !== "admin") throw new Error("Access denied");
  }
  await ensureUserRecord(user.id, email);

  return email;
}

export async function GET() {
  try {
    await checkAdmin();
    const users = await listAllUsers();
    return Response.json({ users });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "Sign in required") return jsonError(msg, 401);
    if (msg === "Access denied") return jsonError(msg, 403);
    return jsonError(msg, 500);
  }
}

export async function POST(request: Request) {
  try {
    await checkAdmin();

    const body = await request.json();
    const { userId, role } = body as { userId?: string; role?: string };

    if (!userId || !role) return jsonError("userId and role required", 400);
    if (!["admin", "user"].includes(role)) return jsonError("Invalid role", 400);

    const client = await clerkClient();
    const targetUser = await client.users.getUser(userId);
    const email = targetUser.emailAddresses[0]?.emailAddress || "";

    await setUserRole(userId, role as "admin" | "user", email);
    return Response.json({ ok: true, userId, role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "Sign in required") return jsonError(msg, 401);
    if (msg === "Access denied") return jsonError(msg, 403);
    return jsonError(msg, 500);
  }
}
