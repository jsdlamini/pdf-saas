import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { listGroupSwitches } from "@/lib/groups-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const role = await getUserRole(userId);
  if (role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  return Response.json({ switches: await listGroupSwitches() });
}
