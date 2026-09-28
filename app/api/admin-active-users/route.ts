import { db } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get("days") || "30", 10);
  const days = [30, 90, 365].includes(daysParam) ? daysParam : 30;
  const nonStudentsOnly = url.searchParams.get("students") === "0";

  const pool = db;

  // Active signed-in users ranked by activity over the window.
  const rows = (
    await pool.query(
      `SELECT
         user_id,
         COUNT(*)::int AS events,
         COUNT(DISTINCT DATE(created_at))::int AS active_days,
         COUNT(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
         COUNT(*) FILTER (WHERE event != 'pageview')::int AS actions,
         MAX(created_at) AS last_seen
       FROM wiserfiles_analytics
       WHERE user_id IS NOT NULL AND user_id != 'guest'
         AND created_at > NOW() - ($1 || ' days')::interval
       GROUP BY user_id
       ORDER BY events DESC
       LIMIT 100`,
      [String(days)]
    )
  ).rows;

  // Which user_ids belong to a practical group (i.e. are students).
  const studentIds = new Set(
    (
      await pool.query(
        `SELECT DISTINCT user_id FROM wiserfiles_group_members WHERE user_id IS NOT NULL`
      )
    ).rows.map((r) => r.user_id as string)
  );

  // Top tools per user (pageviews carry the tool slug).
  const toolRows = (
    await pool.query(
      `SELECT user_id, tool, COUNT(*)::int AS count
       FROM wiserfiles_analytics
       WHERE user_id IS NOT NULL AND user_id != 'guest' AND event = 'pageview'
         AND tool IS NOT NULL AND tool NOT IN ('', 'home')
       GROUP BY user_id, tool`
    )
  ).rows;
  const toolsByUser = new Map<string, { tool: string; count: number }[]>();
  for (const r of toolRows) {
    const list = toolsByUser.get(r.user_id as string) ?? [];
    list.push({ tool: r.tool as string, count: r.count as number });
    toolsByUser.set(r.user_id as string, list);
  }

  // Resolve names/emails from Clerk (best-effort, parallel).
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

  let users = rows.map((r) => {
    const id = r.user_id as string;
    const topTools = (toolsByUser.get(id) ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((t) => t.tool);
    return {
      user_id: id,
      name: nameMap.get(id) || "",
      email: emailMap.get(id) || "",
      isStudent: studentIds.has(id),
      events: r.events as number,
      activeDays: r.active_days as number,
      pageviews: r.pageviews as number,
      actions: r.actions as number,
      lastSeen: r.last_seen,
      topTools,
    };
  });

  if (nonStudentsOnly) {
    users = users.filter((u) => !u.isStudent);
  }

  return Response.json({ users });
}
