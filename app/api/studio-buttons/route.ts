import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getButtonConfig, setButtonConfig, getButtonsForRole, type ButtonConfig } from "@/lib/studio-buttons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  const role = userId ? await getUserRole(userId) : "user";
  const buttons = await getButtonsForRole(role);
  const isAdmin = role === "admin";
  const config = isAdmin ? await getButtonConfig() : null;
  return Response.json({ role, buttons, isAdmin, config });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  const role = await getUserRole(userId);
  if (role !== "admin") return jsonError("Admin access required.", 403);

  const body = (await request.json().catch(() => null)) as { config?: ButtonConfig } | null;
  if (!body || !body.config) return jsonError("Invalid payload.", 400);

  await setButtonConfig(body.config);
  return Response.json({ ok: true });
}
