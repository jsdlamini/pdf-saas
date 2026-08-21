import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { db, ensureMigrated } from "@/lib/db";

// Analytics is public telemetry, but it must not be an unbounded write path.
// Cap field sizes and throttle per-IP so a scanner can't fill the table.
const checkRateLimit = createRateLimiter(60_000, 120);

function bounded(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`analytics:${ip}`)) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { event, path, referrer, tool, userId, detail } = body as {
      event: string;
      path?: string;
      referrer?: string;
      tool?: string;
      userId?: string;
      detail?: string;
    };

    const boundedEvent = bounded(event, 50);
    if (!boundedEvent) return NextResponse.json({ ok: false }, { status: 400 });
    const boundedPath = bounded(path, 500);
    const boundedReferrer = bounded(referrer, 500);
    const boundedTool = bounded(tool, 100);
    const boundedUserId = bounded(userId, 200);
    const boundedDetail = bounded(detail, 2000);

    // Simple Postgres-backed analytics via the shared pool.
    await ensureMigrated();
    const pool = db;

    const ipHash = ip;

    // Dedup: count each IP+path once per day
    if (boundedEvent === "pageview" && ip !== "unknown") {
      const existing = await pool.query(
        `SELECT id FROM wiserfiles_analytics 
         WHERE event = 'pageview' AND ip_hash = $1 AND path = $2 
         AND created_at > CURRENT_DATE 
         LIMIT 1`,
        [ipHash, boundedPath]
      );
      if (existing.rows.length > 0) {
        return NextResponse.json({ ok: true, deduped: true });
      }
    }

    // Geo lookup (free, no API key)
    let country = null;
    let city = null;
    if (ip !== "unknown" && !ip.startsWith("127.") && !ip.startsWith("192.168.") && !ip.startsWith("10.")) {
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}?fields=country,city`);
        if (geo.ok) {
          const geoData = await geo.json();
          country = geoData.country || null;
          city = geoData.city || null;
        }
      } catch { /* geo lookup is best-effort */ }
    }

    await pool.query(
      `INSERT INTO wiserfiles_analytics (event, path, referrer, tool, user_agent, ip_hash, country, city, user_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        boundedEvent,
        boundedPath,
        boundedReferrer,
        boundedTool,
        request.headers.get("user-agent") || null,
        ipHash,
        country,
        city,
        boundedUserId,
        boundedDetail,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Analytics error:", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
