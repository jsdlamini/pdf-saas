import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());
const isLecturerOrAdminMock = vi.hoisted(() => vi.fn());
const isCourseTeacherMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

vi.mock("@/lib/user-roles", () => ({
  isLecturerOrAdmin: isLecturerOrAdminMock,
  isCourseTeacher: isCourseTeacherMock,
}));

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(path = "/api/courses") {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ userId: "teacher1" });
  ensureMigratedMock.mockResolvedValue(undefined);
  isLecturerOrAdminMock.mockResolvedValue(true);
  isCourseTeacherMock.mockResolvedValue(true);
});

describe("courses route create", () => {
  it("creates a course, its cohort, and a lecturer enrollment for a teacher", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7, code: "CSC101", title: "Intro", institution: "", owner_id: "teacher1" }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, name: "Intro", join_code: "ABCDEF12", slug: "c-abc" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "create", code: "CSC101", title: "Intro" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.course.id).toBe(7);
    expect(data.cohort.join_code).toBe("ABCDEF12");

    expect(isLecturerOrAdminMock).toHaveBeenCalledWith("teacher1");
    expect(dbQueryMock.mock.calls[0][0]).toContain("INSERT INTO wiserfiles_courses");
    expect(dbQueryMock.mock.calls[1][0]).toContain("INSERT INTO wiserfiles_cohorts");
    const enrollSql = dbQueryMock.mock.calls[2][0];
    expect(enrollSql).toContain("INSERT INTO wiserfiles_enrollments");
    expect(enrollSql).toContain("'lecturer'");
  });

  it("rejects a plain student from creating a course", async () => {
    isLecturerOrAdminMock.mockResolvedValue(false);

    const res = await POST(postRequest({ action: "create", code: "CSC101", title: "Intro" }));

    expect(res.status).toBe(403);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("requires a code and a title", async () => {
    const res = await POST(postRequest({ action: "create", code: "  ", title: "" }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

describe("courses route regenerate-join-code", () => {
  it("rotates the join code and never touches enrollments", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, join_code: "NEWCODE12" }] });

    const res = await POST(postRequest({ action: "regenerate-join-code", courseId: 7, joinCodeMaxUses: 50 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.joinCode).toBe("NEWCODE12");
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);

    const sqls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("wiserfiles_enrollments"))).toBe(false);
    const update = sqls.find((s) => s.includes("UPDATE wiserfiles_cohorts"));
    expect(update).toBeTruthy();
    expect(update).toContain("join_code");
    expect(update).toContain("WHERE course_id = $1");
  });

  it("rejects a non-teacher", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // cohort lookup precedes the gate

    const res = await POST(postRequest({ action: "regenerate-join-code", courseId: 7 }));

    expect(res.status).toBe(403);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain("SELECT id FROM wiserfiles_cohorts");
  });
});

describe("courses route revoke-join", () => {
  it("nulls the join code without touching enrollments", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "revoke-join", courseId: 7 }));

    expect(res.status).toBe(200);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);

    const sqls = dbQueryMock.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("wiserfiles_enrollments"))).toBe(false);
    const update = sqls.find((s) => s.includes("UPDATE wiserfiles_cohorts"));
    expect(update).toContain("join_code = NULL");
    expect(update).toContain("WHERE course_id = $1");
  });

  it("rejects a non-teacher", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 9 }] }); // cohort lookup precedes the gate

    const res = await POST(postRequest({ action: "revoke-join", courseId: 7 }));

    expect(res.status).toBe(403);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain("SELECT id FROM wiserfiles_cohorts");
  });
});

describe("courses route update", () => {
  it("updates code/title/institution for a course teacher", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // existence check
      .mockResolvedValueOnce({
        rows: [{ id: 7, code: "CSC102", title: "New Title", institution: "UNESWA", owner_id: "teacher1" }],
      }); // UPDATE

    const res = await POST(
      postRequest({ action: "update", courseId: 7, code: "CSC102", title: "New Title", institution: "UNESWA" })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.course.code).toBe("CSC102");
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);

    const update = dbQueryMock.mock.calls.find((c) => c[0].includes("UPDATE wiserfiles_courses"));
    expect(update).toBeTruthy();
    expect(update![1]).toEqual([7, "CSC102", "New Title", "UNESWA"]);
  });

  it("rejects a non-teacher", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // existence check

    const res = await POST(postRequest({ action: "update", courseId: 7, code: "CSC102", title: "New Title" }));

    expect(res.status).toBe(403);
    expect(dbQueryMock.mock.calls.some((c) => c[0].includes("UPDATE wiserfiles_courses"))).toBe(false);
  });

  it("returns 404 for an unknown course", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "update", courseId: 999, code: "CSC102", title: "New Title" }));

    expect(res.status).toBe(404);
  });

  it("requires a code and a title", async () => {
    const res = await POST(postRequest({ action: "update", courseId: 7, code: "  ", title: "" }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

describe("courses route delete", () => {
  it("deletes the cohort before the course, gated by confirmation", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // existence check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE cohorts
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE course

    const res = await POST(postRequest({ action: "delete", courseId: 7, confirm: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(isCourseTeacherMock).toHaveBeenCalledWith("teacher1", 7);

    const sqls = dbQueryMock.mock.calls.map((c) => c[0]);
    const cohortDelete = sqls.findIndex((s) => s.includes("DELETE FROM wiserfiles_cohorts"));
    const courseDelete = sqls.findIndex((s) => s.includes("DELETE FROM wiserfiles_courses"));
    expect(cohortDelete).toBeGreaterThanOrEqual(0);
    expect(courseDelete).toBeGreaterThanOrEqual(0);
    // Cohort (and its cascading enrollments) must go before the course itself.
    expect(cohortDelete).toBeLessThan(courseDelete);
  });

  it("requires confirm: true", async () => {
    const res = await POST(postRequest({ action: "delete", courseId: 7 }));

    expect(res.status).toBe(400);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // existence check

    const res = await POST(postRequest({ action: "delete", courseId: 7, confirm: true }));

    expect(res.status).toBe(403);
    expect(dbQueryMock.mock.calls.some((c) => c[0].includes("DELETE FROM wiserfiles_courses"))).toBe(false);
  });

  it("returns 404 for an unknown course", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "delete", courseId: 999, confirm: true }));

    expect(res.status).toBe(404);
  });
});

describe("courses route GET", () => {
  it("requires sign-in", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
  });

  it("lists courses for a signed-in caller", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 7, code: "CSC101", title: "Intro", institution: "", owner_id: "teacher1", cohort_id: 9, member_count: 3, my_role: "lecturer", join_code: "ABCDEF12" }],
    });

    const res = await GET(getRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0].join_code).toBe("ABCDEF12");
  });

  it("returns 404 for an unknown course", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest("/api/courses?courseId=999"));

    expect(res.status).toBe(404);
  });

  it("hides the join code from a non-teacher member", async () => {
    isCourseTeacherMock.mockResolvedValue(false);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 7, code: "CSC101", title: "Intro", institution: "", owner_id: "someone-else" }] })
      .mockResolvedValueOnce({ rows: [{ role: "student", status: "active", student_id: "123456" }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, join_code: "SECRET12", join_code_expires_at: null, join_code_max_uses: null, join_code_uses: 0 }] });

    const res = await GET(getRequest("/api/courses?courseId=7"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cohort.join_code).toBeNull();
  });
});
