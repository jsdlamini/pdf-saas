import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getUserRoleMock = vi.hoisted(() => vi.fn());
const isCourseTeacherMock = vi.hoisted(() => vi.fn());
const resolveUserIdByEmailMock = vi.hoisted(() => vi.fn());
const getEmailForUserMock = vi.hoisted(() => vi.fn());
const listGroupsMock = vi.hoisted(() => vi.fn());
const joinGroupMock = vi.hoisted(() => vi.fn());
const switchGroupMock = vi.hoisted(() => vi.fn());
const updateGroupMock = vi.hoisted(() => vi.fn());
const createGroupMock = vi.hoisted(() => vi.fn());
const deleteGroupMock = vi.hoisted(() => vi.fn());
const updateGroupMemberMock = vi.hoisted(() => vi.fn());
const deleteGroupMemberMock = vi.hoisted(() => vi.fn());
const getGroupCourseIdMock = vi.hoisted(() => vi.fn());
const listAssignedStaffGroupIdsMock = vi.hoisted(() => vi.fn());
const listGroupStaffMock = vi.hoisted(() => vi.fn());
const assignStaffMock = vi.hoisted(() => vi.fn());
const unassignStaffMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/user-roles", () => ({
  getUserRole: getUserRoleMock,
  isCourseTeacher: isCourseTeacherMock,
  resolveUserIdByEmail: resolveUserIdByEmailMock,
  getEmailForUser: getEmailForUserMock,
}));

vi.mock("@/lib/groups-store", () => ({
  listGroups: listGroupsMock,
  joinGroup: joinGroupMock,
  switchGroup: switchGroupMock,
  updateGroup: updateGroupMock,
  createGroup: createGroupMock,
  deleteGroup: deleteGroupMock,
  updateGroupMember: updateGroupMemberMock,
  deleteGroupMember: deleteGroupMemberMock,
  getGroupCourseId: getGroupCourseIdMock,
  listAssignedStaffGroupIds: listAssignedStaffGroupIdsMock,
  listGroupStaff: listGroupStaffMock,
  assignStaff: assignStaffMock,
  unassignStaff: unassignStaffMock,
}));

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string) {
  return new Request(url);
}

const validBody = {
  action: "update-member",
  groupId: "group-a",
  memberUserId: "u1",
  name: "Thandi",
  surname: "Dlamini",
  programme: "BSc IT",
  studentId: "654321",
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "admin1" });
  getUserRoleMock.mockResolvedValue("admin");
  isCourseTeacherMock.mockResolvedValue(true);
  resolveUserIdByEmailMock.mockResolvedValue(null);
  getEmailForUserMock.mockResolvedValue("staff@example.com");
  getGroupCourseIdMock.mockResolvedValue(1);
  listAssignedStaffGroupIdsMock.mockResolvedValue(new Set<string>());
  listGroupStaffMock.mockResolvedValue([]);
  assignStaffMock.mockResolvedValue(true);
  unassignStaffMock.mockResolvedValue(true);
});

describe("groups route GET", () => {
  it("returns course-scoped groups with per-group assess access", async () => {
    authMock.mockResolvedValue({ userId: "assistant1" });
    getUserRoleMock.mockResolvedValue("assistant");
    isCourseTeacherMock.mockResolvedValue(false);
    listGroupsMock.mockResolvedValue([
      { id: "group-a", name: "Group A", schedule: "", capacity: 50, sessionCount: 4, testCount: 1, examCount: 1, members: 0, joined: false, courseId: 1 },
    ]);
    listAssignedStaffGroupIdsMock.mockResolvedValue(new Set(["group-a"]));

    const res = await GET(getRequest("http://localhost:3000/api/groups?courseId=1"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(listGroupsMock).toHaveBeenCalledWith("assistant1", 1);
    expect(json.groups[0].canAssess).toBe(true);
    expect(json.isAdmin).toBe(false);
    expect(json.isAssistant).toBe(true);
    expect(json.isCourseTeacher).toBe(false);
  });

  it("marks every group assessable for an admin", async () => {
    authMock.mockResolvedValue({ userId: "admin1" });
    getUserRoleMock.mockResolvedValue("admin");
    listGroupsMock.mockResolvedValue([
      { id: "group-a", name: "Group A", schedule: "", capacity: 50, sessionCount: 4, testCount: 1, examCount: 1, members: 0, joined: false, courseId: 1 },
    ]);

    const res = await GET(getRequest("http://localhost:3000/api/groups?courseId=1"));

    const json = await res.json();
    expect(json.groups[0].canAssess).toBe(true);
    expect(json.isAdmin).toBe(true);
  });
});

describe("groups route update-member", () => {
  it("updates a member's details for an admin", async () => {
    updateGroupMemberMock.mockResolvedValue({ ok: true });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(200);
    expect(updateGroupMemberMock).toHaveBeenCalledWith("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });
  });

  it("rejects assistants with 403", async () => {
    getUserRoleMock.mockResolvedValue("assistant");

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(403);
    expect(updateGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects plain users with 403", async () => {
    getUserRoleMock.mockResolvedValue("user");

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(403);
    expect(updateGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects signed-out requests with 401", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(401);
    expect(updateGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects a payload missing memberUserId with 400", async () => {
    const res = await POST(postRequest({ ...validBody, memberUserId: undefined }));

    expect(res.status).toBe(400);
    expect(updateGroupMemberMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the member is not in the group", async () => {
    updateGroupMemberMock.mockResolvedValue({
      ok: false,
      notFound: true,
      error: "Student not found in this group.",
    });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(404);
  });

  it("returns 400 on validation failure", async () => {
    updateGroupMemberMock.mockResolvedValue({ ok: false, error: "Student ID must be 6 or 9 digits." });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(400);
  });
});

const validDeleteBody = {
  action: "delete-member",
  groupId: "group-a",
  memberUserId: "u1",
};

describe("groups route delete-member", () => {
  it("deletes a member for an admin", async () => {
    deleteGroupMemberMock.mockResolvedValue({ ok: true });

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(200);
    expect(deleteGroupMemberMock).toHaveBeenCalledWith("group-a", "u1");
  });

  it("rejects assistants with 403", async () => {
    getUserRoleMock.mockResolvedValue("assistant");

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(403);
    expect(deleteGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects plain users with 403", async () => {
    getUserRoleMock.mockResolvedValue("user");

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(403);
    expect(deleteGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects signed-out requests with 401", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(401);
    expect(deleteGroupMemberMock).not.toHaveBeenCalled();
  });

  it("rejects a payload missing memberUserId with 400", async () => {
    const res = await POST(postRequest({ ...validDeleteBody, memberUserId: undefined }));

    expect(res.status).toBe(400);
    expect(deleteGroupMemberMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the member is not in the group", async () => {
    deleteGroupMemberMock.mockResolvedValue({
      ok: false,
      notFound: true,
      error: "Student not found in this group.",
    });

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(404);
  });

  it("returns 400 on failure", async () => {
    deleteGroupMemberMock.mockResolvedValue({ ok: false, error: "Could not delete the student." });

    const res = await POST(postRequest(validDeleteBody));

    expect(res.status).toBe(400);
  });
});

const validGroupBody = {
  action: "create",
  groupId: "group-a",
  courseId: 1,
  name: "Group A",
  schedule: "",
  capacity: 50,
  sessionCount: 4,
  testCount: 1,
  examCount: 1,
};

describe("groups route create/update/delete gating", () => {
  it("allows a course teacher (non-admin) to create a group in their course", async () => {
    isCourseTeacherMock.mockResolvedValue(true);
    createGroupMock.mockResolvedValue({ ok: true, id: "group-a" });

    const res = await POST(postRequest(validGroupBody));

    expect(res.status).toBe(200);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("admin1", 1);
    expect(createGroupMock).toHaveBeenCalledWith({
      name: "Group A",
      schedule: "",
      capacity: 50,
      sessionCount: 4,
      testCount: 1,
      examCount: 1,
      courseId: 1,
    });
  });

  it("rejects a plain student from creating a group", async () => {
    isCourseTeacherMock.mockResolvedValue(false);

    const res = await POST(postRequest(validGroupBody));

    expect(res.status).toBe(403);
    expect(createGroupMock).not.toHaveBeenCalled();
  });

  it("requires a courseId to create a group", async () => {
    const res = await POST(postRequest({ ...validGroupBody, courseId: undefined }));

    expect(res.status).toBe(400);
    expect(createGroupMock).not.toHaveBeenCalled();
  });

  it("allows a course teacher (non-admin) to update a group", async () => {
    isCourseTeacherMock.mockResolvedValue(true);
    updateGroupMock.mockResolvedValue(true);

    const res = await POST(postRequest({ ...validGroupBody, action: "update" }));

    expect(res.status).toBe(200);
    expect(getGroupCourseIdMock).toHaveBeenCalledWith("group-a");
    expect(isCourseTeacherMock).toHaveBeenCalledWith("admin1", 1);
    expect(updateGroupMock).toHaveBeenCalled();
  });

  it("rejects a plain student from updating a group", async () => {
    isCourseTeacherMock.mockResolvedValue(false);

    const res = await POST(postRequest({ ...validGroupBody, action: "update" }));

    expect(res.status).toBe(403);
    expect(updateGroupMock).not.toHaveBeenCalled();
  });

  it("returns 404 when updating a group with no course", async () => {
    getGroupCourseIdMock.mockResolvedValue(null);

    const res = await POST(postRequest({ ...validGroupBody, action: "update" }));

    expect(res.status).toBe(404);
    expect(updateGroupMock).not.toHaveBeenCalled();
  });

  it("allows a course teacher (non-admin) to delete a group", async () => {
    isCourseTeacherMock.mockResolvedValue(true);
    deleteGroupMock.mockResolvedValue(true);

    const res = await POST(postRequest({ ...validGroupBody, action: "delete" }));

    expect(res.status).toBe(200);
    expect(getGroupCourseIdMock).toHaveBeenCalledWith("group-a");
    expect(isCourseTeacherMock).toHaveBeenCalledWith("admin1", 1);
    expect(deleteGroupMock).toHaveBeenCalledWith("group-a");
  });

  it("rejects a plain student from deleting a group", async () => {
    isCourseTeacherMock.mockResolvedValue(false);

    const res = await POST(postRequest({ ...validGroupBody, action: "delete" }));

    expect(res.status).toBe(403);
    expect(deleteGroupMock).not.toHaveBeenCalled();
  });
});

describe("groups route join/switch are course-scoped", () => {
  it("passes courseId to joinGroup", async () => {
    joinGroupMock.mockResolvedValue({ ok: true, members: 1 });

    const res = await POST(
      postRequest({
        action: "join",
        groupId: "group-a",
        courseId: 1,
        name: "Thandi",
        surname: "Dlamini",
        programme: "BSc IT",
        studentId: "654321",
      })
    );

    expect(res.status).toBe(200);
    expect(joinGroupMock).toHaveBeenCalledWith("admin1", "group-a", 1, {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });
  });

  it("passes courseId to switchGroup", async () => {
    switchGroupMock.mockResolvedValue({ ok: true });

    const res = await POST(
      postRequest({ action: "switch", groupId: "group-a", toGroupId: "group-b", courseId: 1 })
    );

    expect(res.status).toBe(200);
    expect(switchGroupMock).toHaveBeenCalledWith("admin1", "group-a", "group-b", 1);
  });
});

describe("groups route staff assignment", () => {
  it("assigns staff by memberUserId for a course teacher", async () => {
    const res = await POST(
      postRequest({ action: "assign-staff", groupId: "group-a", memberUserId: "u2", role: "assistant" })
    );

    expect(res.status).toBe(200);
    expect(getGroupCourseIdMock).toHaveBeenCalledWith("group-a");
    expect(assignStaffMock).toHaveBeenCalledWith("group-a", "u2", "assistant");
  });

  it("resolves an email to a user id when assigning staff", async () => {
    resolveUserIdByEmailMock.mockResolvedValue("u2");

    const res = await POST(
      postRequest({ action: "assign-staff", groupId: "group-a", email: "staff@example.com", role: "teacher" })
    );

    expect(res.status).toBe(200);
    expect(assignStaffMock).toHaveBeenCalledWith("group-a", "u2", "teacher");
  });

  it("rejects staff assignment without a resolvable user", async () => {
    resolveUserIdByEmailMock.mockResolvedValue(null);

    const res = await POST(
      postRequest({ action: "assign-staff", groupId: "group-a", email: "nobody@example.com" })
    );

    expect(res.status).toBe(400);
    expect(assignStaffMock).not.toHaveBeenCalled();
  });

  it("rejects staff assignment for a non-teacher", async () => {
    isCourseTeacherMock.mockResolvedValue(false);

    const res = await POST(
      postRequest({ action: "assign-staff", groupId: "group-a", memberUserId: "u2" })
    );

    expect(res.status).toBe(403);
    expect(assignStaffMock).not.toHaveBeenCalled();
  });

  it("unassigns staff for a course teacher", async () => {
    const res = await POST(
      postRequest({ action: "unassign-staff", groupId: "group-a", memberUserId: "u2" })
    );

    expect(res.status).toBe(200);
    expect(unassignStaffMock).toHaveBeenCalledWith("group-a", "u2");
  });

  it("lists staff with emails for a course teacher", async () => {
    listGroupStaffMock.mockResolvedValue([{ userId: "u2", role: "assistant" }]);

    const res = await POST(postRequest({ action: "list-staff", groupId: "group-a" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.staff).toEqual([{ userId: "u2", role: "assistant", email: "staff@example.com" }]);
  });
});
