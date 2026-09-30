import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    rating?: number;
    reason?: string;
    message?: string;
    path?: string;
  } | null;
  if (!body) return jsonError("Invalid payload.", 400);

  const kind = body.kind === "compile-failed" ? "compile-failed" : "general";
  const rating =
    typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5
      ? Math.round(body.rating)
      : null;
  const message = (body.message || "").trim().slice(0, 2000);
  const reason = (body.reason || "").trim().slice(0, 200);
  const path = (body.path || "").trim().slice(0, 500);

  // A rating + a message are both optional, but at least one should be present.
  if (rating === null && !message && !reason) {
    return jsonError("Nothing to submit.", 400);
  }

  let email = "";
  if (userId) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      email = user.primaryEmailAddress?.emailAddress || "";
    } catch {
      /* best-effort */
    }
  }

  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_feedback (user_id, email, kind, rating, reason, message, path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId || null, email || null, kind, rating, reason || null, message || null, path || null]
  );

  return Response.json({ ok: true });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  await ensureMigrated();
  const rows = (
    await db.query(
      `SELECT id, user_id, email, kind, rating, reason, message, path, created_at
       FROM wiserfiles_feedback
       ORDER BY created_at DESC
       LIMIT 200`
    )
  ).rows;

  return Response.json({
    feedback: rows.map((r) => ({
      id: r.id,
      userId: (r.user_id as string) || null,
      email: (r.email as string) || "",
      kind: r.kind as string,
      rating: (r.rating as number) ?? null,
      reason: (r.reason as string) || "",
      message: (r.message as string) || "",
      path: (r.path as string) || "",
      createdAt: r.created_at,
    })),
  });
}
