import { auth } from "@clerk/nextjs/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GITHUB_API = "https://api.github.com";

type PushPayload = {
  token?: string;
  repoName?: string;
  files?: { path: string; content: string }[];
  message?: string;
  isPrivate?: boolean;
};

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function getStoredGithubToken(userId: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const res = await pool.query(
    `SELECT github_token FROM wiserfiles_user_secrets WHERE user_id = $1`,
    [userId]
  );
  await pool.end();
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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as PushPayload | null;
  if (!body) return jsonError("Invalid payload.", 400);

  const token = (body.token || "").trim() || (await getStoredGithubToken(userId));
  const repoName = (body.repoName || "").trim();
  const files = Array.isArray(body.files) ? body.files : [];
  const message = (body.message || "Update from WiserFiles Research Studio").trim();

  if (!token) return jsonError("Set up a GitHub personal access token first (File → GitHub Settings).", 400);
  if (!repoName) return jsonError("A repository name is required.", 400);
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) return jsonError("Repository name contains invalid characters.", 400);
  if (!files.length) return jsonError("No files to push.", 400);

  try {
    // 1. Get the authenticated user
    const userRes = await githubRequest(token, "/user");
    if (!userRes.ok) {
      return jsonError(`GitHub authentication failed (${userRes.status}). Check your token.`, 401);
    }
    const user = (await userRes.json()) as { login: string };
    const owner = user.login;

    // 2. Ensure the repository exists (create it if missing)
    const repoCheckRes = await githubRequest(token, `/repos/${owner}/${repoName}`);
    if (repoCheckRes.status === 404) {
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
    } else if (!repoCheckRes.ok) {
      return jsonError(`Could not access repository (${repoCheckRes.status}).`, 502);
    }

    // 3. Upload each file via the Contents API (base64 content)
    const results: string[] = [];
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
      const safePath = file.path.replace(/^\/+/, "").replace(/\\/g, "/");
      if (!safePath || safePath.includes("..")) continue;

      // Content may be raw base64 (binary) or a data URL or plain text.
      let base64: string;
      if (safePath.match(/\.(png|jpg|jpeg|gif|webp|pdf|eps|svg)$/i)) {
        base64 = file.content.includes(",") && file.content.startsWith("data:")
          ? file.content.slice(file.content.indexOf(",") + 1)
          : file.content;
      } else {
        base64 = Buffer.from(file.content, "utf8").toString("base64");
      }

      // Fetch the existing file's blob SHA so updates replace it correctly.
      let sha: string | undefined;
      try {
        const headRes = await githubRequest(token, `/repos/${owner}/${repoName}/contents/${encodeURIComponent(safePath)}`);
        if (headRes.ok) {
          const existing = (await headRes.json()) as { sha?: string };
          if (existing.sha) sha = existing.sha;
        }
      } catch { /* ignore */ }

      const uploadBody: Record<string, unknown> = { message, content: base64 };
      if (sha) uploadBody.sha = sha;

      const uploadRes = await githubRequest(token, `/repos/${owner}/${repoName}/contents/${encodeURIComponent(safePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uploadBody),
      });
      if (uploadRes.ok) {
        results.push(safePath);
      } else {
        const detail = await uploadRes.text();
        results.push(`FAILED ${safePath}: ${detail.slice(0, 120)}`);
      }
    }

    return Response.json({
      ok: true,
      owner,
      repo: repoName,
      url: `https://github.com/${owner}/${repoName}`,
      pushed: results.filter((r) => !r.startsWith("FAILED")),
      failed: results.filter((r) => r.startsWith("FAILED")),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub push failed.", 502);
  }
}
