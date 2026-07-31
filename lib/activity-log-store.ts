import { Pool } from "pg";

export type ActivityLogEntry = {
  id: string;
  toolSlug: string;
  toolName?: string;
  fileName?: string;
  fileSize?: number;
  durationMs?: number;
  success: boolean;
  createdAt: string;
};

declare global {
  var __wiserfilesActivityLogMem: ActivityLogEntry[] | undefined;
  var __wiserfilesActivitySchemaReady: Promise<void> | undefined;
}

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!global.__wiserfilesPgPool) {
    global.__wiserfilesPgPool = new Pool({ connectionString });
  }
  return global.__wiserfilesPgPool;
}

async function ensureActivitySchema() {
  const pool = getPool();
  if (!pool) return;

  if (!global.__wiserfilesActivitySchemaReady) {
    global.__wiserfilesActivitySchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS wiserfiles_activity_log (
          id TEXT PRIMARY KEY,
          tool_slug TEXT NOT NULL,
          tool_name TEXT,
          file_name TEXT,
          file_size BIGINT,
          duration_ms INTEGER,
          success BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS wiserfiles_activity_log_created_idx
        ON wiserfiles_activity_log (created_at DESC);
      `)
      .then(() => undefined);
  }

  await global.__wiserfilesActivitySchemaReady;
}

function inMemoryStore(): ActivityLogEntry[] {
  if (!global.__wiserfilesActivityLogMem) {
    global.__wiserfilesActivityLogMem = [];
  }
  return global.__wiserfilesActivityLogMem;
}

export async function recordActivity(entry: Omit<ActivityLogEntry, "id" | "createdAt">) {
  const id = `${entry.toolSlug}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  const record: ActivityLogEntry = { ...entry, id, createdAt };

  const pool = getPool();
  if (pool) {
    try {
      await ensureActivitySchema();
      await pool.query(
        `INSERT INTO wiserfiles_activity_log (id, tool_slug, tool_name, file_name, file_size, duration_ms, success, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          record.id,
          record.toolSlug,
          record.toolName ?? null,
          record.fileName ?? null,
          record.fileSize ?? null,
          record.durationMs ?? null,
          record.success,
          record.createdAt,
        ]
      );
      return record;
    } catch {
      // Fall through to in-memory path
    }
  }

  const store = inMemoryStore();
  store.unshift(record);
  // Keep only last 200 entries in memory
  if (store.length > 200) store.length = 200;
  return record;
}

export async function listRecentActivity(limit = 20): Promise<ActivityLogEntry[]> {
  const pool = getPool();
  if (pool) {
    try {
      await ensureActivitySchema();
      const result = await pool.query(
        `SELECT id, tool_slug AS "toolSlug", tool_name AS "toolName",
                file_name AS "fileName", file_size AS "fileSize",
                duration_ms AS "durationMs", success, created_at AS "createdAt"
         FROM wiserfiles_activity_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows as ActivityLogEntry[];
    } catch {
      // Fall through to in-memory path
    }
  }

  return inMemoryStore().slice(0, limit);
}
