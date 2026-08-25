import { auth } from "@clerk/nextjs/server";
import { githubAppConfigured } from "@/lib/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Returns the GitHub App installation URL so the client can redirect the user
// to install the app. `state` carries the Clerk user id so the callback can
// associate the installation with the right account.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const slug = (process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || "").trim();
  if (!slug || !githubAppConfigured()) {
    return jsonError("GitHub App is not configured.", 503);
  }

  const url = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(userId)}`;
  return Response.json({ url });
}
