import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getStudentScores } from "@/lib/assess-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// A student's own practical + test scores for a group they have joined.
// The exam is intentionally excluded.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  if (!groupId) return jsonError("Group required.", 400);

  const member = await db.query(
    `SELECT 1 FROM wiserfiles_group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (member.rows.length === 0) return jsonError("Join the group to view your scores.", 403);

  const scores = await getStudentScores(groupId, userId);
  return Response.json(scores);
}
