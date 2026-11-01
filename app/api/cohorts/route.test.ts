import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());
const activeSeasonIdMock = vi.hoisted(() => vi.fn());
const resolveCohortIdMock = vi.hoisted(() => vi.fn());
const isLecturerOrAdminMock = vi.hoisted(() => vi.fn());
const isCohortLecturerMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

vi.mock("@/lib/challenges", () => ({
  activeSeasonId: activeSeasonIdMock,
  resolveCohortId: resolveCohortIdMock,
}));

vi.mock("@/lib/user-roles", () => ({
  isLecturerOrAdmin: isLecturerOrAdminMock,
  isCohortLecturer: isCohortLecturerMock,
}));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/cohorts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ userId: "teacher1" });
  currentUserMock.mockResolvedValue({ firstName: "Thandi", username: null });
  ensureMigratedMock.mockResolvedValue(undefined);
  activeSeasonIdMock.mockResolvedValue(1);
  isLecturerOrAdminMock.mockResolvedValue(true);
  isCohortLecturerMock.mockResolvedValue(true);
});

describe("cohorts route create gating", () => {
  it("allows a lecturer to host a contest", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 5, name: "Contest", join_code: "ABC", slug: "c-x" }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "create", name: "Contest" }));

    expect(res.status).toBe(200);
    expect(isLecturerOrAdminMock).toHaveBeenCalledWith("teacher1");
  });

  it("rejects a plain student from hosting a contest", async () => {
    isLecturerOrAdminMock.mockResolvedValue(false);

    const res = await POST(postRequest({ action: "create", name: "Contest" }));

    expect(res.status).toBe(403);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

describe("cohorts route join", () => {
  it("returns 404 when the invite code does not exist (e.g. revoked)", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ action: "join", joinCode: "REVOKED1" }));

    expect(res.status).toBe(404);
    expect(dbQueryMock.mock.calls[0][0]).toContain("WHERE join_code = $1");
  });
});
