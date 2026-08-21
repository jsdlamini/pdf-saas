import { auth } from "@clerk/nextjs/server";
import { db, ensureMigrated } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API = "https://api.github.com";

type PushPayload = {
  token?: string;
  repoName?: string;
  files?: { path: string; content: string }[];
  deletes?: string[];
  message?: string;
  isPrivate?: boolean;
};

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function getStoredGithubToken(userId: string): Promise<string> {
  await ensureMigrated();
  const res = await db.query(
    `SELECT github_token FROM wiserfiles_user_secrets WHERE user_id = $1`,
    [userId]
  );
  return res.rows.length ? res.rows[0].github_token : "";
}

async function githubRequest(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WiserFiles-Research-Studio",
      ...(options.headers || {}),
    },
  });
  return res;
}

// The Contents API expects {path} with slashes preserved. encodeURIComponent on
// the whole path turns "images/ch1/a.png" into a single literal filename, which
// is why nested paths never worked. Encode each segment instead.
function encodePath(path: string): string {
  return path.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

function toBase64(path: string, content: string): string {
  if (/\.(png|jpe?g|gif|webp|pdf|eps|svg|bmp|ico)$/i.test(path)) {
    return content.includes(",") && content.startsWith("data:")
      ? content.slice(content.indexOf(",") + 1)
      : content;
  }
  return Buffer.from(content, "utf8").toString("base64");
}

function sanitizePath(path: string): string | null {
  const safe = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!safe || safe.includes("..") || safe.includes(":")) return null;
  const parts = safe.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : null;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as PushPayload | null;
  if (!body) return jsonError("Invalid payload.", 400);

  const token = (body.token || "").trim() || (await getStoredGithubToken(userId));
  const repoName = (body.repoName || "").trim();
  const files = Array.isArray(body.files) ? body.files : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  const message = (body.message || "Update from WiserFiles Research Studio").trim();

  if (!token) return jsonError("Connect GitHub first (File → GitHub Settings).", 400);
  if (!repoName) return jsonError("A repository name is required.", 400);
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) return jsonError("Repository name contains invalid characters.", 400);
  if (!files.length && !deletes.length) return jsonError("No files to push.", 400);

  // Normalise inputs and reject unsafe paths before any network work.
  const normalized = new Map<string, { content: string; base64: string }>();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
    const safe = sanitizePath(file.path);
    if (!safe) continue;
    normalized.set(safe, { content: file.content, base64: toBase64(safe, file.content) });
  }
  const normalizedDeletes = deletes
    .map((p) => (typeof p === "string" ? sanitizePath(p) : null))
    .filter((p): p is string => Boolean(p));

  if (!normalized.size && !normalizedDeletes.length) return jsonError("No valid files to push.", 400);

  try {
    const userRes = await githubRequest(token, "/user");
    if (!userRes.ok) {
      return jsonError(`GitHub authentication failed (${userRes.status}). Check your connection.`, 401);
    }
    const user = (await userRes.json()) as { login: string };
    const owner = user.login;

    // Ensure the repository exists.
    const repoRes = await githubRequest(token, `/repos/${owner}/${repoName}`);
    if (repoRes.status === 404) {
      const createRes = await githubRequest(token, "/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repoName,
          private: Boolean(body.isPrivate),
          auto_init: true,
          description: "Created from WiserFiles Research Studio",
        }),
      });
      if (!createRes.ok && createRes.status !== 422) {
        const detail = await createRes.text();
        return jsonError(`Could not create repository: ${detail.slice(0, 300)}`, 502);
      }
    } else if (!repoRes.ok) {
      return jsonError(`Could not access repository (${repoRes.status}).`, 502);
    }

    // One commit for the whole change set via the Git Data API (blobs -> tree ->
    // commit -> ref), so a multi-file push is a single commit that also supports
    // deletes, instead of the Contents API's one-commit-per-file loop.
    const repoInfo = (await repoRes.json()) as { default_branch?: string };
    const branch = repoInfo.default_branch || "main";

    const headRefRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/ref/heads/${encodePath(branch)}`);
    if (!headRefRes.ok) {
      const detail = await headRefRes.text();
      return jsonError(`Could not read the default branch: ${detail.slice(0, 200)}`, 502);
    }
    const headRef = (await headRefRes.json()) as { object?: { sha?: string } };
    const baseCommitSha = headRef.object?.sha;
    if (!baseCommitSha) return jsonError("Could not resolve the repository head commit.", 502);

    const baseCommitRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/commits/${baseCommitSha}`);
    if (!baseCommitRes.ok) return jsonError("Could not read the repository tree.", 502);
    const baseCommit = (await baseCommitRes.json()) as { tree?: { sha?: string } };
    const baseTreeSha = baseCommit.tree?.sha;
    if (!baseTreeSha) return jsonError("Could not resolve the repository tree.", 502);

    // Create a blob for each file.
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
    for (const [path, file] of normalized.entries()) {
      const blobRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: file.base64, encoding: "base64" }),
      });
      if (!blobRes.ok) {
        const detail = await blobRes.text();
        return jsonError(`Could not upload ${path}: ${detail.slice(0, 200)}`, 502);
      }
      const blob = (await blobRes.json()) as { sha: string };
      treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const path of normalizedDeletes) {
      treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
    }

    const treeRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeRes.ok) {
      const detail = await treeRes.text();
      return jsonError(`Could not build the commit tree: ${detail.slice(0, 200)}`, 502);
    }
    const tree = (await treeRes.json()) as { sha: string };

    const commitRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
    });
    if (!commitRes.ok) {
      const detail = await commitRes.text();
      return jsonError(`Could not create the commit: ${detail.slice(0, 200)}`, 502);
    }
    const commit = (await commitRes.json()) as { sha: string };

    // force: false => if the remote moved since we read the head, this 422s and
    // we report a conflict instead of silently overwriting someone else's work.
    const refRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/refs/heads/${encodePath(branch)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (!refRes.ok) {
      const detail = await refRes.text();
      const conflict = refRes.status === 422;
      return jsonError(
        conflict
          ? "The repository changed on GitHub since your last sync — pull first to avoid overwriting it."
          : `Could not push: ${detail.slice(0, 200)}`,
        conflict ? 409 : 502
      );
    }

    return Response.json({
      ok: true,
      owner,
      repo: repoName,
      url: `https://github.com/${owner}/${repoName}`,
      pushed: [...normalized.keys()],
      deleted: normalizedDeletes,
      commit: commit.sha,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub push failed.", 502);
  }
}
