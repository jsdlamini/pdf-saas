import { createClerkClient } from "@clerk/backend";
import { listAllUsers, setUserRole } from "@/lib/user-roles";
import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  try {
    const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || "" });

    // Paginate through every Clerk user (Clerk is the source of truth for
    // registration, including Google OAuth sign-ups).
    const clerkUsers = [];
    const pageSize = 200;
    const maxPages = 25; // safety cap: 5000 users
    let offset = 0;
    for (let i = 0; i < maxPages; i += 1) {
      const page = await client.users.getUserList({ limit: pageSize, offset });
      const list = Array.isArray(page) ? page : page?.data;
      if (!Array.isArray(list)) {
        throw new Error(`Unexpected getUserList response: ${typeof page}`);
      }
      clerkUsers.push(...list);
      if (list.length < pageSize) break;
      offset += pageSize;
    }

    // Merge with locally stored roles (admin/user) where present.
    const localUsers = await listAllUsers();
    const localByUserId = new Map(localUsers.map((u) => [u.user_id, u]));

    const users = clerkUsers
      .map((u) => {
        const localUser = localByUserId.get(u.id);
        const created = localUser?.created_at ?? new Date(u.createdAt);
        return {
          user_id: u.id,
          email: u.emailAddresses[0]?.emailAddress || "",
          role: localUser?.role || "user",
          // `created_at` comes back as a Date from Postgres but as a string from
          // Clerk, so normalise both to ISO strings before sorting.
          created_at: created instanceof Date ? created.toISOString() : String(created),
        };
      })
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    return Response.json({ users });
  } catch (error) {
    console.error("[admin-users] failed to list users:", error);
    return jsonError(error instanceof Error ? error.message : "Could not load users.", 500);
  }
}

export async function POST(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    role?: string;
  } | null;
  const { userId: targetId, role } = body || {};
  if (!targetId || !role) return jsonError("userId and role required", 400);
  if (!["admin", "assistant", "user"].includes(role)) return jsonError("Invalid role", 400);

  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || "" });
  const targetUser = await client.users.getUser(targetId);
  const email = targetUser.emailAddresses[0]?.emailAddress || "";
  await setUserRole(targetId, role as "admin" | "assistant" | "user", email);
  return Response.json({ ok: true, userId: targetId, role });
}
