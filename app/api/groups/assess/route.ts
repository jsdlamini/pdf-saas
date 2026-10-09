import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { CLASS_ASSESS_GROUP } from "@/lib/groups";
import {
  getAssessment,
  getAssessmentForClass,
  saveAssessment,
  saveAssessmentForClass,
  type AssessMark,
} from "@/lib/assess-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function resolveRole(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return await getUserRole(userId);
}

export async function GET(request: Request) {
  const role = await resolveRole();
  if (role !== "admin" && role !== "assistant") {
    return jsonError("Assessor access required.", 403);
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  if (groupId === CLASS_ASSESS_GROUP) {
    if (role !== "admin") return jsonError("Admin access required.", 403);
    return Response.json(await getAssessmentForClass());
  }
  if (!groupId) return jsonError("Group required.", 400);

  const data = await getAssessment(groupId);
  return Response.json(data);
}

export async function POST(request: Request) {
  const role = await resolveRole();
  if (role !== "admin" && role !== "assistant") {
    return jsonError("Assessor access required.", 403);
  }

  const body = (await request.json().catch(() => null)) as {
    groupId?: string;
    marks?: AssessMark[];
  } | null;
  if (!body || typeof body.groupId !== "string") return jsonError("Invalid payload.", 400);

  if (body.groupId === CLASS_ASSESS_GROUP) {
    if (role !== "admin") return jsonError("Admin access required.", 403);
    await saveAssessmentForClass(Array.isArray(body.marks) ? body.marks : []);
  } else {
    await saveAssessment(body.groupId, Array.isArray(body.marks) ? body.marks : []);
  }
  return Response.json({ ok: true });
}
