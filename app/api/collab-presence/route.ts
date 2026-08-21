import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// GET active collaborators' cursors for a project (updated within TTL)
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("Missing projectId", 400);

  await ensureMigrated();
  const result = await db.query(
    `SELECT user_id, name, color, cursor_pos, updated_at
     FROM wiserfiles_collab_presence
     WHERE project_id = $1
       AND updated_at > NOW() - INTERVAL '15 seconds'
       AND user_id <> $2
     ORDER BY updated_at DESC`,
    [projectId, userId]
  );

  const cursors = result.rows.map((r) => ({
    userId: r.user_id,
    name: r.name || "Collaborator",
    color: r.color,
    cursorPos: r.cursor_pos,
    updatedAt: r.updated_at,
  }));

  return Response.json({ cursors });
}

// POST my cursor position (heartbeat)
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json().catch(() => null) as {
    projectId?: string;
    name?: string;
    color?: string;
    cursorPos?: number;
  } | null;

  const projectId = body?.projectId;
  if (!projectId) return jsonError("Missing projectId", 400);

  await ensureMigrated();
  const cursorPos = typeof body?.cursorPos === "number" && body.cursorPos >= 0 ? body.cursorPos : 0;
  const name = (body?.name || "Collaborator").slice(0, 60);
  const color = (body?.color || "#4ade80").slice(0, 20);

  await db.query(
    `INSERT INTO wiserfiles_collab_presence (user_id, project_id, name, color, cursor_pos, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, project_id)
     DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, cursor_pos = EXCLUDED.cursor_pos, updated_at = NOW()`,
    [userId, projectId, name, color, cursorPos]
  );

  return Response.json({ ok: true });
}
