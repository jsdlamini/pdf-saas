import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getAssessment, saveAssessment, type AssessMark, type AssessTest } from "@/lib/assess-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function resolveAssessor(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const role = await getUserRole(userId);
  return role === "admin" || role === "assistant" ? userId : null;
}

export async function GET(request: Request) {
  const userId = await resolveAssessor();
  if (!userId) return jsonError("Assessor access required.", 403);

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  if (!groupId) return jsonError("Group required.", 400);

  const data = await getAssessment(groupId);
  return Response.json(data);
}

export async function POST(request: Request) {
  const userId = await resolveAssessor();
  if (!userId) return jsonError("Assessor access required.", 403);

  const body = (await request.json().catch(() => null)) as {
    groupId?: string;
    marks?: AssessMark[];
    tests?: AssessTest[];
  } | null;
  if (!body || typeof body.groupId !== "string") return jsonError("Invalid payload.", 400);

  await saveAssessment(
    body.groupId,
    Array.isArray(body.marks) ? body.marks : [],
    Array.isArray(body.tests) ? body.tests : []
  );
  return Response.json({ ok: true });
}
