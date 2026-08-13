import { auth, clerkClient } from "@clerk/nextjs/server";
import { getAiQuotaLimits, setAiQuotaLimits } from "@/lib/ai-quota";
import { DASHBOARD_ALLOWED } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function requireDashboardAccess() {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in required.", status: 401 } as const;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress || "";
    if (DASHBOARD_ALLOWED.includes(email)) {
      return { userId, email, error: null, status: 200 } as const;
    }
  } catch { /* fall through to denied */ }
  return { error: "Dashboard access required.", status: 403 } as const;
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
