import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 100 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function normalizeName(name: string) {
  const base = name.replace(/\.[^/.]+$/, "") || "document";
  return base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-|-$/g, "") || "document";
}

type RedactRect = { page: number; x: number; y: number; w: number; h: number };

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const formData = await request.formData();
  const uploadedFile = formData.get("file");
  if (!(uploadedFile instanceof File)) return jsonError("Upload one PDF file.", 400);
  if (uploadedFile.size > MAX_PDF_BYTES) return jsonError("PDF too large.", 413);

  const rectsRaw = formData.get("rects");
  let rects: RedactRect[] = [];
  if (typeof rectsRaw === "string" && rectsRaw.trim()) {
    try {
      rects = JSON.parse(rectsRaw);
    } catch {
      return jsonError("Invalid redaction rectangles.", 400);
    }
  }
  if (!Array.isArray(rects) || !rects.length) return jsonError("No redaction rectangles.", 400);

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-redact-"));
  const inputPath = join(tempDir, `${normalizeName(uploadedFile.name)}.pdf`);
  const rectsPath = join(tempDir, "rects.json");
  const outputPath = join(tempDir, "redacted.pdf");

  try {
    await writeFile(inputPath, Buffer.from(await uploadedFile.arrayBuffer()));
    await writeFile(rectsPath, JSON.stringify(rects));

    await execFileAsync(
      "python3",
      [join(process.cwd(), "scripts", "redact-pdf.py"), inputPath, rectsPath, outputPath],
      { maxBuffer: 64 * 1024 * 1024 }
    );

    const outputBytes = await readFile(outputPath);
    return new Response(new Uint8Array(outputBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${normalizeName(uploadedFile.name)}-redacted.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redaction failed.";
    return jsonError(`PDF redaction failed: ${message}`, 502);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
