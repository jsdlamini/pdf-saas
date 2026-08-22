import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportPayload = {
  rootFile?: string;
  files?: { path: string; content: string }[];
  format?: "docx" | "md";
};

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function isSafePath(p: string) {
  if (!p || p.endsWith("/") || p.includes("\0") || p.startsWith("/") || p.startsWith("\\")) return false;
  const normalized = p.replaceAll("\\", "/");
  return !(normalized.startsWith("../") || normalized.includes("/../") || normalized === "..");
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  let payload: ExportPayload;
  try {
    payload = (await request.json()) as ExportPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  const rootFile = (payload.rootFile || "main.tex").trim();
  const format = payload.format === "md" ? "md" : "docx";

  if (!isSafePath(rootFile) || !rootFile.endsWith(".tex")) {
    return jsonError("Invalid root LaTeX file path.", 400);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-export-"));
  try {
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
      if (!isSafePath(file.path)) continue;
      const target = join(tempDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      // Decode binary assets (figures/images) from base64 so pandoc can embed them.
      if (/\.(png|jpg|jpeg|gif|webp|pdf|eps|svg)$/i.test(file.path)) {
        const raw = file.content.includes(",") && file.content.startsWith("data:")
          ? file.content.slice(file.content.indexOf(",") + 1)
          : file.content;
        await writeFile(target, Buffer.from(raw, "base64"));
      } else {
        await writeFile(target, file.content, "utf8");
      }
    }

    const outputName = format === "docx" ? "document.docx" : "document.md";
    const outputPath = join(tempDir, outputName);

    const args = [rootFile, "-o", outputName, "-f", "latex", "-t", format === "docx" ? "docx" : "markdown"];

    await execFileAsync("pandoc", args, {
      cwd: tempDir,
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });

    const bytes = await readFile(outputPath);
    const contentType = format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "text/markdown; charset=utf-8";

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${outputName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    return jsonError(`Export failed: ${message}`, 502);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}
