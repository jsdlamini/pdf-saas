import { beforeEach, describe, expect, it, vi } from "vitest";

const dbQueryMock = vi.hoisted(() => vi.fn());
const ensureMigratedMock = vi.hoisted(() => vi.fn());
const clerkClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { query: dbQueryMock },
  ensureMigrated: ensureMigratedMock,
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: clerkClientMock,
}));

import { isLecturerOrAdmin, LECTURER_EMAIL_DOMAINS_DEFAULT } from "./user-roles";

function verifiedUser(email: string) {
  clerkClientMock.mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        primaryEmailAddress: { emailAddress: email, verification: { status: "verified" } },
      }),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  ensureMigratedMock.mockResolvedValue(undefined);
});

describe("isLecturerOrAdmin", () => {
  it("defaults the lecturer domain to uneswa.ac.sz when the setting is absent", async () => {
    expect(LECTURER_EMAIL_DOMAINS_DEFAULT).toBe("uneswa.ac.sz");

    verifiedUser("jsdlamini@uneswa.ac.sz");
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ role: "user" }] }) // getUserRole
      .mockResolvedValueOnce({ rows: [] }); // lecturer_email_domains missing

    await expect(isLecturerOrAdmin("u1")).resolves.toBe(true);
  });

  it("returns false for a verified email outside the configured domains", async () => {
    verifiedUser("someone@gmail.com");
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ role: "user" }] })
      .mockResolvedValueOnce({ rows: [] }); // missing → default domain

    await expect(isLecturerOrAdmin("u1")).resolves.toBe(false);
  });

  it("returns true for an admin regardless of email", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ role: "admin" }] });

    await expect(isLecturerOrAdmin("admin1")).resolves.toBe(true);
  });
});
