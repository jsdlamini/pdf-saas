import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_TO_WORD_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

type PdfToWordRouteDependencies = {
  mkdtemp: typeof mkdtemp;
  writeFile: typeof writeFile;
  readFile: typeof readFile;
  rm: typeof rm;
  execFileAsync: typeof execFileAsync;
};

const defaultDependencies: PdfToWordRouteDependencies = {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  execFileAsync,
};

function normalizeUploadName(fileName: string) {
  const base = fileName.replace(/\.[^/.]+$/, "") || "document";
  return base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
}

function buildDownloadName(fileName: string) {
  return `${normalizeUploadName(fileName)}.docx`;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function extractConversionFailure(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const withCode = error as { code?: string; stderr?: string; stdout?: string };
    if (withCode.code === "ENOENT") {
      return {
        status: 503,
        message: "PDF-to-Word backend is unavailable. Install pdf2docx or LibreOffice on the server.",
      };
    }

    const detail = [withCode.stderr, withCode.stdout]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join("\n")
      .trim();

    if (detail) {
      return {
        status: 500,
        message: `PDF-to-Word conversion failed: ${detail.split("\n").slice(-1)[0]}`,
      };
    }
  }

  if (error instanceof Error && error.message) {
    return { status: 500, message: `PDF-to-Word conversion failed: ${error.message}` };
  }

  return { status: 500, message: "PDF-to-Word conversion failed." };
}

export async function handlePdfToWordPost(
  request: Request,
  dependencies: PdfToWordRouteDependencies = defaultDependencies
) {
  const formData = await request.formData();
  const uploadedFile = formData.get("file");

  if (!(uploadedFile instanceof File)) {
    return jsonError("Upload one PDF file to convert.", 400);
  }

  if (!uploadedFile.size) {
    return jsonError("The uploaded PDF is empty.", 400);
  }

  const lowerName = uploadedFile.name.toLowerCase();
  if (uploadedFile.type !== "application/pdf" && !lowerName.endsWith(".pdf")) {
    return jsonError("PDF-to-Word accepts PDF uploads only.", 415);
  }

  if (uploadedFile.size > MAX_PDF_TO_WORD_UPLOAD_BYTES) {
    return jsonError("PDF-to-Word uploads are limited to 100 MB.", 413);
  }

  const tempDir = await dependencies.mkdtemp(join(tmpdir(), "wiserfiles-pdf2word-"));
  const sanitizedName = normalizeUploadName(uploadedFile.name);
  const inputPath = join(tempDir, `${sanitizedName}.pdf`);
  const outputPath = join(tempDir, `${sanitizedName}.docx`);

  try {
    await dependencies.writeFile(inputPath, Buffer.from(await uploadedFile.arrayBuffer()));

    // Primary engine: pdf2docx (PyMuPDF + python-docx) preserves layout, tables,
    // images, and formatting. The script lives under scripts/ relative to the app root.
    const scriptPath = join(process.cwd(), "scripts", "pdf2word-convert.py");
    try {
      await dependencies.execFileAsync(
        "python3",
        [scriptPath, inputPath, outputPath],
        { maxBuffer: 64 * 1024 * 1024 }
      );
    } catch {
      // Fallback: LibreOffice headless import (flat, text-only DOCX) in tempDir.
      await dependencies.execFileAsync(
        "libreoffice",
        ["--headless", "--convert-to", "docx", "--outdir", tempDir, inputPath],
        { maxBuffer: 64 * 1024 * 1024 }
      );
    }

    const outputBytes = await dependencies.readFile(outputPath);

    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${buildDownloadName(uploadedFile.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failure = extractConversionFailure(error);
    return jsonError(failure.message, failure.status);
  } finally {
    await dependencies.rm(tempDir, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  return handlePdfToWordPost(request);
}
