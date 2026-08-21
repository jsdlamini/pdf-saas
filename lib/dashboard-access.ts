// Dashboard access control. Access is gated by an email allowlist; the user
// list itself is fetched from Clerk (the source of truth for registration).
import { auth, clerkClient } from "@clerk/nextjs/server";

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
    const email = user.emailAddresses[0]?.emailAddress || "";
    if (DASHBOARD_ALLOWED.includes(email)) {
      return { userId, email, error: null, status: 200 } as const;
    }
  } catch {
    // fall through to denied
  }

  return { error: "Dashboard access required.", status: 403 } as const;
}
