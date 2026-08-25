import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub redirects here after the user installs the App. The installation id is
// associated with the Clerk user id carried in `state` (set by the connect
// route). The browser session is already authenticated, so the redirect back to
// the studio lands the user on their own workspace.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state"); // Clerk user id

  const redirect = (result: "connected" | "error") =>
    Response.redirect(new URL(`/research-studio?github=${result}`, url.origin), 302);

  if (!installationId || !state) {
    return redirect("error");
  }

  try {
    await ensureMigrated();
    await db.query(
      `INSERT INTO wiserfiles_user_secrets (user_id, github_token, github_installation_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET github_installation_id = EXCLUDED.github_installation_id, updated_at = NOW()`,
      [state, "", installationId]
    );
    return redirect("connected");
  } catch (error) {
    console.error(`[github-app] failed to store installation: ${error instanceof Error ? error.message : "unknown"}`);
    return redirect("error");
  }
}
