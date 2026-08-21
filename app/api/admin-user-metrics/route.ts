import { db } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId")?.trim();
  if (!userId) return jsonError("userId is required.", 400);

  const pool = db;

  try {
    const [
      identity,
      totalsResult,
      tools,
      daily,
      referrers,
      recent,
      lastSeen,
    ] = await Promise.all([
      // Latest known location (country/city).
      pool.query(
        `SELECT country, city FROM wiserfiles_analytics
         WHERE user_id = $1 AND (country IS NOT NULL OR city IS NOT NULL)
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      ),
      // Aggregate usage counts.
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event = 'pageview')::int AS pageviews,
           COUNT(*)::int AS events
         FROM wiserfiles_analytics WHERE user_id = $1`,
        [userId]
      ),
      // Tools/services used.
      pool.query(
        `SELECT tool, COUNT(*)::int AS count, MAX(created_at) AS last_used
         FROM wiserfiles_analytics
         WHERE user_id = $1 AND event = 'pageview' AND tool IS NOT NULL AND tool != 'home'
         GROUP BY tool ORDER BY count DESC, last_used DESC LIMIT 50`,
        [userId]
      ),
      // Activity per day (last 30 days).
      pool.query(
        `SELECT DATE(created_at)::text AS date, COUNT(*)::int AS count
         FROM wiserfiles_analytics
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`,
        [userId]
      ),
      // Referrers.
      pool.query(
        `SELECT referrer, COUNT(*)::int AS count
         FROM wiserfiles_analytics
         WHERE user_id = $1 AND referrer IS NOT NULL AND referrer != 'direct'
         GROUP BY referrer ORDER BY count DESC LIMIT 10`,
        [userId]
      ),
      // Recent events (what the user did, when).
      pool.query(
        `SELECT event, tool, path, detail, country, city, created_at
         FROM wiserfiles_analytics
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [userId]
      ),
      // First and last activity timestamps.
      pool.query(
        `SELECT MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
         FROM wiserfiles_analytics WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const totals = totalsResult.rows[0] || { pageviews: 0, events: 0 };
    const seen = lastSeen.rows[0] || { first_seen: null, last_seen: null };

    const metrics = {
      userId,
      country: identity.rows[0]?.country || null,
      city: identity.rows[0]?.city || null,
      pageviews: totals.pageviews,
      totalEvents: totals.events,
      firstSeen: seen.first_seen,
      lastSeen: seen.last_seen,
      tools: tools.rows,
      daily: daily.rows,
      referrers: referrers.rows,
      recent: recent.rows,
    };

    return Response.json({ metrics });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load user metrics.", 500);
  }
}
