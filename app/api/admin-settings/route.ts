import { requireDashboardAccess } from "@/lib/dashboard-access";
import { getLecturerEmailDomains, setLecturerEmailDomains } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const lecturerEmailDomains = await getLecturerEmailDomains();
  return Response.json({ lecturerEmailDomains });
}

export async function POST(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const body = (await request.json().catch(() => null)) as { lecturerEmailDomains?: string } | null;
  if (!body || typeof body.lecturerEmailDomains !== "string") {
    return jsonError("lecturerEmailDomains is required.", 400);
  }

  const lecturerEmailDomains = await setLecturerEmailDomains(body.lecturerEmailDomains);
  return Response.json({ lecturerEmailDomains });
}
