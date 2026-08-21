import { Pool } from "pg";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { projectData, accessLevel } = body as {
      projectData?: { name?: string; entries?: unknown[] };
      accessLevel?: string;
    };

    if (!projectData || !projectData.name || !projectData.entries) {
      return Response.json({ error: "Invalid project data" }, { status: 400 });
    }

    const access = accessLevel === "write" || accessLevel === "admin" ? accessLevel : "read";

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 3000,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wiserfiles_shared_projects (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Full UUID: 122 bits of entropy. An 8-char slice is only 32 bits —
    // enumerable by scanning, and collides on the primary key under load.
    const shareId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO wiserfiles_shared_projects (id, data) VALUES ($1, $2)`,
      [shareId, JSON.stringify({ ...projectData, accessLevel: access })]
    );
    await pool.end();

    return Response.json({ shareId });
  } catch (e) {
    return Response.json({ error: "Failed to create share link" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing share id" }, { status: 400 });

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 3000,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wiserfiles_shared_projects (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await pool.query(
      `SELECT data FROM wiserfiles_shared_projects WHERE id = $1`,
      [id]
    );
    await pool.end();

    if (!result.rows.length) {
      return Response.json({ error: "Shared project not found" }, { status: 404 });
    }

    return Response.json({ project: result.rows[0].data });
  } catch (e) {
    return Response.json({ error: "Failed to load shared project" }, { status: 500 });
  }
}
