import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handlePdfToWordPost } from "./route";

const structuredScript = join(process.cwd(), "scripts", "pdf2word-structured.py");
const pdf2docxScript = join(process.cwd(), "scripts", "pdf2word-convert.py");
const tempDir = "/tmp/wiserfiles-pdf2word-test";

function buildRequest() {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from("%PDF-1.4 fake body")], "report.pdf", { type: "application/pdf" })
  );
  return new Request("http://localhost:3000/api/pdf-to-word", {
    method: "POST",
    body: formData,
  });
}

function deps(execFileMock: ReturnType<typeof vi.fn>) {
  return {
    mkdtemp: vi.fn().mockResolvedValue(tempDir),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("DOCX")),
    rm: vi.fn().mockResolvedValue(undefined),
    execFileAsync: execFileMock,
  };
}

const structuredOk = { stdout: 'STRUCTURED_STATS {"styles": 3, "text_chars": 1200}', stderr: "" };

describe("PDF to Word route", () => {
  it("converts with the structured engine first and reports the engine", async () => {
    const execFileMock = vi.fn().mockResolvedValue(structuredOk);
    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-conversion-engine")).toBe("structured");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "python3",
      [structuredScript, join(tempDir, "report.pdf"), join(tempDir, "report.docx")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
  });

  it("falls back to pdf2docx when the structured pass throws", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("structured boom"), { code: 1, stderr: "boom" }))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-conversion-engine")).toBe("pdf2docx");
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "python3",
      [pdf2docxScript, join(tempDir, "report.pdf"), join(tempDir, "report.docx")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
  });

  it("runs OCR then retries the structured pass for a scanned PDF (exit 3)", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("no text"), { code: 3, stderr: "no text layer" }))
      .mockResolvedValueOnce({ stdout: "", stderr: "" }) // ocrmypdf
      .mockResolvedValueOnce(structuredOk); // structured retry

    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-conversion-engine")).toBe("structured-ocr");
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "ocrmypdf",
      ["--skip-text", join(tempDir, "report.pdf"), join(tempDir, "report-ocr.pdf")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
  });

  it("falls back to pdf2docx when the structured pass finds no styles in a text-heavy doc", async () => {
    const execFileMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'STRUCTURED_STATS {"styles": 0, "text_chars": 900}', stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-conversion-engine")).toBe("pdf2docx");
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to LibreOffice when structured and pdf2docx both fail", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("structured boom"), { code: 1 }))
      .mockRejectedValueOnce(Object.assign(new Error("pdf2docx boom"), { code: 1 }))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-conversion-engine")).toBe("libreoffice");
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "libreoffice",
      ["--headless", "--convert-to", "docx", "--outdir", tempDir, join(tempDir, "report.pdf")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
  });

  it("returns 503 when every engine is unavailable", async () => {
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("python3 not found"), { code: "ENOENT" }))
      .mockRejectedValueOnce(Object.assign(new Error("python3 not found"), { code: "ENOENT" }))
      .mockRejectedValueOnce(Object.assign(new Error("libreoffice not found"), { code: "ENOENT" }));

    const response = await handlePdfToWordPost(buildRequest(), deps(execFileMock));

    expect(response.status).toBe(503);
  });
});
