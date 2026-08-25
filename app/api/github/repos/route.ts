import { auth } from "@clerk/nextjs/server";
import { GITHUB_API, getGithubTokenInfo } from "@/lib/github-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Lists the signed-in user's accessible GitHub repositories. For an installation
// token the list comes from /installation/repositories; for a PAT it comes from
// /user/repos.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const { token, kind } = await getGithubTokenInfo(userId);
  if (!token) return jsonError("Connect GitHub first.", 400);

  const path = kind === "installation" ? "/installation/repositories?per_page=100" : "/user/repos?per_page=100&sort=updated&type=owner";
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WiserFiles-Research-Studio",
    },
  });

  if (!res.ok) return jsonError(`Could not list repositories (${res.status}).`, 502);

  const raw = (await res.json()) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { repositories?: unknown }).repositories)
      ? ((raw as { repositories: Array<Record<string, unknown>> }).repositories)
      : [];

  return Response.json({
    repos: list.map((r: Record<string, unknown>) => ({
      name: String(r.name ?? ""),
      full_name: String(r.full_name ?? r.name ?? ""),
      default_branch: String(r.default_branch ?? "main"),
      private: Boolean(r.private),
    })),
  });
}
