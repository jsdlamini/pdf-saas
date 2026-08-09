import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, path, referrer, tool } = body as {
      event: string;
      path?: string;
      referrer?: string;
      tool?: string;
    };

    // Simple Postgres-backed analytics via research-project-store pattern
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 3000,
    });

    await pool.query(
      `CREATE TABLE IF NOT EXISTS wiserfiles_analytics (
        id SERIAL PRIMARY KEY,
        event TEXT NOT NULL,
        path TEXT,
        referrer TEXT,
        tool TEXT,
        user_agent TEXT,
        ip_hash TEXT,
        country TEXT,
        city TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    const ipHash = ip;

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
      `INSERT INTO wiserfiles_analytics (event, path, referrer, tool, user_agent, ip_hash, country, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event,
        path || null,
        referrer || null,
        tool || null,
        request.headers.get("user-agent") || null,
        ipHash,
        country,
        city,
      ]
    );

    await pool.end();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Analytics error:", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
