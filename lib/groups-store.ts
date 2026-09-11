import { db, ensureMigrated } from "@/lib/db";
import { STUDY_GROUPS, getGroupById } from "@/lib/groups";

export type GroupView = {
  id: string;
  name: string;
  schedule: string;
  capacity: number;
  members: number;
  joined: boolean;
};

export async function listGroups(userId: string | null): Promise<GroupView[]> {
  await ensureMigrated();
  const counts = await db.query(
    `SELECT group_id, COUNT(*)::int AS n FROM wiserfiles_group_members GROUP BY group_id`
  );
  const countMap = new Map<string, number>(counts.rows.map((r) => [r.group_id, r.n]));

  let mine = new Set<string>();
  if (userId) {
    const r = await db.query(`SELECT group_id FROM wiserfiles_group_members WHERE user_id = $1`, [userId]);
    mine = new Set(r.rows.map((x) => x.group_id));
  }

  return STUDY_GROUPS.map((g) => ({
    ...g,
    members: countMap.get(g.id) ?? 0,
    joined: mine.has(g.id),
  }));
}

export async function joinGroup(
  userId: string,
  groupId: string
): Promise<{ ok: boolean; error?: string; members?: number; joined?: boolean }> {
  await ensureMigrated();
  const group = getGroupById(groupId);
  if (!group) return { ok: false, error: "Unknown group." };

  const existing = await db.query(
    `SELECT 1 FROM wiserfiles_group_members WHERE user_id = $1 AND group_id = $2`,
    [userId, groupId]
  );
  if (existing.rows.length > 0) {
    const n = await countMembers(groupId);
    return { ok: true, joined: true, members: n };
  }

  const n = await countMembers(groupId);
  if (n >= group.capacity) {
    return { ok: false, error: "This group is full." };
  }

  await db.query(
    `INSERT INTO wiserfiles_group_members (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, groupId]
  );
  return { ok: true, joined: true, members: await countMembers(groupId) };
}

export async function leaveGroup(userId: string, groupId: string): Promise<{ members: number }> {
  await ensureMigrated();
  await db.query(`DELETE FROM wiserfiles_group_members WHERE user_id = $1 AND group_id = $2`, [userId, groupId]);
  return { members: await countMembers(groupId) };
}

async function countMembers(groupId: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM wiserfiles_group_members WHERE group_id = $1`,
    [groupId]
  );
  return r.rows[0]?.n ?? 0;
}

export async function listGroupMemberIds(groupId: string): Promise<string[]> {
  await ensureMigrated();
  const r = await db.query(
    `SELECT user_id FROM wiserfiles_group_members WHERE group_id = $1 ORDER BY joined_at ASC`,
    [groupId]
  );
  return r.rows.map((x) => x.user_id as string);
}
