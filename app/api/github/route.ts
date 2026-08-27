import { auth } from "@clerk/nextjs/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getGithubTokenInfo, resolveGithubOwner } from "@/lib/github-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API = "https://api.github.com";
const ASSETS_ROOT = process.env.PROJECT_ASSETS_DIR || "/app/data/assets";

// Two-phase push so the client can report progress and no single request grows
// large or slow enough to trip the reverse proxy:
//   action=blobs  -> uploads blobs (parallel, small batches) and returns shas
//   action=commit -> builds tree + commit + updates the ref in one step
type PushPayload = {
  action?: "blobs" | "commit";
  token?: string;
  repoName?: string;
  projectId?: string;
  files?: { path: string; content: string }[];
  binaryPaths?: string[];
  blobs?: { path: string; sha: string }[];
  deletes?: string[];
  message?: string;
  isPrivate?: boolean;
};

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
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

function sanitizePath(path: string): string | null {
  const safe = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!safe || safe.includes("..") || safe.includes(":")) return null;
  const parts = safe.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : null;
}

function toBase64(path: string, content: string): string {
  if (/\.(png|jpe?g|gif|webp|pdf|eps|svg|bmp|ico)$/i.test(path)) {
    return content.includes(",") && content.startsWith("data:")
      ? content.slice(content.indexOf(",") + 1)
      : content;
  }
  return Buffer.from(content, "utf8").toString("base64");
}

async function ensureRepo(token: string, owner: string, repoName: string, isPrivate: boolean): Promise<void> {
  const repoRes = await githubRequest(token, `/repos/${owner}/${repoName}`);
  if (repoRes.status === 404) {
    const createRes = await githubRequest(token, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repoName,
        private: isPrivate,
        auto_init: true,
        description: "Created from WiserFiles Research Studio",
      }),
    });
    if (!createRes.ok && createRes.status !== 422) {
      const detail = await createRes.text();
      throw new Error(`Could not create repository: ${detail.slice(0, 300)}`);
    }
  } else if (!repoRes.ok) {
    throw new Error(`Could not access repository (${repoRes.status}).`);
  }
}

// A freshly created empty repo has no commits, which blocks the Git Data API
// (blobs/trees) with a 409. Seed an initial commit via the Contents API so the
// repo has a branch to build on.
async function initializeRepoIfEmpty(token: string, owner: string, repoName: string): Promise<void> {
  const repoRes = await githubRequest(token, `/repos/${owner}/${repoName}`);
  const repoInfo = repoRes.ok ? ((await repoRes.json()) as { default_branch?: string | null }) : null;
  const branch = repoInfo?.default_branch || "main";

  const refRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (refRes.status === 404) {
    const initRes = await githubRequest(token, `/repos/${owner}/${repoName}/contents/README.md`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Initial commit from WiserFiles",
        content: Buffer.from("# Created by WiserFiles\n").toString("base64"),
      }),
    });
    if (!initRes.ok && initRes.status !== 422) {
      const detail = await initRes.text();
      throw new Error(`Could not initialize the empty repository: ${detail.slice(0, 200)}`);
    }
  }
}

async function uploadBlob(token: string, owner: string, repoName: string, base64: string): Promise<string> {
  const res = await githubRequest(token, `/repos/${owner}/${repoName}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: base64, encoding: "base64" }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Could not upload a file: ${detail.slice(0, 200)}`);
  }
  const blob = (await res.json()) as { sha: string };
  return blob.sha;
}

async function resolveOwnerForPush(token: string, kind: "installation" | "pat" | "", repoName: string): Promise<string> {
  const owner = await resolveGithubOwner(token, kind, repoName);
  if (!owner) {
    throw new Error(
      kind === "installation"
        ? "The GitHub App can only push to repositories it is installed on. Open (or create) the repository on GitHub first, then push again."
        : "GitHub authentication failed. Check your connection."
    );
  }
  return owner;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as PushPayload | null;
  if (!body) return jsonError("Invalid payload.", 400);

  const { token: storedToken, kind } = await getGithubTokenInfo(userId);
  const token = (body.token || "").trim() || storedToken;
  const repoName = (body.repoName || "").trim();
  const action = body.action || "commit";

  if (!token) return jsonError("Connect GitHub first (File → GitHub Settings).", 400);
  if (!repoName) return jsonError("A repository name is required.", 400);
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) return jsonError("Repository name contains invalid characters.", 400);

  try {
    const owner = await resolveOwnerForPush(token, kind, repoName);

    if (action === "blobs") {
      const files = Array.isArray(body.files) ? body.files : [];
      const binaryPaths = Array.isArray(body.binaryPaths) ? body.binaryPaths : [];
      const projectId = (body.projectId || "").trim();

      await ensureRepo(token, owner, repoName, Boolean(body.isPrivate));
      await initializeRepoIfEmpty(token, owner, repoName);

      const blobs: { path: string; sha: string }[] = [];
      const missingAssets: string[] = [];

      // Prepare all (path, base64) pairs first.
      const toUpload: { path: string; base64: string }[] = [];
      for (const file of files) {
        if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
        const safe = sanitizePath(file.path);
        if (!safe) continue;
        toUpload.push({ path: safe, base64: toBase64(safe, file.content) });
      }
      if (binaryPaths.length && projectId) {
        for (const rawPath of binaryPaths) {
          if (typeof rawPath !== "string") continue;
          const safe = sanitizePath(rawPath);
          if (!safe) continue;
          try {
            const bytes = await readFile(join(ASSETS_ROOT, userId, sanitizePath(projectId) || projectId, safe));
            toUpload.push({ path: safe, base64: bytes.toString("base64") });
          } catch {
            missingAssets.push(safe);
          }
        }
      }

      // Upload in parallel with a small concurrency cap.
      const CONCURRENCY = 4;
      for (let i = 0; i < toUpload.length; i += CONCURRENCY) {
        const batch = toUpload.slice(i, i + CONCURRENCY);
        const shas = await Promise.all(batch.map((f) => uploadBlob(token, owner, repoName, f.base64)));
        batch.forEach((f, j) => blobs.push({ path: f.path, sha: shas[j] }));
      }

      return Response.json({ blobs, missingAssets });
    }

    // action === "commit"
    const blobs = Array.isArray(body.blobs) ? body.blobs : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes : [];
    const message = (body.message || "Update from WiserFiles Research Studio").trim();

    await ensureRepo(token, owner, repoName, Boolean(body.isPrivate));
    await initializeRepoIfEmpty(token, owner, repoName);

    const repoInfoRes = await githubRequest(token, `/repos/${owner}/${repoName}`);
    const repoInfo = repoInfoRes.ok ? ((await repoInfoRes.json()) as { default_branch?: string }) : null;
    const branch = repoInfo?.default_branch || "main";

    const headRefRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!headRefRes.ok) {
      const detail = await headRefRes.text();
      return jsonError(`Could not read the default branch: ${detail.slice(0, 200)}`, 502);
    }
    const headRef = (await headRefRes.json()) as { object?: { sha?: string } };
    const baseCommitSha = headRef.object?.sha;
    if (!baseCommitSha) return jsonError("Could not resolve the repository head commit.", 502);

    const baseCommitRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/commits/${baseCommitSha}`);
    if (!baseCommitRes.ok) return jsonError("Could not read the repository tree.", 502);
    const baseTreeSha = ((await baseCommitRes.json()) as { tree?: { sha?: string } }).tree?.sha;
    if (!baseTreeSha) return jsonError("Could not resolve the repository tree.", 502);

    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
    for (const blob of blobs) {
      if (!blob || typeof blob.path !== "string" || typeof blob.sha !== "string") continue;
      const safe = sanitizePath(blob.path);
      if (!safe) continue;
      treeEntries.push({ path: safe, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const path of deletes) {
      const safe = typeof path === "string" ? sanitizePath(path) : null;
      if (safe) treeEntries.push({ path: safe, mode: "100644", type: "blob", sha: null });
    }

    if (!treeEntries.length) return jsonError("No files to push.", 400);

    const treeRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeRes.ok) return jsonError("Could not build the commit tree.", 502);
    const treeSha = ((await treeRes.json()) as { sha: string }).sha;

    const commitRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: treeSha, parents: [baseCommitSha] }),
    });
    if (!commitRes.ok) return jsonError("Could not create the commit.", 502);
    const commitSha = ((await commitRes.json()) as { sha: string }).sha;

    const refRes = await githubRequest(token, `/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commitSha, force: false }),
    });
    if (!refRes.ok) {
      const conflict = refRes.status === 422;
      return jsonError(
        conflict
          ? "The repository changed on GitHub since your last sync — pull first to avoid overwriting it."
          : "Could not push.",
        conflict ? 409 : 502
      );
    }

    return Response.json({
      ok: true,
      url: `https://github.com/${owner}/${repoName}`,
      pushed: blobs.map((b) => b.path),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub push failed.", 500);
  }
}
