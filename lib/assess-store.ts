import { db, ensureMigrated } from "@/lib/db";
import { DEFAULT_SESSION_COUNT, DEFAULT_TEST_COUNT, DEFAULT_EXAM_COUNT } from "@/lib/groups";

export type AssessKind = "practical" | "test" | "exam";

export type AssessStudent = {
  userId: string;
  name: string;
  surname: string;
  studentId: string;
  programme: string;
};

export type AssessItem = {
  id: number;
  kind: AssessKind;
  title: string;
  maxMarks: number;
};

export type AssessMark = { itemId: number; studentId: string; score: number | null };

async function ensureItems(groupId: string): Promise<void> {
  await ensureMigrated();
  const g = await db.query(
    `SELECT session_count, test_count, exam_count FROM wiserfiles_groups WHERE id = $1`,
    [groupId]
  );
  const counts: Record<AssessKind, number> = {
    practical: (g.rows[0]?.session_count as number | undefined) ?? DEFAULT_SESSION_COUNT,
    test: (g.rows[0]?.test_count as number | undefined) ?? DEFAULT_TEST_COUNT,
    exam: (g.rows[0]?.exam_count as number | undefined) ?? DEFAULT_EXAM_COUNT,
  };

  const existing = await db.query(
    `SELECT id, kind FROM wiserfiles_group_sessions WHERE group_id = $1 ORDER BY kind ASC, sort_order ASC, id ASC`,
    [groupId]
  );

  for (const kind of ["practical", "test", "exam"] as AssessKind[]) {
    const target = counts[kind];
    const items = existing.rows.filter((x) => x.kind === kind);

    // Add missing items.
    for (let i = items.length + 1; i <= target; i++) {
      await db.query(
        `INSERT INTO wiserfiles_group_sessions (group_id, kind, title, max_marks, sort_order)
         VALUES ($1, $2, $3, 10, $4)`,
        [groupId, kind, `${kind === "practical" ? "Practical" : kind === "test" ? "Test" : "Exam"} ${i}`, i]
      );
    }

    // Remove items beyond the configured count (marks cascade on delete).
    if (items.length > target) {
      for (const s of items.slice(target)) {
        await db.query(`DELETE FROM wiserfiles_group_sessions WHERE id = $1`, [s.id]);
      }
    }
  }
}

export async function getAssessment(groupId: string) {
  await ensureItems(groupId);

  const members = await db.query(
    `SELECT user_id, name, surname, student_id, programme
     FROM wiserfiles_group_members
     WHERE group_id = $1
     ORDER BY joined_at ASC`,
    [groupId]
  );
  const items = await db.query(
    `SELECT id, kind, title, max_marks
     FROM wiserfiles_group_sessions
     WHERE group_id = $1
     ORDER BY kind ASC, sort_order ASC, id ASC`,
    [groupId]
  );
  const marks = await db.query(
    `SELECT m.session_id, m.student_id, m.score
     FROM wiserfiles_assessment_marks m
     JOIN wiserfiles_group_sessions s ON s.id = m.session_id
     WHERE s.group_id = $1`,
    [groupId]
  );

  const itemRows = items.rows.map((x) => ({
    id: x.id as number,
    kind: x.kind as AssessKind,
    title: x.title as string,
    maxMarks: x.max_marks as number,
  })) as AssessItem[];

  return {
    students: members.rows.map((x) => ({
      userId: x.user_id as string,
      name: x.name as string,
      surname: x.surname as string,
      studentId: x.student_id as string,
      programme: x.programme as string,
    })) as AssessStudent[],
    practicals: itemRows.filter((i) => i.kind === "practical"),
    tests: itemRows.filter((i) => i.kind === "test"),
    exams: itemRows.filter((i) => i.kind === "exam"),
    marks: marks.rows.map((x) => ({
      itemId: x.session_id as number,
      studentId: x.student_id as string,
      score: x.score == null ? null : Number(x.score),
    })) as AssessMark[],
  };
}

export async function saveAssessment(
  groupId: string,
  marks: AssessMark[]
): Promise<void> {
  await ensureMigrated();
  for (const m of marks) {
    if (m.score == null || Number.isNaN(m.score)) {
      await db.query(
        `DELETE FROM wiserfiles_assessment_marks WHERE session_id = $1 AND student_id = $2`,
        [m.itemId, m.studentId]
      );
    } else {
      await db.query(
        `INSERT INTO wiserfiles_assessment_marks (session_id, student_id, score)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, student_id) DO UPDATE SET score = $3`,
        [m.itemId, m.studentId, m.score]
      );
    }
  }
}

export type RosterColumn = {
  kind: "practical" | "test" | "exam";
  order: number;
  title: string;
  maxMarks: number;
};

export type RosterMarkRow = {
  group: string;
  userId: string;
  name: string;
  surname: string;
  programme: string;
  studentId: string;
  /** Raw scores, aligned with the columns array. */
  scores: (number | null)[];
};

/** Roster of group members with raw per-item marks (Practical 1, 2, …, Test 1, …). */
export async function getRosterWithMarks(
  groupId: string | null
): Promise<{ columns: RosterColumn[]; rows: RosterMarkRow[] }> {
  await ensureMigrated();
  const where = groupId ? "WHERE group_id = $1" : "";
  const params = groupId ? [groupId] : [];

  const members = await db.query(
    `SELECT m.user_id, m.name, m.surname, m.programme, m.student_id, m.group_id, g.name AS group_name
     FROM wiserfiles_group_members m
     JOIN wiserfiles_groups g ON g.id = m.group_id
     ${where}
     ORDER BY g.sort_order ASC, LOWER(m.surname) ASC, LOWER(m.name) ASC`,
    params
  );

  // Distinct assessment columns across the selected groups, in practical,
  // test, exam order, then by position.
  const cols = await db.query(
    `SELECT kind, sort_order, MAX(title) AS title, MAX(max_marks) AS max_marks
     FROM wiserfiles_group_sessions
     ${groupId ? "WHERE group_id = $1" : ""}
     GROUP BY kind, sort_order
     ORDER BY CASE kind WHEN 'practical' THEN 0 WHEN 'test' THEN 1 ELSE 2 END ASC, sort_order ASC`,
    params
  );
  const columns: RosterColumn[] = cols.rows.map((x) => ({
    kind: x.kind as RosterColumn["kind"],
    order: x.sort_order as number,
    title: x.title as string,
    maxMarks: x.max_marks as number,
  }));

  // Sessions keyed by group + kind + sort_order so each student's raw score
  // maps to their own group's item of the same position.
  const sessions = await db.query(
    `SELECT group_id, kind, sort_order, id FROM wiserfiles_group_sessions`
  );
  const sessionByKey = new Map<string, number>();
  for (const x of sessions.rows) {
    sessionByKey.set(`${x.group_id}:${x.kind}:${x.sort_order}`, x.id as number);
  }

  const marks = await db.query(
    `SELECT student_id, session_id, score FROM wiserfiles_assessment_marks`
  );
  const markMap = new Map<string, number | null>();
  for (const x of marks.rows) {
    markMap.set(`${x.student_id}:${x.session_id}`, x.score == null ? null : Number(x.score));
  }

  const rows: RosterMarkRow[] = members.rows.map((m) => {
    const uid = m.user_id as string;
    const gid = m.group_id as string;
    const scores = columns.map((c) => {
      const sid = sessionByKey.get(`${gid}:${c.kind}:${c.order}`);
      if (sid == null) return null;
      return markMap.has(`${uid}:${sid}`) ? (markMap.get(`${uid}:${sid}`) as number | null) : null;
    });
    return {
      group: m.group_name as string,
      userId: uid,
      name: m.name as string,
      surname: m.surname as string,
      programme: m.programme as string,
      studentId: m.student_id as string,
      scores,
    };
  });

  return { columns, rows };
}

export type StudentScoreRow = {
  id: number;
  title: string;
  maxMarks: number;
  score: number | null;
};

/** A student's own practical + test scores (never the exam). */
export async function getStudentScores(
  groupId: string,
  userId: string
): Promise<{ practicals: StudentScoreRow[]; tests: StudentScoreRow[] }> {
  await ensureItems(groupId);

  const items = await db.query(
    `SELECT id, kind, title, max_marks
     FROM wiserfiles_group_sessions
     WHERE group_id = $1 AND kind IN ('practical', 'test')
     ORDER BY kind ASC, sort_order ASC, id ASC`,
    [groupId]
  );
  const marks = await db.query(
    `SELECT m.session_id, m.score
     FROM wiserfiles_assessment_marks m
     JOIN wiserfiles_group_sessions s ON s.id = m.session_id
     WHERE s.group_id = $1 AND m.student_id = $2`,
    [groupId, userId]
  );
  const markMap = new Map<number, number | null>(
    marks.rows.map((x) => [x.session_id as number, x.score == null ? null : Number(x.score)])
  );
  const toRow = (x: {
    id: number;
    title: string;
    max_marks: number;
  }): StudentScoreRow => ({
    id: x.id,
    title: x.title as string,
    maxMarks: x.max_marks as number,
    score: markMap.get(x.id) ?? null,
  });

  return {
    practicals: items.rows.filter((x) => x.kind === "practical").map((x) => toRow(x as { id: number; title: string; max_marks: number })),
    tests: items.rows.filter((x) => x.kind === "test").map((x) => toRow(x as { id: number; title: string; max_marks: number })),
  };
}
