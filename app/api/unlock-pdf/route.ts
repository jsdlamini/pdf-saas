import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX_REQUESTS) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function normalizeUploadName(fileName: string) {
  const base = fileName.replace(/\.[^/.]+$/, "") || "document";
  return base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Decrypt with qpdf. The password is written to stdin (--password-file=-) so it
// never appears in argv, logs, or on disk. Supports RC4-40/128, AES-128, AES-256.
function qpdfDecrypt(inputPath: string, outputPath: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("qpdf", ["--decrypt", "--password-file=-", inputPath, outputPath]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(stderr || "qpdf failed"), { code, stderr }));
    });
    child.stdin.write(password);
    child.stdin.end();
  });
}

type UnlockRouteDependencies = {
  mkdtemp: typeof mkdtemp;
  writeFile: typeof writeFile;
  readFile: typeof readFile;
  rm: typeof rm;
  qpdfDecrypt: typeof qpdfDecrypt;
};

const defaultDependencies: UnlockRouteDependencies = {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  qpdfDecrypt,
};

export async function handleUnlockPdfPost(
  request: Request,
  dependencies: UnlockRouteDependencies = defaultDependencies
) {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("Invalid multipart form.", 400);

  const file = form.get("file") as File | null;
  if (!file) return jsonError("Provide a 'file'.", 400);
  if (!file.size) return jsonError("The uploaded PDF is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("File exceeds 100MB limit.", 413);

  const lowerName = file.name.toLowerCase();
  if (file.type !== "application/pdf" && !lowerName.endsWith(".pdf")) {
    return jsonError("Unlock PDF accepts PDF uploads only.", 415);
  }

  const password = (form.get("password") as string | null) ?? "";

  const tempDir = await dependencies.mkdtemp(join(tmpdir(), "wiserfiles-unlock-"));
  const inputPath = join(tempDir, `${normalizeUploadName(file.name)}.pdf`);
  const outputPath = join(tempDir, "decrypted.pdf");

  try {
    await dependencies.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    try {
      await dependencies.qpdfDecrypt(inputPath, outputPath, password);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr || "";
      if (/invalid password/i.test(stderr)) {
        return jsonError("Incorrect password.", 400);
      }
      return jsonError(
        "Could not decrypt this file. It may use an unsupported encryption scheme.",
        400
      );
    }

    const outputBytes = await dependencies.readFile(outputPath);
    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${normalizeUploadName(file.name)}-unlocked.pdf"`,
      },
    });
  } finally {
    // Always remove the temp dir (input AND decrypted output), even on error.
    await dependencies.rm(tempDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}

export async function POST(request: Request) {
  // Ungated (unlock-pdf was previously a free client-side tool) but rate-limited
  // by client IP to prevent abuse.
  if (!checkRateLimit(`unlock:${clientIp(request)}`)) {
    return jsonError("Rate limit exceeded. Try again shortly.", 429);
  }
  return handleUnlockPdfPost(request);
}
