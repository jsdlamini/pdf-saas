import { describe, it, expect, beforeAll } from "vitest";
import { db, MIGRATIONS } from "@/lib/db";

// ── Structural regression guards (run without a database) ────────────────
// These pin the two production regressions directly at the migration-string
// level so they are caught even in environments without a live Postgres.

describe("MIGRATIONS regression guards", () => {
  it("does not add-then-drop columns on wiserfiles_leaderboard_opt_in", () => {
    const leaderboardStatements = MIGRATIONS.filter((sql) =>
      sql.includes("wiserfiles_leaderboard_opt_in"),
    );

    for (const sql of leaderboardStatements) {
      expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS student_id/i);
      expect(sql).not.toMatch(/DROP COLUMN IF EXISTS (student_id|season_id)/i);
    }
  });

  it("does not recreate season_id on the leaderboard opt-in table", () => {
    const createTable = MIGRATIONS.find((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS wiserfiles_leaderboard_opt_in"),
    );
    expect(createTable).toBeDefined();
    expect(createTable).not.toContain("season_id");
  });

  it("removes the one-time leaderboard copy migration", () => {
    // The old copy read opt-in rows back out; nothing should reference that
    // table as a source anymore.
    expect(
      MIGRATIONS.some((sql) => sql.includes("FROM wiserfiles_leaderboard_opt_in")),
    ).toBe(false);
  });

  it("uses duplicate-safe upserts for the CSC111 enrollment seeds", () => {
    const enrollmentSeeds = MIGRATIONS.filter(
      (sql) => sql.includes("INSERT INTO wiserfiles_enrollments") && sql.includes("csc111"),
    );
    expect(enrollmentSeeds).toHaveLength(2);

    for (const sql of enrollmentSeeds) {
      expect(sql).toContain("ON CONFLICT (user_id, cohort_id) DO NOTHING");
      expect(sql).not.toContain("DO UPDATE");
    }
  });

  it("backfills assistant group-staff from course enrollments, idempotently", () => {
    const backfill = MIGRATIONS.find(
      (sql) =>
        sql.includes("INSERT INTO wiserfiles_group_staff") &&
        sql.includes("wiserfiles_enrollments"),
    );
    expect(backfill).toBeDefined();
    expect(backfill).toContain("ON CONFLICT (group_id, user_id) DO NOTHING");
    expect(backfill).toContain("e.role = 'assistant'");
    expect(backfill).toContain("g.course_id = c.course_id");
    expect(backfill).not.toContain("DO UPDATE");
  });
});

// ── Idempotency (requires a live Postgres, e.g. the CI postgres service) ──
// Skipped automatically when DATABASE_URL is not configured.

describe.runIf(process.env.DATABASE_URL)("MIGRATIONS idempotency (integration)", () => {
  // The CI Postgres service can take a moment to accept connections; retry
  // instead of failing the whole suite on a transient ECONNREFUSED.
  async function waitForDb(retries = 30, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        await db.query("SELECT 1");
        return;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  beforeAll(async () => {
    await waitForDb();
  });

  async function resetSchema() {
    await db.query("DROP SCHEMA IF EXISTS public CASCADE");
    await db.query("CREATE SCHEMA public");
  }

  async function runAllMigrations() {
    for (const sql of MIGRATIONS) {
      await db.query(sql);
    }
  }

  it("completes cleanly on a fresh database and again on a second run", { timeout: 60_000 }, async () => {
    await resetSchema();

    // First run: create everything from scratch.
    await runAllMigrations();
    // Second run: every statement must be a no-op-safe re-run.
    await runAllMigrations();

    // The old add-then-drop cycle leaked one dropped column per run; a re-run
    // must not change the column count of the opt-in table.
    const before = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'wiserfiles_leaderboard_opt_in'`,
    );

    await runAllMigrations();

    const after = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'wiserfiles_leaderboard_opt_in'`,
    );

    expect(before.rows[0].n).toBe(after.rows[0].n);
    expect(after.rows[0].n).toBeLessThan(10);
  });

  it("re-runs the CSC111 seed when group members share a student id", { timeout: 60_000 }, async () => {
    await resetSchema();
    await runAllMigrations();

    const cohort = await db.query(
      `SELECT id FROM wiserfiles_cohorts WHERE slug = 'csc111'`,
    );
    const cohortId = cohort.rows[0].id;

    // A pre-existing enrollment keyed by student id. Two group members with
    // the same student id will both COALESCE-resolve to this single
    // (user_id, cohort_id), which used to raise "ON CONFLICT DO UPDATE command
    // cannot affect row a second time" (code 21000).
    await db.query(
      `INSERT INTO wiserfiles_enrollments (user_id, cohort_id, role, status, student_id)
       VALUES ('existing-user', $1, 'student', 'active', 'S123')`,
      [cohortId],
    );

    await db.query(
      `INSERT INTO wiserfiles_group_members (user_id, group_id, student_id)
       VALUES ('gm-user-1', 'g1', 'S123'), ('gm-user-2', 'g1', 'S123')`,
    );

    // Must not throw; duplicate conflict keys are skipped via DO NOTHING.
    await runAllMigrations();
  });

  it("assigns a seeded assistant to every group in their course", { timeout: 60_000 }, async () => {
    await resetSchema();
    await runAllMigrations();

    // Add an assistant role, then re-run migrations so the CSC111 seed enrols
    // them as a course assistant (the pre-Phase-3 path that left them without
    // any wiserfiles_group_staff rows).
    await db.query(
      `INSERT INTO wiserfiles_user_roles (user_id, email, role)
       VALUES ('assistant-1', 'assistant@example.com', 'assistant')`,
    );
    await runAllMigrations();

    const course = await db.query(
      `SELECT id FROM wiserfiles_courses WHERE code = 'CSC111' AND institution = 'UNESWA' LIMIT 1`,
    );
    const courseId = course.rows[0].id;

    // Groups are seeded at runtime (ensureGroupsSeeded), not in MIGRATIONS,
    // so create two groups for the course and re-run migrations to apply the
    // assistant→group-staff backfill.
    await db.query(
      `INSERT INTO wiserfiles_groups (id, name, schedule, capacity, session_count, test_count, exam_count, sort_order, course_id)
       VALUES ('g-a', 'Group A', '', 50, 4, 1, 1, 0, $1),
              ('g-b', 'Group B', '', 50, 4, 1, 1, 1, $1)`,
      [courseId],
    );
    await runAllMigrations();

    const staff = await db.query(
      `SELECT group_id, role FROM wiserfiles_group_staff WHERE user_id = 'assistant-1' ORDER BY group_id`,
    );
    expect(staff.rows.map((r) => r.group_id)).toEqual(["g-a", "g-b"]);
    expect(staff.rows.every((r) => r.role === "assistant")).toBe(true);
  });
});
