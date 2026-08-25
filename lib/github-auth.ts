// Shared GitHub access-token resolution for server routes. Prefers a fresh
// GitHub App installation token, then falls back to a stored PAT.
import { db, ensureMigrated } from "./db";
import { decryptSecret } from "./crypto";
import { getInstallationToken } from "./github-app";

export type GithubTokenKind = "installation" | "pat" | "";

export const GITHUB_API = "https://api.github.com";

export async function getGithubTokenInfo(userId: string): Promise<{ token: string; kind: GithubTokenKind }> {
  await ensureMigrated();
  const res = await db.query(
    `SELECT github_token, github_installation_id FROM wiserfiles_user_secrets WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows.length) return { token: "", kind: "" };

  const installationId = res.rows[0].github_installation_id as string | null;
  if (installationId) {
    const token = await getInstallationToken(installationId);
    if (token) return { token, kind: "installation" };
  }

  const pat = res.rows[0].github_token ? decryptSecret(res.rows[0].github_token) : "";
  return pat ? { token: pat, kind: "pat" } : { token: "", kind: "" };
}

export async function getGithubAccessToken(userId: string): Promise<string> {
  return (await getGithubTokenInfo(userId)).token;
}

// An installation token cannot call /user/* (it is scoped to the installation's
// repositories), so the "owner" differs by token kind:
//   - PAT  -> GET /user
//   - installation -> GET /installation/repositories, matched by repo name.
export async function resolveGithubOwner(
  token: string,
  kind: GithubTokenKind,
  repoName: string
): Promise<string | null> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "WiserFiles-Research-Studio",
  };

  if (kind === "pat") {
    const res = await fetch(`${GITHUB_API}/user`, { headers });
    if (!res.ok) return null;
    return ((await res.json()) as { login: string }).login || null;
  }

  const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, { headers });
  if (!res.ok) return null;
  const data = (await res.json()) as { repositories?: Array<{ name: string; owner?: { login?: string } }> };
  const repo = data.repositories?.find((r) => r.name === repoName);
  return repo?.owner?.login || null;
}
