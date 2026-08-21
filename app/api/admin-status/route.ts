import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight admin check for the site header, so admins see a Dashboard link
// without typing the path. Reuses the canonical role check + email bootstrap.
export async function GET() {
  const access = await requireDashboardAccess();
  return Response.json({ isAdmin: !access.error });
}
