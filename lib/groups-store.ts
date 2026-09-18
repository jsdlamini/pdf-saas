import { db, ensureMigrated } from "@/lib/db";
import { STUDY_GROUPS, isValidProgramme, isValidStudentId } from "@/lib/groups";

export type GroupView = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
  sessionCount: number;
  testCount: number;
  examCount: number;
  members: number;
  joined: boolean;
};

export type GroupMember = {
  name: string;
  surname: string;
  programme: string;
  studentId: string;
  joinedAt: string;
};

export type JoinDetails = {
  name: string;
  surname: string;
  programme: string;
  studentId: string;
};

async function ensureGroupsSeeded(): Promise<void> {
  await ensureMigrated();
  for (let i = 0; i < STUDY_GROUPS.length; i++) {
    const g = STUDY_GROUPS[i];
    await db.query(
      `INSERT INTO wiserfiles_groups (id, name, schedule, capacity, session_count, test_count, exam_count, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name, g.schedule, g.capacity, g.sessionCount, g.testCount, g.examCount, i]
    );
  }
}

export async function listGroups(userId: string | null): Promise<GroupView[]> {
  await ensureGroupsSeeded();
  const groups = await db.query(
    `SELECT id, name, schedule, capacity, session_count, test_count, exam_count FROM wiserfiles_groups ORDER BY sort_order ASC, id ASC`
  );
  const counts = await db.query(
    `SELECT group_id, COUNT(*)::int AS n FROM wiserfiles_group_members GROUP BY group_id`
  );
  const countMap = new Map<string, number>(counts.rows.map((r) => [r.group_id, r.n]));

  let mine = new Set<string>();
  if (userId) {
    const r = await db.query(`SELECT group_id FROM wiserfiles_group_members WHERE user_id = $1`, [userId]);
    mine = new Set(r.rows.map((x) => x.group_id));
  }

  return groups.rows.map((g) => ({
    id: g.id as string,
    name: g.name as string,
    schedule: g.schedule as string,
    capacity: g.capacity as number,
    sessionCount: g.session_count as number,
    testCount: g.test_count as number,
    examCount: g.exam_count as number,
    members: countMap.get(g.id) ?? 0,
    joined: mine.has(g.id),
  }));
}

export async function joinGroup(
  userId: string,
  groupId: string,
  details: JoinDetails
): Promise<{ ok: boolean; error?: string; members?: number }> {
  await ensureGroupsSeeded();
  const group = await db.query(`SELECT id, capacity FROM wiserfiles_groups WHERE id = $1`, [groupId]);
  if (group.rows.length === 0) return { ok: false, error: "Unknown group." };
  const capacity = group.rows[0].capacity as number;

  const name = details.name.trim();
  const surname = details.surname.trim();
  const programme = details.programme.trim();
  const studentId = details.studentId.trim();
  if (!name || !surname) return { ok: false, error: "Name and surname are required." };
  if (!isValidProgramme(programme)) return { ok: false, error: "Choose a valid programme." };
  if (!isValidStudentId(studentId)) return { ok: false, error: "Student ID must be 6 or 9 digits." };

  const existing = await db.query(
    `SELECT 1 FROM wiserfiles_group_members WHERE user_id = $1 AND group_id = $2`,
    [userId, groupId]
  );
  if (existing.rows.length > 0) {
    return { ok: true, members: await countMembers(groupId) };
  }

  // A student may hold membership in at most one practical group; moving to
  // another must go through the switch flow (which migrates marks + logs).
  const other = await db.query(
    `SELECT group_id FROM wiserfiles_group_members WHERE user_id = $1 AND group_id <> $2 LIMIT 1`,
    [userId, groupId]
  );
  if (other.rows.length > 0) {
    return { ok: false, error: "You are already in another group — switch instead." };
  }

  const n = await countMembers(groupId);
  if (n >= capacity) return { ok: false, error: "This group is full." };

  await db.query(
    `INSERT INTO wiserfiles_group_members (user_id, group_id, name, surname, programme, student_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, group_id) DO UPDATE SET name = $3, surname = $4, programme = $5, student_id = $6`,
    [userId, groupId, name, surname, programme, studentId]
  );
  return { ok: true, members: await countMembers(groupId) };
}

// Copy a student's marks from one group to the corresponding sessions of
// another (matched by kind + sort_order), creating missing target sessions as
// needed. Called on a group switch so no earned marks are lost.
async function migrateMarksBetweenGroups(userId: string, fromGroupId: string, toGroupId: string): Promise<void> {
  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_group_sessions (group_id, kind, title, max_marks, sort_order)
     SELECT $2, f.kind, f.title, f.max_marks, f.sort_order
     FROM wiserfiles_group_sessions f
     WHERE f.group_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM wiserfiles_group_sessions t
         WHERE t.group_id = $2 AND t.kind = f.kind AND t.sort_order = f.sort_order
       )`,
    [fromGroupId, toGroupId]
  );
  await db.query(
    `INSERT INTO wiserfiles_assessment_marks (session_id, student_id, score)
     SELECT t.id, m.student_id, m.score
     FROM wiserfiles_assessment_marks m
     JOIN wiserfiles_group_sessions f ON f.id = m.session_id
     JOIN wiserfiles_group_sessions t ON t.group_id = $3 AND t.kind = f.kind AND t.sort_order = f.sort_order
     WHERE f.group_id = $1 AND m.student_id = $2
     ON CONFLICT (session_id, student_id) DO UPDATE SET score = EXCLUDED.score`,
    [fromGroupId, userId, toGroupId]
  );
}

export async function switchGroup(
  userId: string,
  fromGroupId: string,
  toGroupId: string
): Promise<{ ok: boolean; error?: string }> {
  await ensureGroupsSeeded();
  if (fromGroupId === toGroupId) return { ok: false, error: "You are already in that group." };

  const from = await db.query(
    `SELECT name, surname, programme, student_id FROM wiserfiles_group_members
     WHERE user_id = $1 AND group_id = $2`,
    [userId, fromGroupId]
  );
  if (from.rows.length === 0) return { ok: false, error: "You are not a member of that group." };
  const member = from.rows[0];

  const to = await db.query(`SELECT capacity FROM wiserfiles_groups WHERE id = $1`, [toGroupId]);
  if (to.rows.length === 0) return { ok: false, error: "Unknown target group." };
  const toCount = await countMembers(toGroupId);
  if (toCount >= (to.rows[0].capacity as number)) return { ok: false, error: "That group is full." };

  await migrateMarksBetweenGroups(userId, fromGroupId, toGroupId);

  await db.query(`DELETE FROM wiserfiles_group_members WHERE user_id = $1 AND group_id = $2`, [userId, fromGroupId]);
  await db.query(
    `INSERT INTO wiserfiles_group_members (user_id, group_id, name, surname, programme, student_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, group_id) DO UPDATE SET name = $3, surname = $4, programme = $5, student_id = $6`,
    [userId, toGroupId, member.name as string, member.surname as string, member.programme as string, member.student_id as string]
  );

  await db.query(
    `INSERT INTO wiserfiles_group_switch_log (user_id, student_id, name, surname, from_group_id, to_group_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, member.student_id as string, member.name as string, member.surname as string, fromGroupId, toGroupId]
  );

  return { ok: true };
}

export type GroupSwitchRow = {
  id: number;
  userId: string;
  studentId: string;
  name: string;
  surname: string;
  fromGroupId: string;
  toGroupId: string;
  fromName: string;
  toName: string;
  switchedAt: string;
};

export async function listGroupSwitches(): Promise<GroupSwitchRow[]> {
  await ensureMigrated();
  const r = await db.query(
    `SELECT s.id, s.user_id, s.student_id, s.name, s.surname,
            s.from_group_id, s.to_group_id, s.switched_at,
            COALESCE(g1.name, s.from_group_id) AS from_name,
            COALESCE(g2.name, s.to_group_id) AS to_name
     FROM wiserfiles_group_switch_log s
     LEFT JOIN wiserfiles_groups g1 ON g1.id = s.from_group_id
     LEFT JOIN wiserfiles_groups g2 ON g2.id = s.to_group_id
     ORDER BY s.switched_at DESC
     LIMIT 200`
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    userId: x.user_id as string,
    studentId: x.student_id as string,
    name: x.name as string,
    surname: x.surname as string,
    fromGroupId: x.from_group_id as string,
    toGroupId: x.to_group_id as string,
    fromName: x.from_name as string,
    toName: x.to_name as string,
    switchedAt: x.switched_at as string,
  }));
}

export async function updateGroup(
  groupId: string,
  fields: { name: string; schedule: string; capacity: number; sessionCount: number; testCount: number; examCount: number }
): Promise<boolean> {
  await ensureMigrated();
  const capacity = Math.max(1, Math.min(200, Math.round(fields.capacity) || 50));
  const sessionCount = Math.max(0, Math.min(50, Math.round(fields.sessionCount) || 0));
  const testCount = Math.max(0, Math.min(20, Math.round(fields.testCount) || 0));
  const examCount = Math.max(0, Math.min(20, Math.round(fields.examCount) || 0));
  const r = await db.query(
    `UPDATE wiserfiles_groups SET name = $2, schedule = $3, capacity = $4, session_count = $5, test_count = $6, exam_count = $7 WHERE id = $1`,
    [groupId, fields.name.trim() || "Group", fields.schedule.trim(), capacity, sessionCount, testCount, examCount]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function createGroup(fields: {
  name: string;
  schedule: string;
  capacity: number;
  sessionCount: number;
  testCount: number;
  examCount: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  await ensureMigrated();
  const name = fields.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";
  const id = `group-${slug}-${Date.now().toString(36).slice(-4)}`;
  const capacity = Math.max(1, Math.min(200, Math.round(fields.capacity) || 50));
  const sessionCount = Math.max(0, Math.min(50, Math.round(fields.sessionCount) || 0));
  const testCount = Math.max(0, Math.min(20, Math.round(fields.testCount) || 0));
  const examCount = Math.max(0, Math.min(20, Math.round(fields.examCount) || 0));
  const sort = await db.query(`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM wiserfiles_groups`);
  await db.query(
    `INSERT INTO wiserfiles_groups (id, name, schedule, capacity, session_count, test_count, exam_count, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, name, fields.schedule.trim(), capacity, sessionCount, testCount, examCount, sort.rows[0]?.n ?? 0]
  );
  return { ok: true, id };
}

export async function deleteGroup(groupId: string): Promise<boolean> {
  await ensureMigrated();
  // Members have no FK, so remove them explicitly; sessions cascade to marks.
  await db.query(`DELETE FROM wiserfiles_group_members WHERE group_id = $1`, [groupId]);
  await db.query(`DELETE FROM wiserfiles_group_sessions WHERE group_id = $1`, [groupId]);
  const r = await db.query(`DELETE FROM wiserfiles_groups WHERE id = $1`, [groupId]);
  return (r.rowCount ?? 0) > 0;
}

async function countMembers(groupId: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM wiserfiles_group_members WHERE group_id = $1`,
    [groupId]
  );
  return r.rows[0]?.n ?? 0;
}

export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  await ensureMigrated();
  const r = await db.query(
    `SELECT name, surname, programme, student_id, joined_at
     FROM wiserfiles_group_members
     WHERE group_id = $1
     ORDER BY LOWER(programme) ASC, LOWER(surname) ASC, LOWER(name) ASC`,
    [groupId]
  );
  return r.rows.map((x) => ({
    name: x.name as string,
    surname: x.surname as string,
    programme: x.programme as string,
    studentId: x.student_id as string,
    joinedAt: x.joined_at as string,
  }));
}

export type AggregatedMember = GroupMember & { groupName: string };

export async function listAllGroupMembers(): Promise<AggregatedMember[]> {
  await ensureGroupsSeeded();
  const r = await db.query(
    `SELECT m.name, m.surname, m.programme, m.student_id, m.joined_at,
            g.name AS group_name
     FROM wiserfiles_group_members m
     JOIN wiserfiles_groups g ON g.id = m.group_id
     ORDER BY g.sort_order ASC, LOWER(m.programme) ASC, LOWER(m.surname) ASC, LOWER(m.name) ASC`
  );
  return r.rows.map((x) => ({
    name: x.name as string,
    surname: x.surname as string,
    programme: x.programme as string,
    studentId: x.student_id as string,
    joinedAt: x.joined_at as string,
    groupName: x.group_name as string,
  }));
}
