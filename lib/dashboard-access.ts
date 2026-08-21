// Dashboard access control. Access is role-based ("admin" role in the local
// wiserfiles_user_roles table). The email allowlist below only *bootstraps*
// the first admins — once seeded, the role is the source of truth and admins
// can promote/demote others through the dashboard.
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ensureUserRecord, getUserRole, setUserRole } from "@/lib/user-roles";

export const DASHBOARD_ALLOWED = [
  "johnsjdsd@gmail.com",
  "jsdlamini@uneswa.ac.sz",
];

export async function requireDashboardAccess() {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in required.", status: 401 } as const;

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    // Prefer the verified primary address. Index zero is not guaranteed to be
    // the primary, and an unverified address must not grant admin access.
    const primary = user.primaryEmailAddress?.emailAddress || "";
    const verifiedPrimary =
      user.primaryEmailAddress && user.primaryEmailAddress.verification?.status === "verified"
        ? primary
        : "";
    const email = verifiedPrimary || "";

    // Sync the local record and resolve the effective role. Allowlisted emails
    // are seeded as admin exactly once; everyone else keeps their stored role
    // (defaulting to "user").
    let role = await getUserRole(userId);
    if (DASHBOARD_ALLOWED.includes(email) && role !== "admin") {
      await setUserRole(userId, "admin", email);
      role = "admin";
    } else {
      await ensureUserRecord(userId, email);
    }

    if (role !== "admin") {
      return { error: "Admin access required.", status: 403 } as const;
    }

    return { userId, email, role, error: null, status: 200 } as const;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Dashboard access failed.",
      status: 500,
    } as const;
  }
}
