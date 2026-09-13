import { db } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const pool = db;

  try {
    const [pageviews, tools, daily, dailyVisitors, referrers, totalUsers, countries, cities, events, recent, homePageviews, topPaths, returningVisitors, weekOverWeek] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM wiserfiles_analytics WHERE event = 'pageview'`),
      pool.query(
        `SELECT tool, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND tool IS NOT NULL AND tool != 'home' GROUP BY tool ORDER BY count DESC LIMIT 15`
      ),
      pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '15 days' GROUP BY DATE(created_at) ORDER BY date ASC`
      ),
      pool.query(
        `SELECT DATE(created_at) as date, COUNT(DISTINCT ip_hash) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '15 days' GROUP BY DATE(created_at) ORDER BY date ASC`
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
    ]);

    return Response.json({
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
    });
  } catch (e) {
    return jsonError("Failed to load analytics.", 500);
  }
}
