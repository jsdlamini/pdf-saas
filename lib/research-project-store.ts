import { Pool } from "pg";

type ProjectEntry = {
  path: string;
  kind: "file" | "folder";
  content: string;
};

export type StoredResearchProject = {
  id: string;
  name: string;
  entries: ProjectEntry[];
  selectedPath: string;
  lastCompileAt: string;
  updatedAt: string;
};

declare global {
  var __papertrailPgPool: Pool | undefined;
  var __papertrailResearchSchemaReady: Promise<void> | undefined;
}

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!global.__papertrailPgPool) {
    global.__papertrailPgPool = new Pool({ connectionString });
  }

  return global.__papertrailPgPool;
}

async function ensureSchema() {
  if (!global.__papertrailResearchSchemaReady) {
    const pool = getPool();
    global.__papertrailResearchSchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS papertrail_research_projects (
          user_id TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          entries JSONB NOT NULL,
          selected_path TEXT NOT NULL,
          last_compile_at TEXT NOT NULL DEFAULT 'Not compiled yet',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, id)
        );

        CREATE INDEX IF NOT EXISTS papertrail_research_projects_user_updated_idx
        ON papertrail_research_projects (user_id, updated_at DESC);
      `)
      .then(() => undefined);
  }

  await global.__papertrailResearchSchemaReady;
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
  };
}

function mapRow(row: {
  id: string;
  name: string;
  entries: unknown;
  selected_path: string;
  last_compile_at: string;
  updated_at: Date | string;
}): StoredResearchProject {
  return {
    id: row.id,
    name: row.name,
    entries: Array.isArray(row.entries) ? row.entries.filter(isProjectEntry) : [],
    selectedPath: row.selected_path,
    lastCompileAt: row.last_compile_at,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

export async function listResearchProjectsForUser(userId: string) {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT id, name, entries, selected_path, last_compile_at, updated_at
      FROM papertrail_research_projects
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

  const result = await pool.query(
    `
      INSERT INTO papertrail_research_projects (
        user_id,
        id,
        name,
        entries,
        selected_path,
        last_compile_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)
      ON CONFLICT (user_id, id)
      DO UPDATE SET
        name = EXCLUDED.name,
        entries = EXCLUDED.entries,
        selected_path = EXCLUDED.selected_path,
        last_compile_at = EXCLUDED.last_compile_at,
        updated_at = EXCLUDED.updated_at
      RETURNING id, name, entries, selected_path, last_compile_at, updated_at
    `,
    [
      userId,
      normalized.id,
      normalized.name,
      JSON.stringify(normalized.entries),
      normalized.selectedPath,
      normalized.lastCompileAt,
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
      DELETE FROM papertrail_research_projects
      WHERE user_id = $1 AND id = $2
    `,
    [userId, projectId]
  );
}