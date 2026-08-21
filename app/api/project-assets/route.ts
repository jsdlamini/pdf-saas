import { auth } from "@clerk/nextjs/server";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { decodeAssetContent } from "@/lib/latex-diagnostics";

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

// Recursively list every file under a project's asset directory as a
// project-relative path plus its absolute path.
async function listAssetFiles(dir: string, prefix = ""): Promise<Array<{ rel: string; full: string }>> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: Array<{ rel: string; full: string }> = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...(await listAssetFiles(full, rel)));
    } else if (entry.isFile()) {
      result.push({ rel, full });
    }
  }
  return result;
}

// Rehydration: a saved project's JSON stores image entries with empty content
// (the bytes live only in the asset store). This returns the stored bytes so a
// reloaded project can recover previews and re-upload for compilation.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId is required.", 400);

  const projectDir = join(ASSETS_ROOT, userId, sanitizeRelPath(projectId));
  const files = await listAssetFiles(projectDir);

  const out = [];
  for (const file of files) {
    const bytes = await readFile(file.full);
    out.push({ path: file.rel, size: bytes.length, content: bytes.toString("base64") });
  }
  return Response.json({ files: out });
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
      let bytes: Buffer;
      try {
        // Strips any data: URL prefix, decodes base64, and validates magic bytes.
        bytes = decodeAssetContent(safe, file.content);
      } catch (decodeError) {
        return jsonError(
          decodeError instanceof Error ? decodeError.message : `Corrupt image uploaded: ${safe}.`,
          400
        );
      }
      const target = join(projectDir, safe);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
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
