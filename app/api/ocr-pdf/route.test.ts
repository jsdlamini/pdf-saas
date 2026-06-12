import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { handleOcrPost } from "./route";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("OCR PDF route", () => {
  it("posts a fixture PDF and passes the selected language to OCRmyPDF", async () => {
    const fixture = await readFile(join(currentDir, "__fixtures__", "sample.pdf"));
    const formData = new FormData();
    formData.append("file", new File([fixture], "scan.pdf", { type: "application/pdf" }));
    formData.append("language", "fra");
    formData.append("deskew", "true");
    formData.append("cleanFinal", "true");
    formData.append("rotatePages", "true");
    formData.append("redoOcr", "true");

    const request = new Request("http://localhost:3000/api/ocr-pdf", {
      method: "POST",
      body: formData,
    });

    const mkdtempMock = vi.fn().mockResolvedValue("/tmp/papertrail-ocr-test");
    const writeFileMock = vi.fn().mockResolvedValue(undefined);
    const readFileMock = vi.fn().mockResolvedValue(fixture);
    const rmMock = vi.fn().mockResolvedValue(undefined);
    const execFileMock = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const response = await handleOcrPost(request, {
      mkdtemp: mkdtempMock,
      writeFile: writeFileMock,
      readFile: readFileMock,
      rm: rmMock,
      execFileAsync: execFileMock,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain('scan-searchable.pdf');
    expect(execFileMock).toHaveBeenCalledWith(
      "ocrmypdf",
      [
        "--output-type",
        "pdf",
        "-l",
        "fra",
        "--deskew",
        "--clean-final",
        "--rotate-pages",
        "--redo-ocr",
        "/tmp/papertrail-ocr-test/scan.pdf",
        "/tmp/papertrail-ocr-test/searchable.pdf",
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/papertrail-ocr-test/scan.pdf", expect.any(Buffer));
    expect(readFileMock).toHaveBeenCalledWith("/tmp/papertrail-ocr-test/searchable.pdf");
    expect(rmMock).toHaveBeenCalledWith("/tmp/papertrail-ocr-test", { recursive: true, force: true });
  });
});