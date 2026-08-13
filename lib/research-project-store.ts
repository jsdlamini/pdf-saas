import { Pool } from "pg";

type ProjectEntry = {
  path: string;
  kind: "file" | "folder";
  content: string;
};

export type StoredRevision = {
  entries: ProjectEntry[];
  selectedPath: string;
  updatedAt: string;
};

export type StoredResearchProject = {
  id: string;
  name: string;
  entries: ProjectEntry[];
  selectedPath: string;
  lastCompileAt: string;
  updatedAt: string;
  revisions?: StoredRevision[];
};

const MAX_REVISIONS = 20;

declare global {
  var __wiserfilesPgPool: Pool | undefined;
  var __wiserfilesResearchSchemaReady: Promise<void> | undefined;
}

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!global.__wiserfilesPgPool) {
    global.__wiserfilesPgPool = new Pool({ connectionString });
  }

  return global.__wiserfilesPgPool;
}

async function ensureSchema() {
  if (!global.__wiserfilesResearchSchemaReady) {
    const pool = getPool();
    global.__wiserfilesResearchSchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS wiserfiles_research_projects (
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
        );

        CREATE INDEX IF NOT EXISTS wiserfiles_research_projects_user_updated_idx
        ON wiserfiles_research_projects (user_id, updated_at DESC);

        ALTER TABLE wiserfiles_research_projects
        ADD COLUMN IF NOT EXISTS revisions JSONB NOT NULL DEFAULT '[]'::jsonb;
      `)
      .then(() => undefined);
  }

  await global.__wiserfilesResearchSchemaReady;
}

function isProjectEntry(value: unknown): value is ProjectEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectEntry>;
  return (
    typeof candidate.path === "string" &&
    (candidate.kind === "file" || candidate.kind === "folder") &&
    typeof candidate.content === "string"
  );
}

function isRevision(value: unknown): value is StoredRevision {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredRevision>;
  return (
    Array.isArray(candidate.entries) &&
    typeof candidate.selectedPath === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function parseStoredResearchProject(value: unknown): StoredResearchProject | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<StoredResearchProject>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.entries) ||
    typeof candidate.selectedPath !== "string" ||
    typeof candidate.lastCompileAt !== "string"
  ) {
    return null;
  }

  const entries = candidate.entries.filter(isProjectEntry);
  if (!entries.length) return null;

  const revisions = Array.isArray(candidate.revisions)
    ? candidate.revisions.filter(isRevision).slice(0, MAX_REVISIONS)
    : [];

  return {
    id: candidate.id,
    name: candidate.name.trim() || "Untitled Project",
    entries,
    selectedPath: candidate.selectedPath || "main.tex",
    lastCompileAt: candidate.lastCompileAt || "Not compiled yet",
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim()
        ? candidate.updatedAt
        : new Date().toISOString(),
    revisions,
  };
}

function mapRow(row: {
  id: string;
  name: string;
  entries: unknown;
  selected_path: string;
  last_compile_at: string;
  updated_at: Date | string;
  revisions?: unknown;
}): StoredResearchProject {
  return {
    id: row.id,
    name: row.name,
    entries: Array.isArray(row.entries) ? row.entries.filter(isProjectEntry) : [],
    selectedPath: row.selected_path,
    lastCompileAt: row.last_compile_at,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    revisions: Array.isArray(row.revisions)
      ? row.revisions.filter(isRevision).slice(0, MAX_REVISIONS)
      : [],
  };
}

export async function listResearchProjectsForUser(userId: string) {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT id, name, entries, selected_path, last_compile_at, updated_at, revisions
      FROM wiserfiles_research_projects
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    [userId]
  );

  return result.rows.map(mapRow);
}

export async function upsertResearchProjectForUser(userId: string, project: StoredResearchProject) {
  await ensureSchema();
  const pool = getPool();
  const normalized = parseStoredResearchProject(project);
  if (!normalized) {
    throw new Error("Invalid project payload.");
  }

  // Fetch the existing row so we can record its current state as a revision.
  const existing = await pool.query(
    `
      SELECT entries, selected_path, updated_at, revisions
      FROM wiserfiles_research_projects
      WHERE user_id = $1 AND id = $2
    `,
    [userId, normalized.id]
  );

  let revisions = normalized.revisions ?? [];

  if (existing.rows.length > 0) {
    const prev = existing.rows[0] as {
      entries: unknown;
      selected_path: string;
      updated_at: Date | string;
      revisions: unknown;
    };
    const prevRevision: StoredRevision = {
      entries: Array.isArray(prev.entries) ? prev.entries.filter(isProjectEntry) : [],
      selectedPath: prev.selected_path || "main.tex",
      updatedAt:
        prev.updated_at instanceof Date ? prev.updated_at.toISOString() : new Date(prev.updated_at).toISOString(),
    };
    // Only record a revision if content actually differs
    const prevJson = JSON.stringify(prevRevision.entries);
    const nextJson = JSON.stringify(normalized.entries);
    if (prevJson !== nextJson && prevRevision.entries.length) {
      revisions = [prevRevision, ...revisions].slice(0, MAX_REVISIONS);
    }
  }

  const result = await pool.query(
    `
      INSERT INTO wiserfiles_research_projects (
        user_id,
        id,
        name,
        entries,
        selected_path,
        last_compile_at,
        revisions,
        updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::timestamptz)
      ON CONFLICT (user_id, id)
      DO UPDATE SET
        name = EXCLUDED.name,
        entries = EXCLUDED.entries,
        selected_path = EXCLUDED.selected_path,
        last_compile_at = EXCLUDED.last_compile_at,
        revisions = EXCLUDED.revisions,
        updated_at = EXCLUDED.updated_at
      RETURNING id, name, entries, selected_path, last_compile_at, updated_at, revisions
    `,
    [
      userId,
      normalized.id,
      normalized.name,
      JSON.stringify(normalized.entries),
      normalized.selectedPath,
      normalized.lastCompileAt,
      JSON.stringify(revisions),
      normalized.updatedAt,
    ]
  );

  return mapRow(result.rows[0]);
}

export async function deleteResearchProjectForUser(userId: string, projectId: string) {
  await ensureSchema();
  const pool = getPool();
  await pool.query(
    `
      DELETE FROM wiserfiles_research_projects
      WHERE user_id = $1 AND id = $2
    `,
    [userId, projectId]
  );
}
