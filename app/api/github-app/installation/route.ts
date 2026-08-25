import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disconnect the GitHub App installation for the signed-in user (keeps any
// manual PAT intact). The user re-runs the install flow to reconnect.
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });

  await ensureMigrated();
  await db.query(
    `UPDATE wiserfiles_user_secrets SET github_installation_id = NULL, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );

  return Response.json({ ok: true });
}
