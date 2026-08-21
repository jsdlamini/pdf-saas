// Single shared PostgreSQL pool + one-time schema migration.
//
// Previously each route constructed `new Pool({ max: 1 })` per request, ran
// CREATE TABLE IF NOT EXISTS, and called pool.end() — a fresh TCP connection
// and a DDL round-trip on every request, with several error paths leaking the
// pool. One shared pool and a lazy, idempotent migration removes all of that.

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Routes that touch the DB fail loudly rather than half-working without one.
  throw new Error("DATABASE_URL is not configured.");
}

export const db = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS wiserfiles_research_projects (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    entries JSONB NOT NULL,
    selected_path TEXT NOT NULL,
    last_compile_at TEXT NOT NULL DEFAULT 'Not compiled yet',
    revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS wiserfiles_research_projects_user_updated_idx
   ON wiserfiles_research_projects (user_id, updated_at DESC)`,
  `ALTER TABLE wiserfiles_research_projects
   ADD COLUMN IF NOT EXISTS revisions JSONB NOT NULL DEFAULT '[]'::jsonb`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_collab_docs (
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, file_path)
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_collab_presence (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#4ade80',
    cursor_pos INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, project_id)
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_shared_projects (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_user_secrets (
    user_id TEXT PRIMARY KEY,
    github_token TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

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
  )`,
  `ALTER TABLE wiserfiles_analytics ADD COLUMN IF NOT EXISTS country TEXT`,
  `ALTER TABLE wiserfiles_analytics ADD COLUMN IF NOT EXISTS city TEXT`,
  `ALTER TABLE wiserfiles_analytics ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE wiserfiles_analytics ADD COLUMN IF NOT EXISTS detail TEXT`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_user_roles (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_ai_usage (
    user_key TEXT PRIMARY KEY,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS wiserfiles_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_project_invites (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL DEFAULT '',
    invited_by TEXT NOT NULL,
    shared_with_email TEXT NOT NULL,
    access_level TEXT NOT NULL DEFAULT 'read',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

let migrationPromise: Promise<void> | null = null;

export function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      for (const sql of MIGRATIONS) {
        await db.query(sql);
      }
    })().catch((error) => {
      migrationPromise = null; // allow a retry on the next request
      throw error;
    });
  }
  return migrationPromise;
}
