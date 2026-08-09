import { auth } from "@clerk/nextjs/server";
import { Pool } from "pg";
import { DASHBOARD_ALLOWED } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const { users } = await import("@clerk/nextjs/server");
  const clerk = (await users.getUser(userId)) as { emailAddresses: Array<{ emailAddress: string }> };
  const email = clerk.emailAddresses[0]?.emailAddress || "";
  if (!DASHBOARD_ALLOWED.includes(email)) {
    return jsonError("Access denied.", 403);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 3000,
  });

  try {
    const [pageviews, tools, daily, referrers, totalUsers] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM wiserfiles_analytics WHERE event = 'pageview'`),
      pool.query(
        `SELECT tool, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND tool IS NOT NULL GROUP BY tool ORDER BY count DESC LIMIT 15`
      ),
      pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date DESC`
      ),
      pool.query(
        `SELECT referrer, COUNT(*) as count FROM wiserfiles_analytics WHERE event = 'pageview' AND referrer IS NOT NULL AND referrer != 'direct' GROUP BY referrer ORDER BY count DESC LIMIT 10`
      ),
      pool.query(`SELECT COUNT(DISTINCT ip_hash) as total FROM wiserfiles_analytics`),
    ]);

    await pool.end();

    return Response.json({
      totalPageviews: parseInt(pageviews.rows[0]?.total || "0"),
      tools: tools.rows,
      daily: daily.rows,
      referrers: referrers.rows,
      uniqueVisitors: parseInt(totalUsers.rows[0]?.total || "0"),
    });
  } catch (e) {
    await pool.end().catch(() => {});
    return jsonError("Failed to load analytics.", 500);
  }
}
