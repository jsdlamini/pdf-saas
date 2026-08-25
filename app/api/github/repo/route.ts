import { auth } from "@clerk/nextjs/server";
import { GITHUB_API, getGithubTokenInfo, resolveGithubOwner } from "@/lib/github-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 300;
const MAX_TOTAL_CHARS = 5_000_000;

// Binary asset extensions we skip when importing a repo (the studio would need
// them uploaded separately). Everything else is fetched as text.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|7z|mp3|mp4|woff2?|ttf|otf|eot)$/i;

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function githubJson(token: string, path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WiserFiles-Research-Studio",
    },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

// Fetches a repository's text files (via the recursive Git tree + blob API) so
// the client can import an existing repo into a new studio project.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const { token, kind } = await getGithubTokenInfo(userId);
  if (!token) return jsonError("Connect GitHub first.", 400);

  const repoParam = new URL(request.url).searchParams.get("repo")?.trim() || "";
  if (!repoParam || !/^[a-zA-Z0-9._/-]+$/.test(repoParam)) {
    return jsonError("A valid repository is required.", 400);
  }

  // Accept either "owner/name" (full_name) or just "name".
  let owner = "";
  let repoName = repoParam;
  const slash = repoParam.indexOf("/");
  if (slash !== -1) {
    owner = repoParam.slice(0, slash);
    repoName = repoParam.slice(slash + 1);
  } else {
    owner = (await resolveGithubOwner(token, kind, repoName)) || "";
  }
  if (!owner || !repoName) return jsonError("Could not determine the repository owner.", 404);

  const repo = await githubJson(token, `/repos/${owner}/${repoName}`);
  if (!repo.ok) return jsonError(`Repository "${repoName}" not found or not accessible.`, 404);
  const branch = ((repo.data as { default_branch?: string }).default_branch) || "main";

  const tree = await githubJson(token, `/repos/${owner}/${repoName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!tree.ok) return jsonError("Could not read the repository file tree.", 502);

  const entries = ((tree.data as { tree?: Array<{ path: string; type: string; sha: string }> }).tree) || [];
  const blobs = entries
    .filter((e) => e.type === "blob" && !BINARY_EXT.test(e.path))
    .slice(0, MAX_FILES);

  const files: Array<{ path: string; content: string }> = [];
  let totalChars = 0;

  for (const blob of blobs) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const content = await githubJson(token, `/repos/${owner}/${repoName}/git/blobs/${blob.sha}`);
    if (!content.ok) continue;
    const decoded = Buffer.from((content.data as { content: string }).content || "", "base64").toString("utf8");
    files.push({ path: blob.path, content: decoded });
    totalChars += decoded.length;
  }

  return Response.json({
    repo: repoName,
    owner,
    branch,
    files,
    truncated: entries.filter((e) => e.type === "blob").length > blobs.length,
  });
}
