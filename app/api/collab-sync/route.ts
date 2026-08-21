import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// GET the shared document content + revision for a specific file in a project
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const filePath = url.searchParams.get("filePath") || "main.tex";
  if (!projectId) return jsonError("Missing projectId", 400);

  await ensureMigrated();
  const result = await db.query(
    `SELECT content, revision FROM wiserfiles_collab_docs WHERE project_id = $1 AND file_path = $2`,
    [projectId, filePath]
  );

  if (!result.rows.length) {
    return Response.json({ content: null, revision: 0 });
  }
  return Response.json({ content: result.rows[0].content, revision: result.rows[0].revision });
}

// POST my file content with optimistic concurrency (baseRevision)
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json().catch(() => null) as {
    projectId?: string;
    filePath?: string;
    content?: string;
    baseRevision?: number;
  } | null;

  const projectId = body?.projectId;
  if (!projectId) return jsonError("Missing projectId", 400);
  const filePath = body?.filePath || "main.tex";
  const content = typeof body?.content === "string" ? body.content : "";
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return jsonError("Document content exceeds the 2MB limit.", 413);
  }
  const baseRevision = typeof body?.baseRevision === "number" ? body.baseRevision : 0;

  await ensureMigrated();
  const current = await db.query(
    `SELECT content, revision FROM wiserfiles_collab_docs WHERE project_id = $1 AND file_path = $2`,
    [projectId, filePath]
  );

  if (current.rows.length && current.rows[0].revision > baseRevision) {
    return Response.json({
      conflict: true,
      content: current.rows[0].content,
      revision: current.rows[0].revision,
    });
  }

  const nextRevision = (current.rows.length ? current.rows[0].revision : 0) + 1;
  await db.query(
    `INSERT INTO wiserfiles_collab_docs (project_id, file_path, content, revision, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (project_id, file_path)
     DO UPDATE SET content = EXCLUDED.content, revision = EXCLUDED.revision, updated_at = NOW()`,
    [projectId, filePath, content, nextRevision]
  );

  // Notify connected collaborators (SSE) of the new revision
  try {
    await db.query(
      `SELECT pg_notify($1, $2)`,
      [`collab_${projectId}`, JSON.stringify({ filePath, revision: nextRevision })]
    );
  } catch {
    // notify is best-effort
  }

  return Response.json({ content, revision: nextRevision });
}
