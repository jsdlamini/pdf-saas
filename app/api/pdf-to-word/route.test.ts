import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handlePdfToWordPost } from "./route";

const scriptPath = join(process.cwd(), "scripts", "pdf2word-convert.py");
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

describe("PDF to Word route", () => {
  it("converts with pdf2docx first and returns DOCX bytes", async () => {
    const mkdtempMock = vi.fn().mockResolvedValue(tempDir);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const readFileMock = vi.fn().mockResolvedValue(Buffer.from("DOCX"));
    const rmMock = vi.fn().mockResolvedValue(undefined);
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const response = await handlePdfToWordPost(buildRequest(), {
      mkdtemp: mkdtempMock,
      writeFile: writeFileMock,
      readFile: readFileMock,
      rm: rmMock,
      execFileAsync: execFileMock,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(response.headers.get("content-disposition")).toContain("report.docx");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "python3",
      [scriptPath, join(tempDir, "report.pdf"), join(tempDir, "report.docx")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    expect(readFileMock).toHaveBeenCalledWith(join(tempDir, "report.docx"));
    expect(rmMock).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
  });

  it("falls back to LibreOffice when pdf2docx fails", async () => {
    const mkdtempMock = vi.fn().mockResolvedValue(tempDir);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const readFileMock = vi.fn().mockResolvedValue(Buffer.from("DOCX"));
    const rmMock = vi.fn().mockResolvedValue(undefined);
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("pdf2docx missing"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const response = await handlePdfToWordPost(buildRequest(), {
      mkdtemp: mkdtempMock,
      writeFile: writeFileMock,
      readFile: readFileMock,
      rm: rmMock,
      execFileAsync: execFileMock,
    });

    expect(response.status).toBe(200);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "python3",
      [scriptPath, join(tempDir, "report.pdf"), join(tempDir, "report.docx")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "libreoffice",
      ["--headless", "--convert-to", "docx", "--outdir", tempDir, join(tempDir, "report.pdf")],
      { maxBuffer: 64 * 1024 * 1024 }
    );
    expect(readFileMock).toHaveBeenCalledWith(join(tempDir, "report.docx"));
    expect(rmMock).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
  });

  it("returns 503 when both engines are unavailable", async () => {
    const mkdtempMock = vi.fn().mockResolvedValue(tempDir);
    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const readFileMock = vi.fn().mockResolvedValue(Buffer.from("DOCX"));
    const rmMock = vi.fn().mockResolvedValue(undefined);
    const execFileMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("python3 not found"), { code: "ENOENT" }))
      .mockRejectedValueOnce(Object.assign(new Error("libreoffice not found"), { code: "ENOENT" }));

    const response = await handlePdfToWordPost(buildRequest(), {
      mkdtemp: mkdtempMock,
      writeFile: writeFileMock,
      readFile: readFileMock,
      rm: rmMock,
      execFileAsync: execFileMock,
    });

    expect(response.status).toBe(503);
    expect(rmMock).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
  });
});
