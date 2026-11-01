import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getUserRoleMock = vi.hoisted(() => vi.fn());
const listAssignedStaffGroupIdsMock = vi.hoisted(() => vi.fn());
const getAssessmentMock = vi.hoisted(() => vi.fn());
const getAssessmentForClassMock = vi.hoisted(() => vi.fn());
const saveAssessmentMock = vi.hoisted(() => vi.fn());
const saveAssessmentForClassMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/user-roles", () => ({
  getUserRole: getUserRoleMock,
}));

vi.mock("@/lib/groups-store", () => ({
  listAssignedStaffGroupIds: listAssignedStaffGroupIdsMock,
}));

vi.mock("@/lib/assess-store", () => ({
  getAssessment: getAssessmentMock,
  getAssessmentForClass: getAssessmentForClassMock,
  saveAssessment: saveAssessmentMock,
  saveAssessmentForClass: saveAssessmentForClassMock,
}));

import { GET, POST } from "./route";

const CLASS_ASSESS_GROUP = "__all__";

function getRequest(group: string, courseId?: number) {
  const qs = `group=${encodeURIComponent(group)}${courseId ? `&courseId=${courseId}` : ""}`;
  return new Request(`http://localhost:3000/api/groups/assess?${qs}`);
}

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/groups/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "u1" });
  getUserRoleMock.mockResolvedValue("assistant");
  listAssignedStaffGroupIdsMock.mockResolvedValue(new Set(["group-a"]));
  getAssessmentMock.mockResolvedValue({ students: [], practicals: [], tests: [], exams: [], marks: [] });
  getAssessmentForClassMock.mockResolvedValue({ students: [], practicals: [], tests: [], exams: [], marks: [] });
  saveAssessmentMock.mockResolvedValue(undefined);
  saveAssessmentForClassMock.mockResolvedValue(undefined);
});

describe("assess route whole-class mode", () => {
  it("rejects whole-class GET for assistants (admin only)", async () => {
    const res = await GET(getRequest(CLASS_ASSESS_GROUP, 1));
    expect(res.status).toBe(403);
    expect(getAssessmentForClassMock).not.toHaveBeenCalled();
  });

  it("serves whole-class GET for admins, scoped to a course", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    const res = await GET(getRequest(CLASS_ASSESS_GROUP, 1));
    expect(res.status).toBe(200);
    expect(getAssessmentForClassMock).toHaveBeenCalledWith(1);
    expect(getAssessmentMock).not.toHaveBeenCalled();
  });

  it("requires a courseId for whole-class GET", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    const res = await GET(getRequest(CLASS_ASSESS_GROUP));
    expect(res.status).toBe(400);
    expect(getAssessmentForClassMock).not.toHaveBeenCalled();
  });

  it("rejects whole-class POST for assistants (admin only)", async () => {
    const marks = [{ itemId: 1001, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: CLASS_ASSESS_GROUP, courseId: 1, marks }));
    expect(res.status).toBe(403);
    expect(saveAssessmentForClassMock).not.toHaveBeenCalled();
    expect(saveAssessmentMock).not.toHaveBeenCalled();
  });

  it("saves whole-class marks through the class store for admins", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    const marks = [{ itemId: 1001, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: CLASS_ASSESS_GROUP, courseId: 1, marks }));
    expect(res.status).toBe(200);
    expect(saveAssessmentForClassMock).toHaveBeenCalledWith(marks, 1);
    expect(saveAssessmentMock).not.toHaveBeenCalled();
  });
});

describe("assess route per-group scoping", () => {
  it("allows an assigned assistant to assess their group", async () => {
    const res = await GET(getRequest("group-a"));
    expect(res.status).toBe(200);
    expect(getAssessmentMock).toHaveBeenCalledWith("group-a");
  });

  it("rejects an assistant not assigned to the group", async () => {
    listAssignedStaffGroupIdsMock.mockResolvedValue(new Set(["group-b"]));
    const res = await GET(getRequest("group-a"));
    expect(res.status).toBe(403);
    expect(getAssessmentMock).not.toHaveBeenCalled();
  });

  it("allows an admin to assess any group regardless of assignment", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    listAssignedStaffGroupIdsMock.mockResolvedValue(new Set<string>());
    const res = await GET(getRequest("group-a"));
    expect(res.status).toBe(200);
    expect(getAssessmentMock).toHaveBeenCalledWith("group-a");
  });

  it("keeps per-group POST saving for an assigned assistant", async () => {
    const marks = [{ itemId: 11, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: "group-a", marks }));
    expect(res.status).toBe(200);
    expect(saveAssessmentMock).toHaveBeenCalledWith("group-a", marks);
    expect(saveAssessmentForClassMock).not.toHaveBeenCalled();
  });

  it("rejects per-group POST for an unassigned assistant", async () => {
    listAssignedStaffGroupIdsMock.mockResolvedValue(new Set(["group-b"]));
    const marks = [{ itemId: 11, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: "group-a", marks }));
    expect(res.status).toBe(403);
    expect(saveAssessmentMock).not.toHaveBeenCalled();
  });
});
