import { auth } from "@clerk/nextjs/server";
import {
  listResearchProjectsForUser,
  parseStoredResearchProject,
  upsertResearchProjectForUser,
} from "@/lib/research-project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  try {
    const projects = await listResearchProjectsForUser(userId);
    return Response.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load projects.";
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
    return jsonError(message, 500);
  }
}