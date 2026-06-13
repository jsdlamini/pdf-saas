import { auth } from "@clerk/nextjs/server";
import { deleteResearchProjectForUser } from "@/lib/research-project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: RouteProps) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const { id } = await params;
  if (!id) return jsonError("Project id is required.", 400);

  try {
    await deleteResearchProjectForUser(userId, id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete project.";
    return jsonError(message, 500);
  }
}