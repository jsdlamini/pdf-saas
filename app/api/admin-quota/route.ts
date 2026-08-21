import { getAiQuotaLimits, setAiQuotaLimits } from "@/lib/ai-quota";
import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const limits = await getAiQuotaLimits();
  return Response.json({ limits });
}

export async function POST(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const body = await request.json().catch(() => null) as {
    guestDailyLimit?: number;
    registeredDailyLimit?: number;
  } | null;

  if (!body || (typeof body.guestDailyLimit !== "number" && typeof body.registeredDailyLimit !== "number")) {
    return jsonError("Provide guestDailyLimit and/or registeredDailyLimit.", 400);
  }

  const limits = await setAiQuotaLimits({
    guestDailyLimit: body.guestDailyLimit,
    registeredDailyLimit: body.registeredDailyLimit,
  });
  return Response.json({ limits });
}
