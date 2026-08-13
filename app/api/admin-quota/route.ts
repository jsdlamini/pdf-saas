import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getAiQuotaLimits, setAiQuotaLimits } from "@/lib/ai-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in required.", status: 401 } as const;
  const role = await getUserRole(userId);
  if (role !== "admin") return { error: "Admin access required.", status: 403 } as const;
  return { userId, error: null, status: 200 } as const;
}

export async function GET() {
  const authResult = await requireAdmin();
  if (authResult.error) return jsonError(authResult.error, authResult.status);

  const limits = await getAiQuotaLimits();
  return Response.json({ limits });
}

export async function POST(request: Request) {
  const authResult = await requireAdmin();
  if (authResult.error) return jsonError(authResult.error, authResult.status);

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
