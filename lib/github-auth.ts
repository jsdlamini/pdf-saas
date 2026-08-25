// Shared GitHub access-token resolution for server routes. Prefers a fresh
// GitHub App installation token, then falls back to a stored PAT.
import { db, ensureMigrated } from "./db";
import { decryptSecret } from "./crypto";
import { getInstallationToken } from "./github-app";

export async function getGithubAccessToken(userId: string): Promise<string> {
  await ensureMigrated();
  const res = await db.query(
    `SELECT github_token, github_installation_id FROM wiserfiles_user_secrets WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows.length) return "";

  const installationId = res.rows[0].github_installation_id as string | null;
  if (installationId) {
    const token = await getInstallationToken(installationId);
    if (token) return token;
  }

  return res.rows[0].github_token ? decryptSecret(res.rows[0].github_token) : "";
}
