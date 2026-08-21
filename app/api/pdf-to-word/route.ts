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

// In-memory per-user throttle. This route shells out to python/ocrmypdf/
// LibreOffice, each of which is CPU-heavy, so a handful of concurrent
// conversions would exhaust the box without a cap.
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

// execFile rejects with { code: <exit number> } for a non-zero exit, or
// { code: "ENOENT" } when the binary is missing. Distinguish the two.
function exitCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

function stderrOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as { stderr?: unknown; stdout?: unknown });
    const parts = [detail.stderr, detail.stdout]
      .filter((v): v is string => typeof v === "string" && Boolean(v.trim()));
    return parts.join("\n").trim();
  }
  if (error instanceof Error && error.message) return error.message;
  return "unknown failure";
}

type StructuredStats = { styles: number; text_chars: number } | null;

function parseStructuredStats(stdout: string): StructuredStats {
  const line = stdout
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith("STRUCTURED_STATS "));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice("STRUCTURED_STATS ".length));
    if (typeof parsed.styles === "number" && typeof parsed.text_chars === "number") {
      return { styles: parsed.styles, text_chars: parsed.text_chars };
    }
  } catch {
    // ignore malformed stats
  }
  return null;
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
  const ocrPath = join(tempDir, `${sanitizedName}-ocr.pdf`);
  const outputPath = join(tempDir, `${sanitizedName}.docx`);

  const structuredScript = join(process.cwd(), "scripts", "pdf2word-structured.py");
  const pdf2docxScript = join(process.cwd(), "scripts", "pdf2word-convert.py");

  try {
    await dependencies.writeFile(inputPath, Buffer.from(await uploadedFile.arrayBuffer()));

    let engine = "structured";

    // Primary: structure-aware inference (headings, lists, tables).
    let structuredStats: StructuredStats = null;
    try {
      const result = await dependencies.execFileAsync(
        "python3",
        [structuredScript, inputPath, outputPath],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      structuredStats = parseStructuredStats(result.stdout || "");
    } catch (primaryError) {
      const code = exitCodeOf(primaryError);

      if (code === 3) {
        // No text layer: OCR first, then retry the structured pass.
        try {
          await dependencies.execFileAsync(
            "ocrmypdf",
            ["--skip-text", inputPath, ocrPath],
            { maxBuffer: 64 * 1024 * 1024 }
          );
          const retry = await dependencies.execFileAsync(
            "python3",
            [structuredScript, ocrPath, outputPath],
            { maxBuffer: 64 * 1024 * 1024 }
          );
          structuredStats = parseStructuredStats(retry.stdout || "");
          engine = "structured-ocr";
        } catch {
          // OCR or the retry failed; fall through to pdf2docx.
          console.error(`[pdf-to-word] structured+OCR failed: ${stderrOf(primaryError)}`);
          try {
            await dependencies.execFileAsync(
              "python3",
              [pdf2docxScript, inputPath, outputPath],
              { maxBuffer: 64 * 1024 * 1024 }
            );
            engine = "pdf2docx";
          } catch (pdf2docxError) {
            // Last resort: LibreOffice headless import.
            await dependencies.execFileAsync(
              "libreoffice",
              ["--headless", "--convert-to", "docx", "--outdir", tempDir, inputPath],
              { maxBuffer: 64 * 1024 * 1024 }
            );
            engine = "libreoffice";
          }
        }
      } else {
        // Structured threw (not a scanned doc): record it and fall back.
        console.error(`[pdf-to-word] structured failed (code ${code}): ${stderrOf(primaryError)}`);
        try {
          await dependencies.execFileAsync(
            "python3",
            [pdf2docxScript, inputPath, outputPath],
            { maxBuffer: 64 * 1024 * 1024 }
          );
          engine = "pdf2docx";
        } catch (pdf2docxError) {
          await dependencies.execFileAsync(
            "libreoffice",
            ["--headless", "--convert-to", "docx", "--outdir", tempDir, inputPath],
            { maxBuffer: 64 * 1024 * 1024 }
          );
          engine = "libreoffice";
        }
      }
    }

    // A text-heavy document whose structured pass found zero styles likely had
    // its inference fail silently; pdf2docx's flat but accurate output is the
    // safer result. Record which engine won.
    if (
      engine === "structured" &&
      structuredStats &&
      structuredStats.text_chars > 500 &&
      structuredStats.styles === 0
    ) {
      try {
        await dependencies.execFileAsync(
          "python3",
          [pdf2docxScript, inputPath, outputPath],
          { maxBuffer: 64 * 1024 * 1024 }
        );
        engine = "pdf2docx";
      } catch {
        // keep the structured output
      }
    }

    const outputBytes = await dependencies.readFile(outputPath);

    return new Response(outputBytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${buildDownloadName(uploadedFile.name)}"`,
        "Cache-Control": "no-store",
        "X-Conversion-Engine": engine,
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
  if (!checkRateLimit(`pdf-to-word:${userId}`)) {
    return Response.json(
      { error: "Too many PDF-to-Word conversions. Wait a minute and try again." },
      { status: 429 }
    );
  }
  return handlePdfToWordPost(request);
}
