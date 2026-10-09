import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const getUserRoleMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/assess-store", () => ({
  getAssessment: getAssessmentMock,
  getAssessmentForClass: getAssessmentForClassMock,
  saveAssessment: saveAssessmentMock,
  saveAssessmentForClass: saveAssessmentForClassMock,
}));

import { GET, POST } from "./route";

const CLASS_ASSESS_GROUP = "__all__";

function getRequest(group: string) {
  return new Request(`http://localhost:3000/api/groups/assess?group=${encodeURIComponent(group)}`);
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
  getAssessmentMock.mockResolvedValue({ students: [], practicals: [], tests: [], exams: [], marks: [] });
  getAssessmentForClassMock.mockResolvedValue({ students: [], practicals: [], tests: [], exams: [], marks: [] });
  saveAssessmentMock.mockResolvedValue(undefined);
  saveAssessmentForClassMock.mockResolvedValue(undefined);
});

describe("assess route whole-class mode", () => {
  it("rejects whole-class GET for assistants (admin only)", async () => {
    getUserRoleMock.mockResolvedValue("assistant");
    const res = await GET(getRequest(CLASS_ASSESS_GROUP));
    expect(res.status).toBe(403);
    expect(getAssessmentForClassMock).not.toHaveBeenCalled();
  });

  it("serves whole-class GET for admins", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    const res = await GET(getRequest(CLASS_ASSESS_GROUP));
    expect(res.status).toBe(200);
    expect(getAssessmentForClassMock).toHaveBeenCalledTimes(1);
    expect(getAssessmentMock).not.toHaveBeenCalled();
  });

  it("keeps per-group GET for assistants", async () => {
    getUserRoleMock.mockResolvedValue("assistant");
    const res = await GET(getRequest("group-a"));
    expect(res.status).toBe(200);
    expect(getAssessmentMock).toHaveBeenCalledWith("group-a");
    expect(getAssessmentForClassMock).not.toHaveBeenCalled();
  });

  it("rejects whole-class POST for assistants (admin only)", async () => {
    getUserRoleMock.mockResolvedValue("assistant");
    const marks = [{ itemId: 1001, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: CLASS_ASSESS_GROUP, marks }));
    expect(res.status).toBe(403);
    expect(saveAssessmentForClassMock).not.toHaveBeenCalled();
    expect(saveAssessmentMock).not.toHaveBeenCalled();
  });

  it("saves whole-class marks through the class store for admins", async () => {
    getUserRoleMock.mockResolvedValue("admin");
    const marks = [{ itemId: 1001, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: CLASS_ASSESS_GROUP, marks }));
    expect(res.status).toBe(200);
    expect(saveAssessmentForClassMock).toHaveBeenCalledWith(marks);
    expect(saveAssessmentMock).not.toHaveBeenCalled();
  });

  it("keeps per-group POST saving for assistants", async () => {
    getUserRoleMock.mockResolvedValue("assistant");
    const marks = [{ itemId: 11, studentId: "S001", score: 8 }];
    const res = await POST(postRequest({ groupId: "group-a", marks }));
    expect(res.status).toBe(200);
    expect(saveAssessmentMock).toHaveBeenCalledWith("group-a", marks);
    expect(saveAssessmentForClassMock).not.toHaveBeenCalled();
  });
});
