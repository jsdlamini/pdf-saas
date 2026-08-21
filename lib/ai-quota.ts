import { Pool } from "pg";

export type AiQuotaLimits = {
  guestDailyLimit: number;
  registeredDailyLimit: number;
};

const DEFAULTS: AiQuotaLimits = {
  guestDailyLimit: 5,
  registeredDailyLimit: 50,
};

async function ensureSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_ai_usage (
      user_key TEXT PRIMARY KEY,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS wiserfiles_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function getAiQuotaLimits(): Promise<AiQuotaLimits> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  const res = await pool.query(
    `SELECT key, value FROM wiserfiles_settings WHERE key IN ('guest_daily_limit', 'registered_daily_limit')`
  );
  await pool.end();
  const map = new Map(res.rows.map((r) => [r.key, parseInt(r.value, 10)]));
  return {
    guestDailyLimit: Number.isFinite(map.get("guest_daily_limit")) ? map.get("guest_daily_limit")! : DEFAULTS.guestDailyLimit,
    registeredDailyLimit: Number.isFinite(map.get("registered_daily_limit")) ? map.get("registered_daily_limit")! : DEFAULTS.registeredDailyLimit,
  };
}

export async function setAiQuotaLimits(limits: Partial<AiQuotaLimits>): Promise<AiQuotaLimits> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  if (typeof limits.guestDailyLimit === "number" && limits.guestDailyLimit >= 0) {
    await pool.query(
      `INSERT INTO wiserfiles_settings (key, value) VALUES ('guest_daily_limit', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(Math.floor(limits.guestDailyLimit))]
    );
  }
  if (typeof limits.registeredDailyLimit === "number" && limits.registeredDailyLimit >= 0) {
    await pool.query(
      `INSERT INTO wiserfiles_settings (key, value) VALUES ('registered_daily_limit', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(Math.floor(limits.registeredDailyLimit))]
    );
  }
  await pool.end();
  return getAiQuotaLimits();
}

// Checks and increments the daily AI quota for a user (or guest by IP).
export async function checkAndIncrementAiQuota(
  userId: string | null,
  ip: string
): Promise<{ allowed: boolean; limit: number; used: number }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await ensureSchema(pool);
  const limits = await getAiQuotaLimits();
  const userKey = userId || `guest:${ip}`;
  const limit = userId ? limits.registeredDailyLimit : limits.guestDailyLimit;

  const res = await pool.query(`SELECT usage_date, count FROM wiserfiles_ai_usage WHERE user_key = $1`, [userKey]);
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  if (res.rows.length) {
    const d = res.rows[0].usage_date;
    const rowDate = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    count = rowDate === today ? res.rows[0].count : 0;
  }

  if (count >= limit) {
    await pool.end();
    return { allowed: false, limit, used: count };
  }

  await pool.query(
    `INSERT INTO wiserfiles_ai_usage (user_key, usage_date, count) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_key) DO UPDATE SET
       usage_date = CURRENT_DATE,
       count = CASE WHEN wiserfiles_ai_usage.usage_date = CURRENT_DATE THEN wiserfiles_ai_usage.count + 1 ELSE 1 END`,
    [userKey]
  );
  await pool.end();
  return { allowed: true, limit, used: count + 1 };
}
