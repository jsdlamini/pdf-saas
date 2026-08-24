import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX_REQUESTS) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

function normalizeUploadName(fileName: string) {
  const base = fileName.replace(/\.[^/.]+$/, "") || "document";
  return base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function stderrOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = error as { stderr?: unknown; stdout?: unknown };
    return [detail.stderr, detail.stdout]
      .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
      .join("\n")
      .trim();
  }
  if (error instanceof Error && error.message) return error.message;
  return "unknown failure";
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!checkRateLimit(`pdf-to-excel:${userId}`)) {
    return Response.json({ error: "Too many conversions. Wait a minute and try again." }, { status: 429 });
  }

  const formData = await request.formData();
  const uploadedFile = formData.get("file");

  if (!(uploadedFile instanceof File)) return jsonError("Upload one PDF file to convert.", 400);
  if (!uploadedFile.size) return jsonError("The uploaded PDF is empty.", 400);

  const lowerName = uploadedFile.name.toLowerCase();
  if (uploadedFile.type !== "application/pdf" && !lowerName.endsWith(".pdf")) {
    return jsonError("PDF to Excel accepts PDF uploads only.", 415);
  }
  if (uploadedFile.size > MAX_UPLOAD_BYTES) {
    return jsonError("PDF to Excel uploads are limited to 100 MB.", 413);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-pdf2excel-"));
  const sanitized = normalizeUploadName(uploadedFile.name);
  const inputPath = join(tempDir, `${sanitized}.pdf`);
  const outputPath = join(tempDir, `${sanitized}.xlsx`);
  const script = join(process.cwd(), "scripts", "pdf2excel.py");

  try {
    await writeFile(inputPath, Buffer.from(await uploadedFile.arrayBuffer()));
    await execFileAsync("python3", [script, inputPath, outputPath], { maxBuffer: 64 * 1024 * 1024 });
    const outputBytes = await readFile(outputPath);

    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${sanitized}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Conversion-Engine": "pymupdf-tables",
      },
    });
  } catch (error) {
    return jsonError(`PDF to Excel conversion failed: ${stderrOf(error).split("\n").slice(-1)[0] || "unknown failure"}`, 500);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
