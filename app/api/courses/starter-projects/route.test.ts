import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());
const isCourseTeacherMock = vi.hoisted(() => vi.fn());
const listCourseProjectsMock = vi.hoisted(() => vi.fn());
const forkProjectMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

vi.mock("@/lib/user-roles", () => ({
  isCourseTeacher: isCourseTeacherMock,
}));

vi.mock("@/lib/research-project-store", () => ({
  listResearchProjectsForCourse: listCourseProjectsMock,
  forkResearchProjectForUser: forkProjectMock,
}));

vi.mock("node:fs/promises", () => ({
  cp: vi.fn(() => Promise.resolve()),
}));

import { GET, POST } from "./route";

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`);
}

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/courses/starter-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function starterProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    userId: "teacher1",
    name: "Starter",
    entries: [{ path: "main.tex", kind: "file", content: "x" }],
    selectedPath: "main.tex",
    lastCompileAt: "Not compiled yet",
    updatedAt: "2025-01-01T00:00:00.000Z",
    revisions: [],
    courseId: 7,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ userId: "teacher1" });
  ensureMigratedMock.mockResolvedValue(undefined);
  dbQueryMock.mockResolvedValue({ rows: [{ id: 7 }] });
  isCourseTeacherMock.mockImplementation(async (uid: string) => uid === "teacher1");
  listCourseProjectsMock.mockResolvedValue([]);
  forkProjectMock.mockResolvedValue({
    id: "p1copy",
    name: "Starter (copy)",
    entries: [{ path: "main.tex", kind: "file", content: "x" }],
    selectedPath: "main.tex",
    lastCompileAt: "Not compiled yet",
    updatedAt: "2025-01-02T00:00:00.000Z",
    revisions: [],
    courseId: 7,
  });
});

describe("starter-projects GET", () => {
  it("lists only teacher-owned starter projects", async () => {
    listCourseProjectsMock.mockResolvedValue([
      starterProject(),
      starterProject({ id: "fork1", userId: "student1", name: "Starter (copy)" }),
    ]);

    const res = await GET(getRequest("/api/courses/starter-projects?courseId=7"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isTeacher).toBe(true);
    expect(data.starterProjects).toHaveLength(1);
    expect(data.starterProjects[0].id).toBe("p1");
    expect(data.starterProjects[0].isOwner).toBe(true);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("student1", 7);
  });

  it("allows an active student member to list starters", async () => {
    authMock.mockResolvedValue({ userId: "student1" });
    isCourseTeacherMock.mockImplementation(async (uid: string) => uid === "teacher1");
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [{}] }); // active membership
    listCourseProjectsMock.mockResolvedValue([starterProject()]);

    const res = await GET(getRequest("/api/courses/starter-projects?courseId=7"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isTeacher).toBe(false);
    expect(data.starterProjects).toHaveLength(1);
    expect(data.starterProjects[0].isOwner).toBe(false);
  });

  it("rejects a non-member with 403", async () => {
    authMock.mockResolvedValue({ userId: "stranger" });
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [] }); // no membership

    const res = await GET(getRequest("/api/courses/starter-projects?courseId=7"));

    expect(res.status).toBe(403);
    expect(listCourseProjectsMock).not.toHaveBeenCalled();
  });

  it("requires a courseId", async () => {
    const res = await GET(getRequest("/api/courses/starter-projects"));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

describe("starter-projects POST fork", () => {
  it("forks a starter project into an enrolled student's projects", async () => {
    authMock.mockResolvedValue({ userId: "student1" });
    isCourseTeacherMock.mockImplementation(async (uid: string) => uid === "teacher1");
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [{}] }); // active membership
    listCourseProjectsMock.mockResolvedValue([starterProject()]);

    const res = await POST(postRequest({ action: "fork", courseId: 7, projectId: "p1" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.project.id).toBe("p1copy");
    expect(data.project.isOwner).toBe(true);
    expect(forkProjectMock).toHaveBeenCalledWith("student1", expect.objectContaining({ id: "p1" }));
  });

  it("rejects a non-member from forking with 403", async () => {
    authMock.mockResolvedValue({ userId: "stranger" });
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [] }); // no membership

    const res = await POST(postRequest({ action: "fork", courseId: 7, projectId: "p1" }));

    expect(res.status).toBe(403);
    expect(forkProjectMock).not.toHaveBeenCalled();
  });

  it("rejects forking a non-teacher-owned project with 404", async () => {
    // Viewer is a teacher; the source is a student's own fork.
    isCourseTeacherMock.mockImplementation(async (uid: string) => uid === "teacher1");
    listCourseProjectsMock.mockResolvedValue([
      starterProject({ id: "fork1", userId: "student1", name: "Starter (copy)" }),
    ]);

    const res = await POST(postRequest({ action: "fork", courseId: 7, projectId: "fork1" }));

    expect(res.status).toBe(404);
    expect(forkProjectMock).not.toHaveBeenCalled();
  });

  it("requires courseId and projectId", async () => {
    const res = await POST(postRequest({ action: "fork", courseId: 0, projectId: "" }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects unknown actions", async () => {
    const res = await POST(postRequest({ action: "delete", courseId: 7, projectId: "p1" }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});
