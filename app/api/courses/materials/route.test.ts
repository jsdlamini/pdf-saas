import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());
const isCourseTeacherMock = vi.hoisted(() => vi.fn());

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

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/courses/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ userId: "teacher1" });
  ensureMigratedMock.mockResolvedValue(undefined);
  isCourseTeacherMock.mockResolvedValue(true);
});

describe("materials GET", () => {
  it("lists materials for a course teacher", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({
        rows: [
          { id: 1, course_id: 7, author_id: "teacher1", kind: "note", title: "Week 1", body: "Hello", created_at: "2025-01-01", updated_at: "2025-01-01" },
        ],
      });

    const res = await GET(getRequest("/api/courses/materials?courseId=7"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isTeacher).toBe(true);
    expect(data.materials).toHaveLength(1);
    expect(data.materials[0].title).toBe("Week 1");
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);
  });

  it("lists materials for an active student member", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [{}] }) // active membership
      .mockResolvedValueOnce({ rows: [] }); // materials

    const res = await GET(getRequest("/api/courses/materials?courseId=7"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isTeacher).toBe(false);
    expect(data.materials).toEqual([]);
    expect(dbQueryMock.mock.calls[1][0]).toContain("wiserfiles_enrollments");
  });

  it("rejects a non-member with 403", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [] }); // no active membership

    const res = await GET(getRequest("/api/courses/materials?courseId=7"));

    expect(res.status).toBe(403);
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
  });

  it("requires a courseId", async () => {
    const res = await GET(getRequest("/api/courses/materials"));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

describe("materials POST create", () => {
  it("creates a note for a course teacher", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({
        rows: [{ id: 1, course_id: 7, author_id: "teacher1", kind: "note", title: "Week 1", body: "# Hello" }],
      });

    const res = await POST(postRequest({ action: "create", courseId: 7, kind: "note", title: "Week 1", body: "# Hello" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.material.id).toBe(1);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);
    expect(dbQueryMock.mock.calls[1][0]).toContain("INSERT INTO wiserfiles_course_materials");
  });

  it("requires a URL for link/video kinds", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    const res = await POST(postRequest({ action: "create", courseId: 7, kind: "link", title: "Docs", body: "" }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).toHaveBeenCalledTimes(1); // only the course-existence lookup
  });

  it("rejects an invalid kind", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    const res = await POST(postRequest({ action: "create", courseId: 7, kind: "pdf", title: "X" }));

    expect(res.status).toBe(400);
  });

  it("rejects a student from creating", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 7 }] });

    const res = await POST(postRequest({ action: "create", courseId: 7, kind: "note", title: "Nope" }));

    expect(res.status).toBe(403);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });
});

describe("materials POST update", () => {
  it("updates an existing material scoped to its course", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // material exists
      .mockResolvedValueOnce({
        rows: [{ id: 2, course_id: 7, author_id: "teacher1", kind: "video", title: "Video", body: "https://youtube.com/x" }],
      });

    const res = await POST(postRequest({ action: "update", courseId: 7, materialId: 2, kind: "video", title: "Video", body: "https://youtube.com/x" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.material.kind).toBe("video");
    expect(dbQueryMock.mock.calls[2][0]).toContain("UPDATE wiserfiles_course_materials");
  });

  it("rejects an update for a material that is not in the course", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [] }); // no matching material

    const res = await POST(postRequest({ action: "update", courseId: 7, materialId: 99, kind: "note", title: "X" }));

    expect(res.status).toBe(404);
  });
});

describe("materials POST delete", () => {
  it("deletes a material for a course teacher", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // course exists
      .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // material exists
      .mockResolvedValueOnce({ rows: [] }); // delete result

    const res = await POST(postRequest({ action: "delete", courseId: 7, materialId: 2 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(dbQueryMock.mock.calls[2][0]).toContain("DELETE FROM wiserfiles_course_materials");
  });
});
