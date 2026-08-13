import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function ensureSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_collab_docs (
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, file_path)
    )
  `);
}

// GET the shared document content + revision for a specific file in a project
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const filePath = url.searchParams.get("filePath") || "main.tex";
  if (!projectId) return jsonError("Missing projectId", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);

  const result = await pool.query(
    `SELECT content, revision FROM wiserfiles_collab_docs WHERE project_id = $1 AND file_path = $2`,
    [projectId, filePath]
  );
  await pool.end();

  if (!result.rows.length) {
    return Response.json({ content: null, revision: 0 });
  }
  return Response.json({ content: result.rows[0].content, revision: result.rows[0].revision });
}

// POST my file content with optimistic concurrency (baseRevision)
export async function POST(request: Request) {
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
  const baseRevision = typeof body?.baseRevision === "number" ? body.baseRevision : 0;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);

  const current = await pool.query(
    `SELECT content, revision FROM wiserfiles_collab_docs WHERE project_id = $1 AND file_path = $2`,
    [projectId, filePath]
  );

  if (current.rows.length && current.rows[0].revision > baseRevision) {
    await pool.end();
    return Response.json({
      conflict: true,
      content: current.rows[0].content,
      revision: current.rows[0].revision,
    });
  }

  const nextRevision = (current.rows.length ? current.rows[0].revision : 0) + 1;
  await pool.query(
    `INSERT INTO wiserfiles_collab_docs (project_id, file_path, content, revision, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (project_id, file_path)
     DO UPDATE SET content = EXCLUDED.content, revision = EXCLUDED.revision, updated_at = NOW()`,
    [projectId, filePath, content, nextRevision]
  );
  await pool.end();

  return Response.json({ content, revision: nextRevision });
}
