import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

import { GET } from "./route";

function getRequest(path = "/api/join") {
  return new Request(`http://localhost:3000${path}`);
}

const cohortRow = {
  cohort_id: 5,
  join_code_expires_at: null,
  join_code_max_uses: null,
  join_code_uses: 1,
  name: "Cohort",
  course_id: 1,
  code: "CSC101",
  title: "Intro",
  institution: "UNESWA",
  member_count: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ userId: null });
  ensureMigratedMock.mockResolvedValue(undefined);
});

describe("join lookup route", () => {
  it("returns 404 when the join code is unknown or revoked", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest("/api/join?code=REVOKED1"));
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/no longer valid/i);
  });

  it("returns 410 when the link has expired", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ ...cohortRow, join_code_expires_at: new Date(Date.now() - 1000).toISOString() }],
    });

    const res = await GET(getRequest("/api/join?code=OLD12345"));
    expect(res.status).toBe(410);
  });

  it("returns 410 when the use limit is reached", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ ...cohortRow, join_code_max_uses: 2, join_code_uses: 2 }],
    });

    const res = await GET(getRequest("/api/join?code=FULL1234"));
    expect(res.status).toBe(410);
  });

  it("resolves a valid link to its course and membership state", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [cohortRow] });

    const res = await GET(getRequest("/api/join?code=ABCDEF12"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.course).toEqual({ id: 1, code: "CSC101", title: "Intro", institution: "UNESWA" });
    expect(data.cohort.member_count).toBe(3);
    expect(data.alreadyMember).toBe(false);
  });

  it("marks alreadyMember true for a signed-in member", async () => {
    authMock.mockResolvedValue({ userId: "student1" });
    dbQueryMock
      .mockResolvedValueOnce({ rows: [cohortRow] })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });

    const res = await GET(getRequest("/api/join?code=ABCDEF12"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.alreadyMember).toBe(true);
  });
});
