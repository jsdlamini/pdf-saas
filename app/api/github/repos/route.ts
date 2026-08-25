import { auth } from "@clerk/nextjs/server";
import { getGithubAccessToken } from "@/lib/github-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API = "https://api.github.com";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Lists the signed-in user's GitHub repositories (most recently updated first).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const token = await getGithubAccessToken(userId);
  if (!token) return jsonError("Connect GitHub first.", 400);

  const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&sort=updated&type=owner`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WiserFiles-Research-Studio",
    },
  });

  if (!res.ok) return jsonError(`Could not list repositories (${res.status}).`, 502);

  const repos = (await res.json()) as Array<{ name: string; full_name: string; default_branch: string; private: boolean }>;
  return Response.json({
    repos: repos.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      default_branch: r.default_branch,
      private: r.private,
    })),
  });
}
