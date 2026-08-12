import { auth } from "@clerk/nextjs/server";
import {
  deleteResearchProjectForUser,
  listResearchProjectsForUser,
  parseStoredResearchProject,
  upsertResearchProjectForUser,
} from "@/lib/research-project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  try {
    const projects = await listResearchProjectsForUser(userId);
    return Response.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load projects.";
    if (message.includes("DATABASE_URL is not configured")) {
      return jsonError("Account sync storage is not available on this deployment.", 503, "ACCOUNT_SYNC_UNAVAILABLE");
    }
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const project = parseStoredResearchProject(payload);
  if (!project) return jsonError("Invalid project payload.", 400);

  try {
    const saved = await upsertResearchProjectForUser(userId, project);
    return Response.json({ project: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save project.";
    if (message.includes("DATABASE_URL is not configured")) {
      return jsonError("Account sync storage is not available on this deployment.", 503, "ACCOUNT_SYNC_UNAVAILABLE");
    }
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  let id: string | null = null;

  try {
    const payload = (await request.json().catch(() => null)) as { id?: unknown } | null;
    if (payload && typeof payload.id === "string" && payload.id.trim()) {
      id = payload.id.trim();
    }
  } catch {
    // Fall back to the query parameter below.
  }

  if (!id) {
    const url = new URL(request.url);
    const queryId = url.searchParams.get("id");
    if (queryId && queryId.trim()) id = queryId.trim();
  }

  if (!id) return jsonError("Project id is required.", 400);

  try {
    await deleteResearchProjectForUser(userId, id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete project.";
    if (message.includes("DATABASE_URL is not configured")) {
      return jsonError("Account sync storage is not available on this deployment.", 503, "ACCOUNT_SYNC_UNAVAILABLE");
    }
    return jsonError(message, 500);
  }
}