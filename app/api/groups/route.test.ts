import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getUserRoleMock = vi.hoisted(() => vi.fn());
const listGroupsMock = vi.hoisted(() => vi.fn());
const joinGroupMock = vi.hoisted(() => vi.fn());
const switchGroupMock = vi.hoisted(() => vi.fn());
const updateGroupMock = vi.hoisted(() => vi.fn());
const createGroupMock = vi.hoisted(() => vi.fn());
const deleteGroupMock = vi.hoisted(() => vi.fn());
const updateGroupMemberMock = vi.hoisted(() => vi.fn());
const deleteGroupMemberMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/user-roles", () => ({
  getUserRole: getUserRoleMock,
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
}));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
