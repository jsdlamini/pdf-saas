// pdf-lib transforms: document assembly, image embedding, office→PDF mixing.
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { LEGACY_PDF_WATERMARK_MARKERS, replaceAsciiMarker, readAsArrayBuffer } from "./helpers";
import { renderPdfThumbnails } from "./rasterize";

export type MergePageNode = {
  id: string;
  fileIndex: number;
  fileName: string;
  pageIndex: number;
  pageNumber: number;
  dataUrl: string;
};

export async function sanitizeLegacyWatermarks(blob: Blob) {
  if (!blob.type.includes("pdf")) return blob;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let changed = false;
  for (const markerBytes of LEGACY_PDF_WATERMARK_MARKERS) {
    changed = replaceAsciiMarker(bytes, markerBytes) || changed;
  }

  if (!changed) return blob;
  return new Blob([bytes], { type: blob.type || "application/pdf" });
}

export async function pdfFromLines(lines: string[], title: string) {
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  let page = output.addPage([595, 842]);
  page.drawText(title, { x: 50, y: 800, size: 16, font, color: rgb(0.1, 0.1, 0.1) });
  let cursorY = 775;

  for (const line of lines) {
    if (cursorY < 50) {
      page = output.addPage([595, 842]);
      cursorY = 800;
    }
    page.drawText(line.slice(0, 105), {
      x: 50,
      y: cursorY,
      size: 11,
      font,
      color: rgb(0.16, 0.16, 0.18),
    });
    cursorY -= 16;
  }

  return output.save();
}

export async function htmlContentToPdfBlob(htmlContent: string, extraStyles?: string): Promise<Blob> {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "515px";
  container.style.backgroundColor = "#ffffff";
  container.style.padding = "40px";
  container.style.fontFamily = "Arial, Helvetica, sans-serif";
  container.style.fontSize = "12px";
  container.style.lineHeight = "1.5";
  container.style.color = "#1a1a1a";
  container.innerHTML = htmlContent;

  if (extraStyles) {
    const styleEl = document.createElement("style");
    styleEl.textContent = extraStyles;
    container.prepend(styleEl);
  }

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });

    const pageWidth = 595;
    const pageHeight = 842;
    const scale = pageWidth / canvas.width;
    const canvasPageHeight = pageHeight / scale;

    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
    const totalPages = Math.ceil(canvas.height / canvasPageHeight);

    for (let i = 0; i < totalPages; i += 1) {
      if (i > 0) pdf.addPage();
      const srcY = i * canvasPageHeight;
      const srcH = Math.min(canvasPageHeight, canvas.height - srcY);

      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.ceil(srcH);
      const ctx = slice.getContext("2d")!;
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);

      const imgH = srcH * scale;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidth, imgH);
    }

    return new Blob([new Uint8Array(pdf.output("arraybuffer"))], { type: "application/pdf" });
  } finally {
    if (container.parentNode) document.body.removeChild(container);
  }
}

const PDF_MAX_IMAGE_PAGE_DIMENSION = 14400;
export const A4_PAGE_SIZE_PORTRAIT = { width: 595, height: 842 };

export async function normalizeImageForPdf(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image for PDF conversion.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const preferPng = file.type === "image/png";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (generated) => {
        if (!generated) {
          reject(new Error("Failed to normalize image for PDF conversion."));
          return;
        }
        resolve(generated);
      },
      preferPng ? "image/png" : "image/jpeg",
      preferPng ? undefined : 0.95
    );
  });

  return {
    bytes: await blob.arrayBuffer(),
    mime: blob.type,
    width: canvas.width,
    height: canvas.height,
  };
}

export function clampPdfImageDimensions(width: number, height: number) {
  const scale = Math.min(1, PDF_MAX_IMAGE_PAGE_DIMENSION / width, PDF_MAX_IMAGE_PAGE_DIMENSION / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function fileToPdfImage(pdf: PDFDocument, file: File): Promise<{ image: PDFImage; width: number; height: number }> {
  const lower = file.name.toLowerCase();
  const isJpeg = lower.endsWith(".jpg") || lower.endsWith(".jpeg") || file.type === "image/jpeg";
  const isPng = lower.endsWith(".png") || file.type === "image/png";
  const isWebp = lower.endsWith(".webp") || file.type === "image/webp";

  if (isJpeg || isPng || isWebp) {
    const normalized = await normalizeImageForPdf(file);
    const image =
      normalized.mime === "image/png"
        ? await pdf.embedPng(normalized.bytes)
        : await pdf.embedJpg(normalized.bytes);
    return { image, width: normalized.width, height: normalized.height };
  }

  const bytes = await readAsArrayBuffer(file);
  const image = await pdf.embedJpg(bytes);
  const { width, height } = image.scale(1);
  return { image, width, height };
}

export async function convertMixedFilesToPdf(files: File[]): Promise<{ bytes: Uint8Array; ranges: Array<{ fileIndex: number; fileName: string; start: number; end: number }> }> {
  const output = await PDFDocument.create();
  const ranges: Array<{ fileIndex: number; fileName: string; start: number; end: number }> = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const lower = file.name.toLowerCase();
    const isPdfFile = file.type === "application/pdf" || lower.endsWith(".pdf");
    const isImageFile = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower);

    const start = output.getPageCount();
    if (isPdfFile) {
      const source = await PDFDocument.load(await readAsArrayBuffer(file));
      const copied = await output.copyPages(source, source.getPageIndices());
      copied.forEach((p) => output.addPage(p));
    } else if (isImageFile) {
      const { image, width, height } = await fileToPdfImage(output, file);
      const page = output.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
    } else {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/office-to-pdf", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Could not convert ${file.name}`);
      }
      const pdfBytes = new Uint8Array(await res.arrayBuffer());
      const source = await PDFDocument.load(pdfBytes);
      const copied = await output.copyPages(source, source.getPageIndices());
      copied.forEach((p) => output.addPage(p));
    }
    const end = output.getPageCount();
    if (end > start) {
      ranges.push({ fileIndex, fileName: file.name, start, end });
    }
  }

  if (!output.getPageCount()) {
    throw new Error("Add at least one file to convert.");
  }
  return { bytes: await output.save(), ranges };
}

export async function convertMixedFilesToPdfBytes(files: File[]): Promise<Uint8Array> {
  return (await convertMixedFilesToPdf(files)).bytes;
}

export async function buildMixedFilePageNodes(files: File[]): Promise<MergePageNode[]> {
  const { bytes, ranges } = await convertMixedFilesToPdf(files);
  const thumbs = await renderPdfThumbnails(bytes);
  return thumbs.map((thumb) => {
    const range = ranges.find((r) => thumb.pageNumber > r.start && thumb.pageNumber <= r.end);
    return {
      id: `page-${thumb.pageNumber}-${Math.random().toString(36).slice(2, 7)}`,
      fileIndex: range?.fileIndex ?? 0,
      fileName: range?.fileName ?? "converted.pdf",
      pageIndex: thumb.pageNumber - 1,
      pageNumber: thumb.pageNumber,
      dataUrl: thumb.dataUrl,
    };
  });
}
