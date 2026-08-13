import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { MAX_OCR_UPLOAD_BYTES, SUPPORTED_OCR_LANGUAGES } from "@/lib/ocr";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OcrRouteDependencies = {
  mkdtemp: typeof mkdtemp;
  writeFile: typeof writeFile;
  readFile: typeof readFile;
  rm: typeof rm;
  execFileAsync: typeof execFileAsync;
};

const defaultDependencies: OcrRouteDependencies = {
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
  return `${normalizeUploadName(fileName)}-searchable.pdf`;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function parseBoolean(value: FormDataEntryValue | null, defaultValue = false) {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function extractOcrFailure(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const withCode = error as { code?: string; stderr?: string; stdout?: string };
    if (withCode.code === "ENOENT") {
      return {
        status: 503,
        message: "OCR backend is unavailable. Install OCRmyPDF and its runtime dependencies on the server.",
      };
    }

    const detail = [withCode.stderr, withCode.stdout]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join("\n")
      .trim();

    if (detail) {
      return {
        status: 500,
        message: `OCR processing failed: ${detail.split("\n").slice(-1)[0]}`,
      };
    }
  }

  if (error instanceof Error && error.message) {
    return { status: 500, message: `OCR processing failed: ${error.message}` };
  }

  return { status: 500, message: "OCR processing failed." };
}

export async function handleOcrPost(
  request: Request,
  dependencies: OcrRouteDependencies = defaultDependencies
) {
  const formData = await request.formData();
  const uploadedFile = formData.get("file");
  const selectedLanguage = String(formData.get("language") || "eng").trim() || "eng";
  const deskew = parseBoolean(formData.get("deskew"), true);
  const cleanFinal = parseBoolean(formData.get("cleanFinal"), false);
  const rotatePages = parseBoolean(formData.get("rotatePages"), true);
  const redoOcr = parseBoolean(formData.get("redoOcr"), false);

  if (!(uploadedFile instanceof File)) {
    return jsonError("Upload one PDF file to run OCR.", 400);
  }

  if (!uploadedFile.size) {
    return jsonError("The uploaded PDF is empty.", 400);
  }

  const lowerName = uploadedFile.name.toLowerCase();
  if (uploadedFile.type !== "application/pdf" && !lowerName.endsWith(".pdf")) {
    return jsonError("OCR PDF accepts PDF uploads only.", 415);
  }

  if (uploadedFile.size > MAX_OCR_UPLOAD_BYTES) {
    return jsonError("OCR uploads are limited to 1 GB.", 413);
  }

  if (!SUPPORTED_OCR_LANGUAGES.has(selectedLanguage)) {
    return jsonError("Unsupported OCR language selection.", 400);
  }

  const tempDir = await dependencies.mkdtemp(join(tmpdir(), "wiserfiles-ocr-"));
  const inputPath = join(tempDir, `${normalizeUploadName(uploadedFile.name)}.pdf`);
  const outputPath = join(tempDir, "searchable.pdf");

  try {
    await dependencies.writeFile(inputPath, Buffer.from(await uploadedFile.arrayBuffer()));

    const args = ["--output-type", "pdf", "-l", selectedLanguage];
    if (deskew) args.push("--deskew");
    if (cleanFinal) args.push("--clean-final");
    if (rotatePages) args.push("--rotate-pages");
    if (redoOcr) {
      args.push("--redo-ocr");
    } else {
      args.push("--skip-text");
    }
    args.push(inputPath, outputPath);

    await dependencies.execFileAsync(
      "ocrmypdf",
      args,
      { maxBuffer: 16 * 1024 * 1024 }
    );

    const outputBytes = await dependencies.readFile(outputPath);
    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${buildDownloadName(uploadedFile.name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const failure = extractOcrFailure(error);
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
  return handleOcrPost(request);
}