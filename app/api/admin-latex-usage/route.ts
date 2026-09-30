import { db } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const pool = db;

  // LaTeX usage: compile events (detail = "latex") plus research-studio visits.
  const rows = (
    await pool.query(
      `SELECT
         user_id,
         COUNT(*) FILTER (WHERE event = 'compile' AND detail = 'latex')::int AS compiles,
         COUNT(DISTINCT DATE(created_at))::int AS active_days,
         MAX(created_at) AS last_seen
       FROM wiserfiles_analytics
       WHERE user_id IS NOT NULL AND user_id != 'guest'
         AND ((event = 'compile' AND detail = 'latex') OR (event = 'pageview' AND tool = 'research-studio'))
       GROUP BY user_id
       ORDER BY compiles DESC, active_days DESC
       LIMIT 100`
    )
  ).rows;

  const projRows = (
    await pool.query(
      `SELECT user_id, COUNT(*)::int AS projects
       FROM wiserfiles_research_projects
       WHERE user_id IS NOT NULL
       GROUP BY user_id`
    )
  ).rows;
  const projByUser = new Map<string, number>();
  for (const r of projRows) projByUser.set(r.user_id as string, r.projects as number);

  const ids = rows.map((r) => r.user_id as string);
  const nameMap = new Map<string, string>();
  const emailMap = new Map<string, string>();
  if (ids.length) {
    try {
      const client = await clerkClient();
      const settled = await Promise.allSettled(ids.map((id) => client.users.getUser(id)));
      settled.forEach((res, i) => {
        if (res.status !== "fulfilled") return;
        const u = res.value;
        const id = ids[i];
        nameMap.set(
          id,
          [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || ""
        );
        emailMap.set(id, u.primaryEmailAddress?.emailAddress || "");
      });
    } catch {
      /* best-effort */
    }
  }

  const users = rows.map((r) => {
    const id = r.user_id as string;
    return {
      user_id: id,
      name: nameMap.get(id) || "",
      email: emailMap.get(id) || "",
      compiles: r.compiles as number,
      activeDays: r.active_days as number,
      projects: projByUser.get(id) ?? 0,
      lastSeen: r.last_seen,
    };
  });

  return Response.json({ users });
}
