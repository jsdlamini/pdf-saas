// Single shared PostgreSQL pool + one-time schema migration.
//
// Previously each route constructed `new Pool({ max: 1 })` per request, ran
// CREATE TABLE IF NOT EXISTS, and called pool.end() — a fresh TCP connection
// and a DDL round-trip on every request, with several error paths leaking the
// pool. One shared pool and a lazy, idempotent migration removes all of that.

import { Pool } from "pg";

// NOTE: do not throw at import time. `next build` imports every route that
// imports this module, and the builder stage has no DATABASE_URL — a top-level
// throw breaks the build. Fail loudly in ensureMigrated() instead.
const connectionString = process.env.DATABASE_URL;

export const db = new Pool({
  connectionString: connectionString || "postgresql://localhost:5432/__missing__",
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
  `ALTER TABLE wiserfiles_user_secrets ADD COLUMN IF NOT EXISTS github_installation_id TEXT`,

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

  `CREATE TABLE IF NOT EXISTS wiserfiles_seasons (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_cohorts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT UNIQUE NOT NULL,
    season_id INTEGER REFERENCES wiserfiles_seasons(id) ON DELETE SET NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_challenges (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    language TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'easy',
    statement_md TEXT NOT NULL,
    starter_code TEXT NOT NULL DEFAULT '',
    hidden_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
    time_limit_ms INTEGER NOT NULL DEFAULT 15000,
    points INTEGER NOT NULL DEFAULT 10,
    season_id INTEGER REFERENCES wiserfiles_seasons(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE wiserfiles_challenges ADD COLUMN IF NOT EXISTS test_mode TEXT NOT NULL DEFAULT 'io'`,
  `ALTER TABLE wiserfiles_challenges ADD COLUMN IF NOT EXISTS sample_input TEXT NOT NULL DEFAULT ''`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_submissions (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    challenge_id INTEGER NOT NULL REFERENCES wiserfiles_challenges(id) ON DELETE CASCADE,
    cohort_id INTEGER REFERENCES wiserfiles_cohorts(id) ON DELETE SET NULL,
    season_id INTEGER REFERENCES wiserfiles_seasons(id) ON DELETE SET NULL,
    language TEXT NOT NULL,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    tests_passed INTEGER NOT NULL DEFAULT 0,
    tests_total INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    output TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_challenge_solves (
    user_id TEXT NOT NULL,
    challenge_id INTEGER NOT NULL REFERENCES wiserfiles_challenges(id) ON DELETE CASCADE,
    cohort_id INTEGER NOT NULL REFERENCES wiserfiles_cohorts(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES wiserfiles_seasons(id) ON DELETE SET NULL,
    points INTEGER NOT NULL DEFAULT 0,
    solved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, challenge_id, cohort_id)
  )`,

  `CREATE TABLE IF NOT EXISTS wiserfiles_leaderboard_opt_in (
    user_id TEXT NOT NULL,
    cohort_id INTEGER NOT NULL REFERENCES wiserfiles_cohorts(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES wiserfiles_seasons(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    opted_in BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, cohort_id)
  )`,
  `ALTER TABLE wiserfiles_leaderboard_opt_in ADD COLUMN IF NOT EXISTS student_id TEXT`,

  // ── Courses + enrollment split ───────────────────────────────────
  // A course is a subject (persists across years); a cohort is course ×
  // season × section; enrollment is the membership record (role + status +
  // student_id). Leaderboard consent is a separate, shrinkable record.
  `CREATE TABLE IF NOT EXISTS wiserfiles_courses (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, institution)
  )`,
  `ALTER TABLE wiserfiles_cohorts ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES wiserfiles_courses(id) ON DELETE SET NULL`,
  `ALTER TABLE wiserfiles_cohorts ADD COLUMN IF NOT EXISTS join_code_expires_at TIMESTAMPTZ`,
  `ALTER TABLE wiserfiles_cohorts ADD COLUMN IF NOT EXISTS join_code_max_uses INTEGER`,
  `ALTER TABLE wiserfiles_cohorts ADD COLUMN IF NOT EXISTS join_code_uses INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS wiserfiles_enrollments (
    user_id TEXT NOT NULL,
    cohort_id INTEGER NOT NULL REFERENCES wiserfiles_cohorts(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'student',
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    student_id TEXT,
    PRIMARY KEY (user_id, cohort_id)
  )`,
  // One-time migration: carry existing opt-in rows (which doubled as
  // enrollment) into enrollments. Guarded so a second run after the column is
  // dropped is a no-op.
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wiserfiles_leaderboard_opt_in' AND column_name = 'student_id') THEN
      INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status, joined_at, student_id)
      SELECT user_id, cohort_id, 'student', 'active', NOW(), student_id
      FROM wiserfiles_leaderboard_opt_in
      ON CONFLICT (user_id, cohort_id) DO NOTHING;
    END IF;
  END $$;`,
  `ALTER TABLE wiserfiles_leaderboard_opt_in DROP COLUMN IF EXISTS student_id`,
  `ALTER TABLE wiserfiles_leaderboard_opt_in DROP COLUMN IF EXISTS season_id`,
];

let migrationPromise: Promise<void> | null = null;

export function ensureMigrated(): Promise<void> {
  if (!connectionString) {
    return Promise.reject(new Error("DATABASE_URL is not configured."));
  }
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
