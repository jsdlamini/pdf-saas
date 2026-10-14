import { beforeEach, describe, expect, it, vi } from "vitest";

const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

import { updateGroupMember } from "./groups-store";

function memberRow(studentId = "123456") {
  return { rows: [{ student_id: studentId }], rowCount: 1 };
}

function empty() {
  return { rows: [], rowCount: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureMigratedMock.mockResolvedValue(undefined);
});

describe("updateGroupMember", () => {
  it("updates a member's details and returns ok", async () => {
    dbQueryMock
      .mockResolvedValueOnce(memberRow("123456")) // existing member lookup
      .mockResolvedValueOnce(empty()) // student-id uniqueness check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE member

    const result = await updateGroupMember("group-a", "u1", {
      name: " Thandi ",
      surname: " Dlamini ",
      programme: " BSc IT ",
      studentId: " 654321 ",
    });

    expect(result).toEqual({ ok: true });
    expect(dbQueryMock).toHaveBeenCalledTimes(4); // includes the marks migration (id changed)
    const updateCall = dbQueryMock.mock.calls[2];
    expect(updateCall[0]).toContain("UPDATE wiserfiles_group_members");
    expect(updateCall[1]).toEqual(["u1", "group-a", "Thandi", "Dlamini", "BSc IT", "654321"]);
  });

  it("migrates this group's marks when the student number changes", async () => {
    dbQueryMock
      .mockResolvedValueOnce(memberRow("123456"))
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });

    await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });

    const migrateCall = dbQueryMock.mock.calls[3];
    expect(migrateCall[0]).toContain("UPDATE wiserfiles_assessment_marks");
    expect(migrateCall[1]).toEqual(["group-a", "123456", "654321"]);
  });

  it("skips the marks migration when the student number is unchanged", async () => {
    dbQueryMock
      .mockResolvedValueOnce(memberRow("123456"))
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "123456",
    });

    expect(result).toEqual({ ok: true });
    expect(dbQueryMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an empty name", async () => {
    const result = await updateGroupMember("group-a", "u1", {
      name: "   ",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Name and surname/);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects an empty surname", async () => {
    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "",
      programme: "BSc IT",
      studentId: "654321",
    });

    expect(result.ok).toBe(false);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid programme", async () => {
    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "Underwater Basket Weaving",
      studentId: "654321",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/programme/i);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed student id", async () => {
    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "12ab56",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Student ID/);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects a student id that is not 6 or 9 digits", async () => {
    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "12345",
    });

    expect(result.ok).toBe(false);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it("rejects a student id already registered to another account", async () => {
    dbQueryMock
      .mockResolvedValueOnce(memberRow("123456"))
      .mockResolvedValueOnce({ rows: [{ user_id: "other" }], rowCount: 1 });

    const result = await updateGroupMember("group-a", "u1", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already registered/);
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
  });

  it("reports notFound when the member is not in the group", async () => {
    dbQueryMock.mockResolvedValueOnce(empty());

    const result = await updateGroupMember("group-a", "missing-user", {
      name: "Thandi",
      surname: "Dlamini",
      programme: "BSc IT",
      studentId: "654321",
    });

    expect(result).toEqual({ ok: false, notFound: true, error: "Student not found in this group." });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });
});
