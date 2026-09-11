import { db, ensureMigrated } from "@/lib/db";
import { STUDY_GROUPS, isValidProgramme, isValidStudentId } from "@/lib/groups";

export type GroupView = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
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
      `INSERT INTO wiserfiles_groups (id, name, schedule, capacity, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name, g.schedule, g.capacity, i]
    );
  }
}

export async function listGroups(userId: string | null): Promise<GroupView[]> {
  await ensureGroupsSeeded();
  const groups = await db.query(
    `SELECT id, name, schedule, capacity FROM wiserfiles_groups ORDER BY sort_order ASC, id ASC`
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

export async function leaveGroup(userId: string, groupId: string): Promise<{ members: number }> {
  await ensureMigrated();
  await db.query(`DELETE FROM wiserfiles_group_members WHERE user_id = $1 AND group_id = $2`, [userId, groupId]);
  return { members: await countMembers(groupId) };
}

export async function updateGroup(
  groupId: string,
  fields: { name: string; schedule: string; capacity: number }
): Promise<boolean> {
  await ensureMigrated();
  const capacity = Math.max(1, Math.min(200, Math.round(fields.capacity) || 50));
  const r = await db.query(
    `UPDATE wiserfiles_groups SET name = $2, schedule = $3, capacity = $4 WHERE id = $1`,
    [groupId, fields.name.trim() || "Group", fields.schedule.trim(), capacity]
  );
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
     ORDER BY joined_at ASC`,
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
