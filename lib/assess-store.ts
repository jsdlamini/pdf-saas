import { db, ensureMigrated } from "@/lib/db";
import { DEFAULT_SESSION_COUNT } from "@/lib/groups";

export type AssessStudent = {
  userId: string;
  name: string;
  surname: string;
  studentId: string;
};

export type AssessSession = {
  id: number;
  title: string;
  maxMarks: number;
};

export type AssessMark = { sessionId: number; studentId: string; score: number | null };
export type AssessTest = { studentId: string; score: number | null };

async function ensureSessions(groupId: string): Promise<void> {
  await ensureMigrated();
  const g = await db.query(`SELECT session_count FROM wiserfiles_groups WHERE id = $1`, [groupId]);
  const target = (g.rows[0]?.session_count as number | undefined) ?? DEFAULT_SESSION_COUNT;

  const existing = await db.query(
    `SELECT id FROM wiserfiles_group_sessions WHERE group_id = $1 ORDER BY sort_order ASC, id ASC`,
    [groupId]
  );
  const count = existing.rows.length;

  // Add missing sessions.
  for (let i = count + 1; i <= target; i++) {
    await db.query(
      `INSERT INTO wiserfiles_group_sessions (group_id, title, max_marks, sort_order)
       VALUES ($1, $2, 10, $3)`,
      [groupId, `Practical ${i}`, i]
    );
  }

  // Remove sessions beyond the configured count (marks cascade on delete).
  if (count > target) {
    for (const s of existing.rows.slice(target)) {
      await db.query(`DELETE FROM wiserfiles_group_sessions WHERE id = $1`, [s.id]);
    }
  }
}

export async function getAssessment(groupId: string) {
  await ensureSessions(groupId);

  const members = await db.query(
    `SELECT user_id, name, surname, student_id
     FROM wiserfiles_group_members
     WHERE group_id = $1
     ORDER BY joined_at ASC`,
    [groupId]
  );
  const sessions = await db.query(
    `SELECT id, title, max_marks
     FROM wiserfiles_group_sessions
     WHERE group_id = $1
     ORDER BY sort_order ASC, id ASC`,
    [groupId]
  );
  const marks = await db.query(
    `SELECT m.session_id, m.student_id, m.score
     FROM wiserfiles_assessment_marks m
     JOIN wiserfiles_group_sessions s ON s.id = m.session_id
     WHERE s.group_id = $1`,
    [groupId]
  );
  const tests = await db.query(
    `SELECT student_id, score FROM wiserfiles_assessment_tests WHERE group_id = $1`,
    [groupId]
  );

  return {
    students: members.rows.map((x) => ({
      userId: x.user_id as string,
      name: x.name as string,
      surname: x.surname as string,
      studentId: x.student_id as string,
    })) as AssessStudent[],
    sessions: sessions.rows.map((x) => ({
      id: x.id as number,
      title: x.title as string,
      maxMarks: x.max_marks as number,
    })) as AssessSession[],
    marks: marks.rows.map((x) => ({
      sessionId: x.session_id as number,
      studentId: x.student_id as string,
      score: x.score == null ? null : Number(x.score),
    })) as AssessMark[],
    tests: tests.rows.map((x) => ({
      studentId: x.student_id as string,
      score: x.score == null ? null : Number(x.score),
    })) as AssessTest[],
  };
}

export async function saveAssessment(
  groupId: string,
  marks: AssessMark[],
  tests: AssessTest[]
): Promise<void> {
  await ensureMigrated();
  for (const m of marks) {
    if (m.score == null || Number.isNaN(m.score)) continue;
    await db.query(
      `INSERT INTO wiserfiles_assessment_marks (session_id, student_id, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, student_id) DO UPDATE SET score = $3`,
      [m.sessionId, m.studentId, m.score]
    );
  }
  for (const t of tests) {
    if (t.score == null || Number.isNaN(t.score)) continue;
    await db.query(
      `INSERT INTO wiserfiles_assessment_tests (group_id, student_id, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, student_id) DO UPDATE SET score = $3`,
      [groupId, t.studentId, t.score]
    );
  }
}
