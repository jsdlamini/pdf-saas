import { auth } from "@clerk/nextjs/server";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS_ROOT = process.env.PROJECT_ASSETS_DIR || "/app/data/assets";

function sanitizeRelPath(value: string): string {
  const parts = normalize(value)
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Stores uploaded project images (figures) on the server filesystem so the
// LaTeX compiler can resolve \includegraphics paths without bloating the
// project JSON payload. Content is base64 in, binary on disk.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    files?: Array<{ path?: string; content?: string }>;
  } | null;

  if (!body || typeof body.projectId !== "string" || !Array.isArray(body.files)) {
    return jsonError("Invalid payload.", 400);
  }

  const projectDir = join(ASSETS_ROOT, userId, sanitizeRelPath(body.projectId));

  try {
    await mkdir(projectDir, { recursive: true });

    for (const file of body.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
      const safe = sanitizeRelPath(file.path);
      if (!safe) continue;
      const target = join(projectDir, safe);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content, "base64"));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store project assets.";
    return jsonError(`Could not store project assets: ${message}`, 500);
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
  if (!body || typeof body.projectId !== "string") return jsonError("Invalid payload.", 400);

  await rm(join(ASSETS_ROOT, userId, sanitizeRelPath(body.projectId)), {
    recursive: true,
    force: true,
  });
  return Response.json({ ok: true });
}
