import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

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

    await ensureMigrated();

    // Full UUID: 122 bits of entropy. An 8-char slice is only 32 bits —
    // enumerable by scanning, and collides on the primary key under load.
    const shareId = crypto.randomUUID();
    await db.query(
      `INSERT INTO wiserfiles_shared_projects (id, data) VALUES ($1, $2)`,
      [shareId, JSON.stringify({ ...projectData, accessLevel: access })]
    );

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
    await ensureMigrated();
    const result = await db.query(
      `SELECT data FROM wiserfiles_shared_projects WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return Response.json({ error: "Shared project not found" }, { status: 404 });
    }

    return Response.json({ project: result.rows[0].data });
  } catch (e) {
    return Response.json({ error: "Failed to load shared project" }, { status: 500 });
  }
}
