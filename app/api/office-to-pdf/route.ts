import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError("Invalid multipart form.", 400);

  const file = form.get("file") as File | null;
  if (!file) return jsonError("Provide a 'file'.", 400);
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("File exceeds 50MB limit.", 413);

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-office-"));
  const inputPath = join(tempDir, file.name || "input");
  await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

  try {
    // LibreOffice converts Word/Excel/PowerPoint/HTML to PDF headlessly.
    await execFileAsync(
      "libreoffice",
      ["--headless", "--convert-to", "pdf", "--outdir", tempDir, inputPath],
      { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, HOME: tempDir } }
    );

    const baseName = (file.name || "input").replace(/\.[^.]+$/, "");
    const pdfPath = join(tempDir, `${baseName}.pdf`);
    const pdfBytes = await readFile(pdfPath);

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion failed.";
    return jsonError(`Conversion failed: ${message}`, 502);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
