import { db } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get("days") || "15", 10);
  const days = [15, 30, 90].includes(daysParam) ? daysParam : 15;
  const asCsv = url.searchParams.get("format") === "csv";
  const day = url.searchParams.get("day") || "";
  const country = url.searchParams.get("country") || "";

  const pool = db;

  // Lightweight live-users poll (no refresh needed): returns just the people
  // active in the last 5 minutes with resolved names.
  if (url.searchParams.get("live") === "1") {
    try {
      const liveRows = (await pool.query(
        `SELECT user_id, MAX(created_at) AS last_seen FROM wiserfiles_analytics WHERE created_at > NOW() - INTERVAL '5 minutes' AND user_id IS NOT NULL AND user_id != 'guest' GROUP BY user_id ORDER BY last_seen DESC LIMIT 50`
      )).rows;
      const ids = [...new Set(liveRows.map((e) => e.user_id as string).filter(Boolean))];
      const nameMap = new Map<string, string>();
      if (ids.length) {
        try {
          const client = await clerkClient();
          for (const id of ids.slice(0, 50)) {
            try {
              const u = await client.users.getUser(id);
              const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "";
              const email = u.primaryEmailAddress?.emailAddress || "";
              nameMap.set(id, name ? `${name}${email ? ` (${email})` : ""}` : email);
            } catch { /* skip */ }
          }
        } catch { /* best-effort */ }
      }
      return Response.json({ liveUsers: liveRows.map((e) => ({ ...e, name: nameMap.get(e.user_id as string) || "" })) });
    } catch {
      return Response.json({ liveUsers: [] });
    }
  }

  try {
    const [pageviews, tools, daily, dailyVisitors, referrers, totalUsers, countries, cities, events, recent, homePageviews, topPaths, returningVisitors, weekOverWeek, hourly] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM wiserfiles_analytics WHERE event = 'pageview'`),
      pool.query(
        `SELECT tool, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND tool IS NOT NULL AND tool != 'home' GROUP BY tool ORDER BY count DESC LIMIT 15`
      ),
      pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date ASC`
      ),
      pool.query(
        `SELECT DATE(created_at) as date, COUNT(DISTINCT ip_hash) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '${days} days' GROUP BY DATE(created_at) ORDER BY date ASC`
      ),
      pool.query(
        `SELECT referrer, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND referrer IS NOT NULL AND referrer != 'direct' GROUP BY referrer ORDER BY count DESC LIMIT 10`
      ),
      pool.query(`SELECT COUNT(DISTINCT ip_hash) as total FROM wiserfiles_analytics`),
      pool.query(
        `SELECT country, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND country IS NOT NULL GROUP BY country ORDER BY count DESC LIMIT 20`
      ),
      pool.query(
        `SELECT city, country, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND city IS NOT NULL GROUP BY city, country ORDER BY count DESC LIMIT 20`
      ),
      pool.query(
        `SELECT event, COUNT(*) as count FROM wiserfiles_analytics GROUP BY event ORDER BY count DESC LIMIT 30`
      ),
      pool.query(
        `SELECT event, detail, user_id, ip_hash, created_at FROM wiserfiles_analytics ORDER BY created_at DESC LIMIT 50`
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM wiserfiles_analytics WHERE event = 'pageview' AND tool = 'home'`
      ),
      pool.query(
        `SELECT path, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND path IS NOT NULL GROUP BY path ORDER BY count DESC LIMIT 10`
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM (SELECT ip_hash FROM wiserfiles_analytics WHERE event = 'pageview' GROUP BY ip_hash HAVING COUNT(*) > 1) sub`
      ),
      pool.query(
        `SELECT (SELECT COUNT(*) FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '7 days') as current, (SELECT COUNT(*) FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days') as previous`
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '${days} days' GROUP BY hour ORDER BY hour ASC`
      ),
    ]);

    const payload = {
      totalPageviews: parseInt(pageviews.rows[0]?.total || "0"),
      tools: tools.rows,
      daily: daily.rows,
      dailyVisitors: dailyVisitors.rows,
      referrers: referrers.rows,
      uniqueVisitors: parseInt(totalUsers.rows[0]?.total || "0"),
      countries: countries.rows,
      cities: cities.rows,
      events: events.rows,
      recentEvents: recent.rows,
      homePageviews: parseInt(homePageviews.rows[0]?.total || "0"),
      topPaths: topPaths.rows,
      returningVisitors: parseInt(returningVisitors.rows[0]?.total || "0"),
      weekOverWeek: {
        current: parseInt(weekOverWeek.rows[0]?.current || "0"),
        previous: parseInt(weekOverWeek.rows[0]?.previous || "0"),
      },
      hourly: hourly.rows,
      funnel: {
        home: parseInt(homePageviews.rows[0]?.total || "0"),
        tools: tools.rows.reduce((sum, t) => sum + parseInt(t.count, 10), 0),
        actions: events.rows.filter((e) => e.event !== "pageview").reduce((sum, e) => sum + parseInt(e.count, 10), 0),
      },
      dayEvents: day
        ? (await pool.query(
            `SELECT event, detail, user_id, ip_hash, country, city, duration_ms, created_at FROM wiserfiles_analytics WHERE DATE(created_at) = $1 ORDER BY created_at DESC LIMIT 300`,
            [day]
          )).rows
        : [],
      daySummary: day
        ? (await pool.query(
            `SELECT event, COUNT(*) as count FROM wiserfiles_analytics WHERE DATE(created_at) = $1 GROUP BY event ORDER BY count DESC`,
            [day]
          )).rows
        : [],
      retention: day
        ? []
        : (await pool.query(
            `WITH weekly AS (
               SELECT DATE_TRUNC('week', created_at) AS week, ip_hash
               FROM wiserfiles_analytics
               WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '8 weeks'
               GROUP BY week, ip_hash
             )
             SELECT TO_CHAR(w1.week, 'YYYY-MM-DD') AS week,
                    COUNT(DISTINCT w1.ip_hash)::int AS visitors,
                    COUNT(DISTINCT w2.ip_hash)::int AS returned
             FROM weekly w1
             LEFT JOIN weekly w2 ON w2.ip_hash = w1.ip_hash AND w2.week = w1.week + INTERVAL '1 week'
             GROUP BY w1.week
             ORDER BY w1.week ASC`
          )).rows,
      liveUsers: (await pool.query(
        `SELECT user_id, MAX(created_at) AS last_seen FROM wiserfiles_analytics WHERE created_at > NOW() - INTERVAL '5 minutes' AND user_id IS NOT NULL AND user_id != 'guest' GROUP BY user_id ORDER BY last_seen DESC LIMIT 50`
      )).rows,
      countryEvents: country
        ? (await pool.query(
            `SELECT user_id, ip_hash, event, detail, tool, path, city, created_at FROM wiserfiles_analytics WHERE country = $1 ORDER BY created_at DESC LIMIT 300`,
            [country]
          )).rows
        : [],
    };

    // Resolve names/emails for the selected day's events and live users so the
    // reviewer can see exactly who did what (best-effort, deduped by user id).
    const allIds = [
      ...(day ? payload.dayEvents.map((e) => e.user_id) : []),
      ...payload.liveUsers.map((e) => e.user_id),
      ...payload.countryEvents.map((e) => e.user_id),
    ].filter((id): id is string => Boolean(id) && id !== "guest");
    const uniqueIds = [...new Set(allIds)];
    const nameMap = new Map<string, string>();
    if (uniqueIds.length > 0) {
      try {
        const client = await clerkClient();
        for (const id of uniqueIds.slice(0, 100)) {
          try {
            const u = await client.users.getUser(id);
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "";
            const email = u.primaryEmailAddress?.emailAddress || "";
            nameMap.set(id, name ? `${name}${email ? ` (${email})` : ""}` : email);
          } catch { /* skip unresolvable */ }
        }
      } catch { /* best-effort */ }
    }
    payload.dayEvents = payload.dayEvents.map((e) => ({ ...e, name: nameMap.get(e.user_id) || "" }));
    payload.liveUsers = payload.liveUsers.map((e) => ({ ...e, name: nameMap.get(e.user_id) || "" }));
    payload.countryEvents = payload.countryEvents.map((e) => ({ ...e, name: nameMap.get(e.user_id) || "" }));

    if (asCsv) {
      const lines: string[] = [];
      lines.push("Summary");
      lines.push("Metric,Value");
      lines.push(`Total pageviews,${payload.totalPageviews}`);
      lines.push(`Unique visitors,${payload.uniqueVisitors}`);
      lines.push(`Returning visitors,${payload.returningVisitors}`);
      lines.push(`7-day pageviews,${payload.weekOverWeek.current}`);
      lines.push(`Prior 7-day pageviews,${payload.weekOverWeek.previous}`);
      lines.push("");
      lines.push(`Daily pageviews (last ${days} days)`);
      lines.push("Date,Pageviews,Visitors");
      const visitorMap = new Map(payload.dailyVisitors.map((d) => [d.date, d.count]));
      for (const d of payload.daily) {
        lines.push(`${csvCell(d.date)},${csvCell(d.count)},${csvCell(visitorMap.get(d.date) ?? 0)}`);
      }
      lines.push("");
      lines.push("Top tools");
      lines.push("Tool,Pageviews");
      for (const t of payload.tools) lines.push(`${csvCell(t.tool)},${csvCell(t.count)}`);
      lines.push("");
      lines.push("Top referrers");
      lines.push("Referrer,Pageviews");
      for (const r of payload.referrers) lines.push(`${csvCell(r.referrer)},${csvCell(r.count)}`);
      lines.push("");
      lines.push("Top pages");
      lines.push("Path,Pageviews");
      for (const p of payload.topPaths) lines.push(`${csvCell(p.path)},${csvCell(p.count)}`);
      lines.push("");
      lines.push("Hourly pageviews");
      lines.push("Hour,Pageviews");
      for (const h of payload.hourly) lines.push(`${csvCell(h.hour)},${csvCell(h.count)}`);

      const csv = "\uFEFF" + lines.join("\n") + "\n";
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="wiserfiles-analytics-${days}d.csv"`,
        },
      });
    }

    return Response.json(payload);
  } catch (e) {
    return jsonError("Failed to load analytics.", 500);
  }
}
