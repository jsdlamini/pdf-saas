import { beforeEach, describe, expect, it, vi } from "vitest";

const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

import { resolveCohortId } from "./challenges";

beforeEach(() => {
  vi.resetAllMocks();
  ensureMigratedMock.mockResolvedValue(undefined);
});

describe("resolveCohortId", () => {
  it("prefers the most recent contest (non-course) enrollment over a course enrollment", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ cohort_id: 42 }] });

    await expect(resolveCohortId("u1")).resolves.toBe(42);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0][0]).toContain("c.course_id IS NULL");
  });

  it("falls back to any active enrollment (including a course) when no contest enrollment exists", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cohort_id: 7 }] });

    await expect(resolveCohortId("u1")).resolves.toBe(7);
  });

  it("falls back to the general cohort when the user has no enrollment", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await expect(resolveCohortId("u1")).resolves.toBe(1);
  });
});
