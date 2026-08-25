// GitHub App authentication (server-side).
//
// A GitHub App authenticates as itself by signing a short-lived JWT (RS256)
// with the App's private key, then exchanges that JWT for an installation
// access token that can act on repositories the App is installed on.
//
// The private key comes from GITHUB_APP_PRIVATE_KEY in the server env. The
// docker-compose .env stores the PEM on a single line with literal "\n"
// sequences, so we unescape them before signing. The key never leaves the
// server and is never logged or returned to the client.

import { createSign } from "node:crypto";

const GITHUB_API = "https://api.github.com";

function appId(): string {
  return (process.env.GITHUB_APP_ID || "").trim();
}

function privateKey(): string {
  return (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

export function githubAppConfigured(): boolean {
  return Boolean(appId() && privateKey().includes("PRIVATE KEY"));
}

function signAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId() };
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey(), "base64url");
  return `${signingInput}.${signature}`;
}

// Exchange the App JWT for a short-lived installation access token.
export async function getInstallationToken(installationId: string): Promise<string> {
  if (!githubAppConfigured() || !installationId) return "";

  const jwt = signAppJwt();
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WiserFiles-Research-Studio",
    },
  });

  if (!res.ok) return "";
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  return data?.token || "";
}
