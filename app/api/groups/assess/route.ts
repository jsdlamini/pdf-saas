import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { CLASS_ASSESS_GROUP } from "@/lib/groups";
import { listAssignedStaffGroupIds } from "@/lib/groups-store";
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

async function resolveAssessor(): Promise<{ userId: string; role: string; assigned: Set<string> } | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const role = await getUserRole(userId);
  const assigned = await listAssignedStaffGroupIds(userId);
  return { userId, role, assigned };
}

function canAssessGroup(role: string, assigned: Set<string>, groupId: string): boolean {
  return role === "admin" || assigned.has(groupId);
}

export async function GET(request: Request) {
  const assessor = await resolveAssessor();
  if (!assessor) return jsonError("Assessor access required.", 403);
  const { role, assigned } = assessor;

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  if (groupId === CLASS_ASSESS_GROUP) {
    if (role !== "admin") return jsonError("Admin access required.", 403);
    const courseId = Number(url.searchParams.get("courseId"));
    if (!courseId) return jsonError("courseId is required.", 400);
    return Response.json(await getAssessmentForClass(courseId));
  }
  if (!groupId) return jsonError("Group required.", 400);
  if (!canAssessGroup(role, assigned, groupId)) return jsonError("Assessor access required.", 403);

  const data = await getAssessment(groupId);
  return Response.json(data);
}

export async function POST(request: Request) {
  const assessor = await resolveAssessor();
  if (!assessor) return jsonError("Assessor access required.", 403);
  const { role, assigned } = assessor;

  const body = (await request.json().catch(() => null)) as {
    groupId?: string;
    courseId?: number;
    marks?: AssessMark[];
  } | null;
  if (!body || typeof body.groupId !== "string") return jsonError("Invalid payload.", 400);

  if (body.groupId === CLASS_ASSESS_GROUP) {
    if (role !== "admin") return jsonError("Admin access required.", 403);
    const courseId = typeof body.courseId === "number" ? body.courseId : Number(body.courseId);
    if (!courseId) return jsonError("courseId is required.", 400);
    await saveAssessmentForClass(Array.isArray(body.marks) ? body.marks : [], courseId);
  } else {
    if (!canAssessGroup(role, assigned, body.groupId)) return jsonError("Assessor access required.", 403);
    await saveAssessment(body.groupId, Array.isArray(body.marks) ? body.marks : []);
  }
  return Response.json({ ok: true });
}
