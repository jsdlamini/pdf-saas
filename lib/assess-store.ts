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
