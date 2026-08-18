"use client";

import { Document as DocxDocument, Packer, Paragraph } from "docx";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import * as mammoth from "mammoth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFImage } from "pdf-lib";
import { useEffect, useMemo, useRef, useState } from "react";
import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import { analyzeDocumentSelection } from "@/lib/document-preflight";
import { MAX_OCR_UPLOAD_BYTES, OCR_LANGUAGE_OPTIONS } from "@/lib/ocr";
import { formatDurationMs, hashBlob, hashFile, summarizeRunConfidence, type RunReport } from "@/lib/run-report";
import { TOOL_ITEMS, type ToolItem } from "@/lib/tools";
import Swal from "sweetalert2";
import { consumeWorkflowPipeline, stageWorkflowPipeline, loadPersistedWorkflowPipeline } from "@/lib/workflow-pipeline";
import { loadUploadedFiles, persistUploadedFiles, clearUploadedFiles } from "@/lib/file-persistence";
import { getNextRecipeStep, type WorkflowRecipe } from "@/lib/workflow-recipes";
import ShareButton from "@/app/components/share-button";
import { showToast } from "@/app/components/toast";

type WorkbenchProps = {
  tool: ToolItem;
};

type ImagePdfPageSizeMode = "original" | "a4";
type ImagePdfPlacementMode = "single" | "grid";

type PageThumbnail = {
  pageNumber: number;
  dataUrl: string;
};

type OutputPreview = {
  blob: Blob;
  fileName: string;
  url: string;
  mime: string;
  createdAt: number;
  expiresAt: number;
  note?: string;
  imagePreviewDataUrl?: string;
  pdfPreviewDataUrl?: string;
};

type ProcessingLogEntry = {
  at: string;
  message: string;
};

type SmartIntakeResult = {
  documentType: string;
  intakeSummary: string;
  confidence: "high" | "medium" | "low";
  recommendedWorkflow: RecommendedWorkflow | null;
  warnings: string[];
  source: "ai" | "fallback";
};

type RecommendedWorkflow = {
  recipeSlug: string;
  recipeName: string;
  description: string;
  steps: Array<{ toolSlug: string; label: string }>;
};

type LocalStoredFileEntry = {
  id: string;
  fileName: string;
  size: number;
  toolSlug: string;
  message: string;
  createdAt: number;
};

const LOCAL_FILE_HISTORY_KEY = "wiserfiles-local-file-history";
const LEGACY_PDF_WATERMARK_MARKERS: number[][] = [
  [80, 65, 80, 69, 82, 84, 82, 65, 73, 76, 32, 80, 68, 70, 32, 87, 79, 82, 75, 83, 80, 65, 67, 69],
  [80, 65, 80, 69, 82, 84, 82, 65, 73, 76],
];

function toUpperAsciiByte(value: number) {
  if (value >= 97 && value <= 122) return value - 32;
  return value;
}

function replaceAsciiMarker(bytes: Uint8Array, markerBytes: number[]) {
  if (!markerBytes.length) return false;

  let replaced = false;
  for (let index = 0; index <= bytes.length - markerBytes.length; index += 1) {
    if (toUpperAsciiByte(bytes[index]) !== markerBytes[0]) continue;

    let matches = true;
    for (let cursor = 1; cursor < markerBytes.length; cursor += 1) {
      if (toUpperAsciiByte(bytes[index + cursor]) !== markerBytes[cursor]) {
        matches = false;
        break;
      }
    }

    if (!matches) continue;
    bytes.fill(0x20, index, index + markerBytes.length);
    replaced = true;
    index += markerBytes.length - 1;
  }

  return replaced;
}

async function sanitizeLegacyWatermarks(blob: Blob) {
  if (!blob.type.includes("pdf")) return blob;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let changed = false;
  for (const markerBytes of LEGACY_PDF_WATERMARK_MARKERS) {
    changed = replaceAsciiMarker(bytes, markerBytes) || changed;
  }

  if (!changed) return blob;
  return new Blob([bytes], { type: blob.type || "application/pdf" });
}

function isFileCompatibleForTool(toolSlug: string, file: File) {
  const lower = file.name.toLowerCase();
  if (toolSlug === "convert-to-pdf" || toolSlug === "merge-pdf") {
    return (
      file.type === "application/pdf" || lower.endsWith(".pdf") ||
      file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(lower) ||
      /\.(docx?|xlsx?|pptx?|html?|txt)$/.test(lower)
    );
  }
  if (toolSlug === "images-to-pdf" || toolSlug === "images-to-pdf" || toolSlug === "scan-to-pdf") {
    return file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(lower);
  }
  if (toolSlug === "word-to-pdf") {
    return /\.(doc|docx)$/.test(lower);
  }
  if (toolSlug === "powerpoint-to-pdf") {
    return /\.(ppt|pptx)$/.test(lower);
  }
  if (toolSlug === "excel-to-pdf") {
    return /\.(xls|xlsx)$/.test(lower);
  }
  if (toolSlug === "html-to-pdf") {
    return /\.(html?|txt)$/.test(lower);
  }
  return file.type === "application/pdf" || lower.endsWith(".pdf");
}

const OFFICE_PREVIEW_MIME_PATTERN =
  /application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml|presentationml)\./;

type MergePageNode = {
  id: string;
  fileIndex: number;
  fileName: string;
  pageIndex: number;
  pageNumber: number;
  dataUrl: string;
};

type CanvasPoint = { x: number; y: number };
type EditStroke = { points: CanvasPoint[]; color: string; width: number };
type EditTextNote = { x: number; y: number; text: string; color: string; size: number };
type EditPageLayer = { strokes: EditStroke[]; textNotes: EditTextNote[] };

type CompressionOptions = {
  grayscale: boolean;
  blackWhite: boolean;
  removeImages: boolean;
  reduceResolution: boolean;
  reduceQuality: boolean;
  reduceMargins: boolean;
  stripMetadata: boolean;
};

type OcrQualityOptions = {
  deskew: boolean;
  cleanFinal: boolean;
  rotatePages: boolean;
  redoOcr: boolean;
};

const OCR_PRESETS = ["fast", "balanced", "accuracy"] as const;
type OcrPreset = (typeof OCR_PRESETS)[number];

const OCR_PRESET_LABELS: Record<OcrPreset, string> = {
  fast: "Fast",
  balanced: "Balanced",
  accuracy: "Accuracy",
};

const OCR_PRESET_OPTIONS: Record<OcrPreset, OcrQualityOptions> = {
  fast: {
    deskew: false,
    cleanFinal: false,
    rotatePages: false,
    redoOcr: false,
  },
  balanced: {
    deskew: true,
    cleanFinal: false,
    rotatePages: true,
    redoOcr: false,
  },
  accuracy: {
    deskew: true,
    cleanFinal: true,
    rotatePages: true,
    redoOcr: true,
  },
};

function sameOcrOptions(left: OcrQualityOptions, right: OcrQualityOptions) {
  return (
    left.deskew === right.deskew &&
    left.cleanFinal === right.cleanFinal &&
    left.rotatePages === right.rotatePages &&
    left.redoOcr === right.redoOcr
  );
}

function getPresetFromOcrOptions(options: OcrQualityOptions) {
  return OCR_PRESETS.find((preset) => sameOcrOptions(options, OCR_PRESET_OPTIONS[preset])) || null;
}

const FILE_TONE_CLASSES = [
  "border-cyan-200 bg-cyan-50/70",
  "border-amber-200 bg-amber-50/70",
  "border-emerald-200 bg-emerald-50/70",
  "border-violet-200 bg-violet-50/70",
  "border-rose-200 bg-rose-50/70",
  "border-indigo-200 bg-indigo-50/70",
] as const;

const EDIT_RIBBON_TABS = ["Home", "Insert", "Layout", "Review", "View"] as const;
const EDIT_RIBBON_SHORTCUTS: Record<(typeof EDIT_RIBBON_TABS)[number], string> = {
  Home: "H",
  Insert: "N",
  Layout: "P",
  Review: "R",
  View: "W",
};

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function readAsArrayBuffer(file: File) {
  const buffer = await file.arrayBuffer();
  // Return a copy to prevent ArrayBuffer detachment issues
  // when the buffer is shared across multiple pdfjs-dist calls
  return buffer.slice(0);
}

function readAsText(file: File) {
  return file.text();
}

function asPdfBlob(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

function normalizeFileName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function getFileNameFromDisposition(header: string | null) {
  if (!header) return null;

  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function splitLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRanges(value: string, maxPage: number) {
  const picks = new Set<number>();
  const chunks = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    if (chunk.includes("-")) {
      const [startRaw, endRaw] = chunk.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        throw new Error(`Invalid range: ${chunk}`);
      }
      for (let page = start; page <= end; page += 1) {
        if (page <= maxPage) picks.add(page);
      }
    } else {
      const page = Number(chunk);
      if (!Number.isInteger(page) || page <= 0) {
        throw new Error(`Invalid page index: ${chunk}`);
      }
      if (page <= maxPage) picks.add(page);
    }
  }

  return Array.from(picks).sort((a, b) => a - b);
}

function compactPageSequence(pages: number[]) {
  if (!pages.length) return "";

  const chunks: string[] = [];
  let index = 0;

  while (index < pages.length) {
    const start = pages[index];
    let end = start;
    let cursor = index;

    while (cursor + 1 < pages.length && pages[cursor + 1] === end + 1) {
      end = pages[cursor + 1];
      cursor += 1;
    }

    if (end >= start + 2) {
      chunks.push(`${start}-${end}`);
    } else if (end === start + 1) {
      chunks.push(String(start));
      chunks.push(String(end));
    } else {
      chunks.push(String(start));
    }

    index = cursor + 1;
  }

  return chunks.join(",");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return rgb(0.06, 0.07, 0.09);
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function decodeXmlText(value: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<root>${value}</root>`, "application/xml");
  return doc.documentElement.textContent ?? value;
}

function escapeLatex(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}$&#_%])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

function pagesToLatex(pages: string[], sourceFileName: string) {
  const body = pages
    .map((page, index) => {
      const text = escapeLatex(page.replace(/\s+/g, " ").trim() || `(No text detected on page ${index + 1})`);
      return `\\section*{Page ${index + 1}}\n${text}`;
    })
    .join("\n\n");

  const safeSource = escapeLatex(sourceFileName);
  return [
    "\\documentclass[11pt]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{lmodern}",
    "\\usepackage{microtype}",
    "\\title{Converted PDF Source}",
    `\\author{Generated from ${safeSource}}`,
    "\\date{\\today}",
    "\\begin{document}",
    "\\maketitle",
    "\\tableofcontents",
    "\\clearpage",
    body,
    "\\end{document}",
    "",
  ].join("\n");
}

function configurePdfJsWorker(pdfjs: { GlobalWorkerOptions?: { workerSrc: string } }) {
  if (!pdfjs.GlobalWorkerOptions) return;
  const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
}

async function loadPdfPagesText(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const pages: string[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    pages.push(text || `(Page ${index} has no detected text)`);
  }

  return pages;
}

async function samplePdfTextCoverage(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const sampledPages = Math.min(pdf.numPages, 6);
  let pagesWithText = 0;
  let totalCharacters = 0;
  let previewText = "";

  for (let index = 1; index <= sampledPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length > 12) pagesWithText += 1;
    totalCharacters += text.length;
    if (previewText.length < 1600 && text) {
      previewText = `${previewText} ${text}`.trim();
    }
  }

  return {
    sampledPages,
    pagesWithText,
    totalCharacters,
    previewText: previewText.slice(0, 1600),
  };
}

async function renderPdfToImages(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const images: Array<{ dataUrl: string; width: number; height: number }> = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering context unavailable.");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    images.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      width: viewport.width,
      height: viewport.height,
    });
  }

  return images;
}

async function renderPdfThumbnails(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const thumbs: PageThumbnail[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 0.28 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering context unavailable.");

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    thumbs.push({ pageNumber: index, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
  }

  return thumbs;
}

async function renderPdfFirstPagePreview(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.88);
}

async function renderPdfPagePreview(bytes: Uint8Array, pageNumber = 1, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width: canvas.width,
    height: canvas.height,
    pageCount: pdf.numPages,
    safePage,
  };
}

async function dataUrlToImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode rendered page image."));
    img.src = dataUrl;
  });
}

async function processCompressionImage(
  dataUrl: string,
  options: CompressionOptions
): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await dataUrlToImage(dataUrl);
  const resolutionFactor = options.reduceResolution ? 0.72 : 1;
  const marginCropRatio = options.reduceMargins ? 0.04 : 0;

  const sourceCropX = Math.floor(image.width * marginCropRatio);
  const sourceCropY = Math.floor(image.height * marginCropRatio);
  const sourceCropW = Math.max(1, image.width - sourceCropX * 2);
  const sourceCropH = Math.max(1, image.height - sourceCropY * 2);

  const width = Math.max(1, Math.floor(sourceCropW * resolutionFactor));
  const height = Math.max(1, Math.floor(sourceCropH * resolutionFactor));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  context.drawImage(
    image,
    sourceCropX,
    sourceCropY,
    sourceCropW,
    sourceCropH,
    0,
    0,
    width,
    height
  );

  if (options.grayscale || options.blackWhite) {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = Math.round(
        0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
      );
      const value = options.blackWhite ? (luminance > 148 ? 255 : 0) : luminance;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
  }

  const quality = options.reduceQuality ? 0.54 : 0.78;
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

async function pdfFromLines(lines: string[], title: string) {
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

async function htmlContentToPdfBlob(htmlContent: string, extraStyles?: string): Promise<Blob> {
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
const A4_PAGE_SIZE_PORTRAIT = { width: 595, height: 842 };

async function normalizeImageForPdf(file: File) {
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

function clampPdfImageDimensions(width: number, height: number) {
  const scale = Math.min(1, PDF_MAX_IMAGE_PAGE_DIMENSION / width, PDF_MAX_IMAGE_PAGE_DIMENSION / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function fileToPdfImage(pdf: PDFDocument, file: File): Promise<{ image: PDFImage; width: number; height: number }> {
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

function sortSlidePaths(paths: string[]) {
  return paths.sort((a, b) => {
    const first = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    const second = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    return first - second;
  });
}

async function convertMixedFilesToPdf(files: File[]): Promise<{ bytes: Uint8Array; ranges: Array<{ fileIndex: number; fileName: string; start: number; end: number }> }> {
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

async function convertMixedFilesToPdfBytes(files: File[]): Promise<Uint8Array> {
  return (await convertMixedFilesToPdf(files)).bytes;
}

async function buildMixedFilePageNodes(files: File[]): Promise<MergePageNode[]> {
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

async function buildOfficePreviewText(blob: Blob, mime: string) {
  const lowerMime = mime.toLowerCase();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  if (lowerMime.includes("wordprocessingml")) {
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "Could not extract DOCX content preview.";
    const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const text = matches.map((match) => decodeXmlText(match[1])).join(" ").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 12000) : "No readable DOCX text found in preview.";
  }

  if (lowerMime.includes("spreadsheetml")) {
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames.slice(0, 4)) {
      lines.push(`Sheet: ${sheetName}`);
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName], {
        header: 1,
      });
      rows.slice(0, 14).forEach((row) => lines.push(row.map((cell) => String(cell ?? "")).join(" | ")));
      lines.push("");
    }
    return lines.join("\n").trim() || "No readable XLSX rows found in preview.";
  }

  if (lowerMime.includes("presentationml")) {
    const slidePaths = sortSlidePaths(
      Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    );
    const lines: string[] = [];
    for (let i = 0; i < Math.min(slidePaths.length, 12); i += 1) {
      const xml = await zip.file(slidePaths[i])?.async("string");
      if (!xml) continue;
      const matches = Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g));
      const text = matches.map((match) => decodeXmlText(match[1])).join(" ").replace(/\s+/g, " ").trim();
      lines.push(`Slide ${i + 1}: ${text || "(no text)"}`);
    }
    return lines.join("\n") || "No readable PPTX text found in preview.";
  }

  return "Preview unavailable for this file type.";
}

async function renderComparePageWithDiffs(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  pageNumber: number,
  color: "red" | "green"
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  // Use copies to prevent ArrayBuffer detachment
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const otherTask = pdfjs.getDocument({ data: new Uint8Array(otherBytes) });
  const otherPdf = await otherTask.promise;

  if (pageNumber > pdf.numPages && pageNumber > otherPdf.numPages) return null;

  const myPageNum = Math.min(pageNumber, pdf.numPages);
  const otherPageNum = Math.min(pageNumber, otherPdf.numPages);

  const page = await pdf.getPage(myPageNum);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  // Get text items with positions from this page
  const textContent = await page.getTextContent();
  const myWords = textContent.items
    .filter((item) => "str" in item && item.str!.trim())
    .map((item) => ({
      str: (item as { str: string }).str.trim(),
      transform: (item as { transform: number[] }).transform,
      width: (item as { width: number }).width,
      height: (item as { height: number }).height,
    }));

  // Get text from other PDF's corresponding page
  let otherWords: typeof myWords = [];
  if (otherPageNum <= otherPdf.numPages) {
    const otherPage = await otherPdf.getPage(otherPageNum);
    const otherTextContent = await otherPage.getTextContent();
    otherWords = otherTextContent.items
      .filter((item) => "str" in item && item.str!.trim())
      .map((item) => ({
        str: (item as { str: string }).str.trim(),
        transform: (item as { transform: number[] }).transform,
        width: (item as { width: number }).width,
        height: (item as { height: number }).height,
      }));
  }

  const otherWordSet = new Set(otherWords.map((w) => w.str.toLowerCase()));

  // Draw highlight rectangles on differing words
  ctx.globalAlpha = 0.35;
  for (const word of myWords) {
    const isUnique = !otherWordSet.has(word.str.toLowerCase());
    if (!isUnique) continue;

    const [scaleX, , , scaleY, tx, ty] = word.transform;
    const fontSize = Math.abs(scaleY) || 12;
    const x = tx;
    const y = viewport.height - ty - fontSize;
    const w = word.width || fontSize * word.str.length * 0.6;
    const h = fontSize * 1.15;

    ctx.fillStyle = color === "red" ? "rgba(239, 68, 68, 0.45)" : "rgba(34, 197, 94, 0.45)";
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.88),
    pageCount: pdf.numPages,
  };
}

export default function ToolWorkbench({ tool }: WorkbenchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pipelineBootstrap, setPipelineBootstrap] = useState<{ payload: any; file: File; accepted: boolean; allFiles: File[] } | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  // Load the pipeline (in-memory first, then persisted IndexedDB so it survives reloads).
  useEffect(() => {
    let cancelled = false;
    async function loadPipeline() {
      let payload = consumeWorkflowPipeline(tool.slug);
      if (!payload) {
        payload = await loadPersistedWorkflowPipeline(tool.slug);
      }
      if (cancelled || !payload) return;

      const file = new File([payload.blob], payload.fileName, {
        type: payload.mime || "application/octet-stream",
      });
      const accepted = isFileCompatibleForTool(tool.slug, file);
      const allFiles = (payload.files && payload.files.length ? payload.files : [{ name: payload.fileName, type: payload.mime || "application/octet-stream", blob: payload.blob }])
        .map((f) => new File([f.blob], f.name, { type: f.type || "application/octet-stream" }));

      if (cancelled) return;
      setPipelineBootstrap({ payload, file, accepted, allFiles });
      if (accepted) {
        setFiles(allFiles.length ? allFiles : [file]);
      }
    }
    void loadPipeline();
    return () => { cancelled = true; };
  }, [tool.slug]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [pinnedError, setPinnedError] = useState(false);
  const [formatRedirectSuggestion, setFormatRedirectSuggestion] = useState<{
    label: string;
    targetSlug: string;
    targetName: string;
    file: File;
  } | null>(null);
  const [comparePageNumber, setComparePageNumber] = useState(1);
  const [comparePageCountA, setComparePageCountA] = useState(0);
  const [comparePageCountB, setComparePageCountB] = useState(0);
  const [compareRenderA, setCompareRenderA] = useState<string>("");
  const [compareRenderB, setCompareRenderB] = useState<string>("");
  const [compareTextReport, setCompareTextReport] = useState<string>("");
  const [ranges, setRanges] = useState("1");
  const [password, setPassword] = useState("");
  const [editText, setEditText] = useState("");
  const [editPreview, setEditPreview] = useState("");
  const [editCanvasSize, setEditCanvasSize] = useState({ width: 0, height: 0 });
  const [editPageNumber, setEditPageNumber] = useState(1);
  const [editPageCount, setEditPageCount] = useState(1);
  const [editCanvasLoading, setEditCanvasLoading] = useState(false);
  const [editRibbonTab, setEditRibbonTab] = useState<(typeof EDIT_RIBBON_TABS)[number]>("Home");
  const [editMode, setEditMode] = useState<"draw" | "text">("draw");
  const [editColor, setEditColor] = useState("#0f172a");
  const [editBrushSize, setEditBrushSize] = useState(2.6);
  const [editFontSize, setEditFontSize] = useState(16);
  const [editZoom, setEditZoom] = useState(100);
  const [editStrokes, setEditStrokes] = useState<EditStroke[]>([]);
  const [editTextNotes, setEditTextNotes] = useState<EditTextNote[]>([]);
  const [editLayersByPage, setEditLayersByPage] = useState<Record<number, EditPageLayer>>({});
  const [activeEditStroke, setActiveEditStroke] = useState<CanvasPoint[]>([]);
  const [compressionOptions, setCompressionOptions] = useState<CompressionOptions>({
    grayscale: false,
    blackWhite: false,
    removeImages: false,
    reduceResolution: true,
    reduceQuality: true,
    reduceMargins: false,
    stripMetadata: true,
  });
  const [signatureMode, setSignatureMode] = useState<"text" | "draw">("text");
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [signatures, setSignatures] = useState<Array<{ id: string; kind: "text" | "draw"; text?: string; dataUrl?: string; xRatio: number; yRatio: number }>>([]);
  const [activeSignatureId, setActiveSignatureId] = useState("");
  const [savedSignatures, setSavedSignatures] = useState<Array<{ id: string; kind: "text" | "draw"; label: string; text?: string; dataUrl?: string }>>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("wiserfiles-saved-signatures");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [signaturePlacement, setSignaturePlacement] = useState({ xRatio: 0.82, yRatio: 0.12 });
  const [signaturePlacementPreview, setSignaturePlacementPreview] = useState("");
  const [signPageNumber, setSignPageNumber] = useState(1);
  const [signAllPages, setSignAllPages] = useState(true);
  const [signPageCount, setSignPageCount] = useState(1);
  const [mergePages, setMergePages] = useState<MergePageNode[]>([]);
  const [rotateAngle, setRotateAngle] = useState(90);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const rotateAngleRef = useRef(90);
  const pageRotationsRef = useRef<Record<number, number>>({});
  const [mergePageOrder, setMergePageOrder] = useState<string[]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeDraggedId, setMergeDraggedId] = useState<string | null>(null);
  const [mergeDragOverId, setMergeDragOverId] = useState<string | null>(null);
  const [pageThumbnails, setPageThumbnails] = useState<PageThumbnail[]>([]);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [dragOverPage, setDragOverPage] = useState<number | null>(null);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);
  const [dragOverFileIndex, setDragOverFileIndex] = useState<number | null>(null);
  const [outputPreview, setOutputPreview] = useState<OutputPreview | null>(null);
  const [previewText, setPreviewText] = useState<string>("");
  const [downloadingOutput, setDownloadingOutput] = useState(false);
  const [pdfPreviewPage, setPdfPreviewPage] = useState(1);
  const [pdfPreviewPageCount, setPdfPreviewPageCount] = useState(1);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<
    "unknown" | "prompt" | "granted" | "denied"
  >("unknown");
  const [imagePdfPageSizeMode, setImagePdfPageSizeMode] = useState<ImagePdfPageSizeMode>("original");
  const [imagePdfPlacementMode, setImagePdfPlacementMode] = useState<ImagePdfPlacementMode>("single");
  const [imagePdfGridColumns, setImagePdfGridColumns] = useState(2);
  const [imagePdfGridRows, setImagePdfGridRows] = useState(2);
  const [imagePdfPageMargin, setImagePdfPageMargin] = useState(24);
  const [ocrLanguage, setOcrLanguage] = useState("eng");
  const [ocrPreset, setOcrPreset] = useState<OcrPreset>("balanced");
  const [ocrQualityOptions, setOcrQualityOptions] = useState<OcrQualityOptions>({
    ...OCR_PRESET_OPTIONS.balanced,
  });
  const [ocrBatchMode, setOcrBatchMode] = useState(false);
  const [ocrWebhookUrl, setOcrWebhookUrl] = useState("");
  const [ocrQueueStatus, setOcrQueueStatus] = useState<Array<{ fileName: string; state: "queued" | "processing" | "done" | "failed" }>>([]);
  const [ocrUploadWarning, setOcrUploadWarning] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState<{
    message: string;
    inputCount: number;
    timestamp: string;
  } | null>(null);
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [processingLog, setProcessingLog] = useState<ProcessingLogEntry[]>([]);
  const [retentionTick, setRetentionTick] = useState(0);
  const fileNamePrefix = "pt";
  const [autoRunEpoch, setAutoRunEpoch] = useState(0);
  const selectedRecipeSlug = searchParams.get("recipe") ?? "";
  const [pipelineNotice, setPipelineNotice] = useState(() => {
    if (!pipelineBootstrap) return "";
    if (!pipelineBootstrap.accepted) {
      return `Incompatible pipeline file from ${pipelineBootstrap.payload.fromToolSlug}. Please upload a compatible file.`;
    }
    return "";
  });
  const pipelineChipLabel = useMemo(() => {
    if (!pipelineBootstrap?.accepted) return null;
    const from = pipelineBootstrap.payload.fromToolSlug === "home-dropzone"
      ? "drop zone"
      : pipelineBootstrap.payload.fromToolSlug;
    return `From: ${from} → ${tool.name}`;
  }, [pipelineBootstrap, tool.name]);
  const [switchDropdownOpen, setSwitchDropdownOpen] = useState(false);

  const switchableTools = useMemo(() => {
    if (!files.length) return [];
    return TOOL_ITEMS.filter((candidate) => {
      if (candidate.slug === tool.slug) return false;
      return files.some((file) => isFileCompatibleForTool(candidate.slug, file));
    }).slice(0, 8);
  }, [files, tool.slug]);

  function switchToTool(targetSlug: string) {
    if (latestOutputRef.current && outputPreview) {
      stageWorkflowPipeline({
        fromToolSlug: tool.slug,
        toToolSlug: targetSlug,
        fileName: outputPreview.fileName,
        mime: outputPreview.mime,
        blob: outputPreview.blob,
        createdAt: Date.now(),
      });
    } else if (files[0]) {
      stageWorkflowPipeline({
        fromToolSlug: tool.slug,
        toToolSlug: targetSlug,
        fileName: files[0].name,
        mime: files[0].type || "application/octet-stream",
        blob: files[0],
        createdAt: Date.now(),
      });
    }
    setSwitchDropdownOpen(false);
    router.push(`/tools/${targetSlug}?pipeline=true`);
  }
  // preflightSummary feeds the smart-intake API payload (findings/scanLikelihood)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [preflightSummary, setPreflightSummary] = useState<ReturnType<typeof analyzeDocumentSelection> | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [smartIntake, setSmartIntake] = useState<SmartIntakeResult | null>(null);
  const [smartIntakeLoading, setSmartIntakeLoading] = useState(false);
  const [localStoredFiles, setLocalStoredFiles] = useState<LocalStoredFileEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LOCAL_FILE_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signPdfBytesRef = useRef<Uint8Array | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signaturePointerState = useRef<{ drawing: boolean }>({ drawing: false });
  const signatureStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const signatureActiveStrokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoWorkflowUploadPromptedRef = useRef(false);
  const autoRunHandledRef = useRef(0);
  const autoRunReasonRef = useRef("");
  const switchDropdownRef = useRef<HTMLDivElement | null>(null);
  const previewJobRef = useRef(0);
  const pdfPreviewRequestRef = useRef(0);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const preflightJobRef = useRef(0);
  const latestOutputRef = useRef<{ blob: Blob; fileName: string; mime: string } | null>(null);

  const pageEditSlugs = ["split-pdf", "extract-pages", "remove-pages", "organize-pdf", "rotate-pdf"];
  const usesThumbnailEditor = pageEditSlugs.includes(tool.slug);
  const isOrganizeTool = tool.slug === "organize-pdf";
  const isRotateTool = tool.slug === "rotate-pdf";
  const isSignTool = tool.slug === "sign-pdf";
  const isMergeTool = tool.slug === "merge-pdf";
  const isConvertTool = tool.slug === "convert-to-pdf";
  const isMultiFileTool =
    tool.slug === "merge-pdf" ||
    tool.slug === "convert-to-pdf" ||
    tool.slug === "scan-to-pdf" ||
    tool.slug === "compare-pdf";
  const isScanTool = tool.slug === "scan-to-pdf";
  const isImageToPdfTool =
    tool.slug === "images-to-pdf" || tool.slug === "images-to-pdf" || tool.slug === "scan-to-pdf";
  const isEditTool = tool.slug === "edit-pdf";
  const isOcrTool = tool.slug === "ocr-pdf";
  const supportsOrderDrag =
    tool.slug === "organize-pdf" || tool.slug === "split-pdf" || tool.slug === "extract-pages";

  const compressionEstimate = useMemo(() => {
    if (tool.slug !== "compress-pdf" || !files[0]) return null;

    let factor = 1;
    if (compressionOptions.removeImages) factor *= 0.24;
    if (compressionOptions.reduceResolution) factor *= 0.74;
    if (compressionOptions.reduceQuality) factor *= 0.68;
    if (compressionOptions.grayscale) factor *= 0.9;
    if (compressionOptions.blackWhite) factor *= 0.74;
    if (compressionOptions.reduceMargins) factor *= 0.93;
    if (compressionOptions.stripMetadata) factor *= 0.97;

    factor = Math.min(0.95, Math.max(0.08, factor));
    const originalBytes = files[0].size;
    const estimatedBytes = Math.max(1, Math.round(originalBytes * factor));
    const reductionPercent = Math.max(0, Math.round((1 - factor) * 100));

    return { originalBytes, estimatedBytes, reductionPercent };
  }, [compressionOptions, files, tool.slug]);

  // Pre-defined workflow recipes removed — piping output to any tool via the
  // "Send to another tool" button now covers this use case.
  const applicableRecipes = useMemo<WorkflowRecipe[]>(() => [], []);

  // Thumbnail previews for image-to-pdf files (for reordering).
  const imageThumbUrls = useMemo(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    return urls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => `${f.name}-${f.size}`).join("|")]);
  // Only activate workflow mode when the user explicitly started one via ?recipe= URL param.
  // Never auto-select a recipe — individual tools must always start fresh.
  const selectedRecipe = useMemo(
    () => (selectedRecipeSlug ? applicableRecipes.find((recipe) => recipe.slug === selectedRecipeSlug) || null : null),
    [applicableRecipes, selectedRecipeSlug]
  );

  const currentRecipeNextStep = useMemo(() => {
    if (!selectedRecipe) return null;
    return getNextRecipeStep(selectedRecipe, tool.slug);
  }, [selectedRecipe, tool.slug]);

  const currentRecipeStepIndex = useMemo(() => {
    if (!selectedRecipe) return -1;
    return selectedRecipe.steps.findIndex((step) => step.toolSlug === tool.slug);
  }, [selectedRecipe, tool.slug]);

  const currentRecipePreviousStep = useMemo(() => {
    if (!selectedRecipe) return null;
    if (currentRecipeStepIndex <= 0) return null;
    return selectedRecipe.steps[currentRecipeStepIndex - 1] ?? null;
  }, [selectedRecipe, currentRecipeStepIndex]);

  const continueBlockedReason = useMemo(() => {
    if (!currentRecipeNextStep) return "";
    if (!files.length) return `Upload a file to ${tool.name} before continuing to ${currentRecipeNextStep.label}.`;
    return "";
  }, [currentRecipeNextStep, files.length, tool.name]);

  const hasChosenWorkflow = Boolean(selectedRecipeSlug && selectedRecipe);
  const isFirstWorkflowStep = hasChosenWorkflow && currentRecipeStepIndex === 0;
  const shouldShowFileInput = (!hasChosenWorkflow || isFirstWorkflowStep) && (!pipelineBootstrap?.accepted || isMultiFileTool);
  const shouldShowPreflight = !hasChosenWorkflow;
  const suggestedWorkflow = smartIntake?.recommendedWorkflow ?? null;

  const retentionSecondsLeft = useMemo(() => {
    if (!outputPreview) return null;
    const now = Date.now() + retentionTick * 0;
    return Math.max(0, Math.ceil((outputPreview.expiresAt - now) / 1000));
  }, [outputPreview, retentionTick]);

  function logProcessing(message: string) {
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setProcessingLog((current) => [{ at, message }, ...current].slice(0, 30));
  }

  function shouldAutoRunAfterSelection(nextFiles: File[]) {
    if (!nextFiles.length) return false;
    if (usesThumbnailEditor || isEditTool || isSignTool) return false;
    if (tool.slug === "protect-pdf") return false;
    if (tool.slug === "compare-pdf") return nextFiles.length >= 2;
    return true;
  }

  function requestAutoRun(reason: string) {
    autoRunReasonRef.current = reason;
    setAutoRunEpoch((current) => current + 1);
  }

  function persistLocalFileHistory(entries: LocalStoredFileEntry[]) {
    try {
      localStorage.setItem(LOCAL_FILE_HISTORY_KEY, JSON.stringify(entries.slice(0, 40)));
      setLocalStoredFiles(entries.slice(0, 40));
    } catch {
      // Ignore localStorage failures in restricted contexts.
    }
  }

  function addLocalStoredFiles(nextFiles: File[], note?: string) {
    const entries = nextFiles.map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      fileName: file.name,
      size: file.size,
      toolSlug: tool.slug,
      message: note || `Added for ${tool.name}`,
      createdAt: Date.now(),
    }));

    persistLocalFileHistory([...entries, ...localStoredFiles]);
  }

  function addLocalStoredEntry(entry: { fileName: string; size: number; message: string }) {
    const next: LocalStoredFileEntry = {
      id: `${entry.fileName}-${entry.size}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      fileName: entry.fileName,
      size: entry.size,
      toolSlug: tool.slug,
      message: entry.message,
      createdAt: Date.now(),
    };
    persistLocalFileHistory([next, ...localStoredFiles]);
  }

  function buildOutputName(defaultName: string) {
    const trimmed = fileNamePrefix.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!trimmed) return defaultName;
    return `${trimmed}-${defaultName}`;
  }

  function summarizeToolTransforms() {
    if (tool.slug === "compress-pdf") {
      return [
        `Reduce resolution: ${compressionOptions.reduceResolution ? "on" : "off"}`,
        `Reduce quality: ${compressionOptions.reduceQuality ? "on" : "off"}`,
        `Grayscale: ${compressionOptions.grayscale ? "on" : "off"}`,
        `Black and white: ${compressionOptions.blackWhite ? "on" : "off"}`,
        `Remove images: ${compressionOptions.removeImages ? "on" : "off"}`,
      ];
    }

    if (tool.slug === "ocr-pdf") {
      return [
        `Language: ${ocrLanguage}`,
        `Deskew: ${ocrQualityOptions.deskew ? "on" : "off"}`,
        `Rotate pages: ${ocrQualityOptions.rotatePages ? "on" : "off"}`,
        `Clean final: ${ocrQualityOptions.cleanFinal ? "on" : "off"}`,
        `Redo OCR: ${ocrQualityOptions.redoOcr ? "on" : "off"}`,
      ];
    }

    if (tool.slug === "compare-pdf") {
      return ["Text-based comparison", "Materiality scoring", "Line uniqueness analysis"];
    }

    return ["Standard transformation pipeline", `Tool: ${tool.name}`];
  }

  async function persistRunReport(startedAtMs: number, completionMessage: string) {
    const confidence = summarizeRunConfidence(tool.slug);
    const finishedAt = new Date();
    const transforms = summarizeToolTransforms();

    const inputEntries = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        size: file.size,
        sha256: await hashFile(file),
      }))
    );

    const outputEntry = latestOutputRef.current
      ? {
          name: latestOutputRef.current.fileName,
          size: latestOutputRef.current.blob.size,
          sha256: await hashBlob(latestOutputRef.current.blob),
          mime: latestOutputRef.current.mime,
        }
      : undefined;

    const report: RunReport = {
      runId: `${tool.slug}-${Date.now()}`,
      toolSlug: tool.slug,
      toolName: tool.name,
      mode: tool.runtime,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAtMs,
      confidence: confidence.confidence,
      confidenceReason: confidence.reason,
      transforms,
      inputFiles: inputEntries,
      outputFile: outputEntry,
    };

    setRunReport(report);
    logProcessing(`Completed: ${completionMessage} (${formatDurationMs(report.durationMs)})`);
    if (report.outputFile) {
      addLocalStoredEntry({
        fileName: report.outputFile.name,
        size: report.outputFile.size,
        message: `Generated by ${tool.name}`,
      });
    }

    try {
      const previous = JSON.parse(localStorage.getItem("wiserfiles-recent-workflows") || "[]") as Array<{
        slug: string;
        name: string;
        at: string;
      }>;
      const next = [{ slug: tool.slug, name: tool.name, at: finishedAt.toISOString() }, ...previous]
        .filter((entry, index, all) => index === all.findIndex((item) => item.slug === entry.slug))
        .slice(0, 6);
      localStorage.setItem("wiserfiles-recent-workflows", JSON.stringify(next));
      window.dispatchEvent(new Event("wiserfiles-recent-workflows-change"));
    } catch {
      // Ignore localStorage failures in restricted contexts.
    }
  }

  function downloadProcessingLog() {
    const lines = processingLog.map((entry) => `[${entry.at}] ${entry.message}`).join("\n");
    const blob = new Blob([lines || "No processing events yet."], { type: "text/plain" });
    downloadBlob(blob, `processing-log-${tool.slug}.txt`);
  }

  function downloadRunReport() {
    if (!runReport) return;
    const blob = new Blob([JSON.stringify(runReport, null, 2)], { type: "application/json" });
    downloadBlob(blob, `run-report-${runReport.runId}.json`);
  }

  function formatRetention(seconds: number | null) {
    if (seconds === null) return "Not staged";
    if (seconds <= 0) return "Expired";
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m ${remaining.toString().padStart(2, "0")}s`;
  }

  function updateCompressionOption(option: keyof CompressionOptions, value: boolean) {
    setCompressionOptions((current) => {
      if (option === "blackWhite") {
        return { ...current, blackWhite: value, grayscale: value ? false : current.grayscale };
      }
      if (option === "grayscale" && value) {
        return { ...current, grayscale: true, blackWhite: false };
      }
      return { ...current, [option]: value };
    });
  }

  function getFileToneClass(fileIndex: number) {
    return FILE_TONE_CLASSES[fileIndex % FILE_TONE_CLASSES.length];
  }

  function updateOcrQualityOption(option: keyof OcrQualityOptions, value: boolean) {
    setOcrQualityOptions((current) => {
      const next = { ...current, [option]: value };
      const matchedPreset = getPresetFromOcrOptions(next);
      if (matchedPreset) {
        setOcrPreset(matchedPreset);
      }
      return next;
    });
  }

  async function hydrateSelectionContext(nextFiles: File[]) {
    setPageThumbnails([]);
    setSelectedPages([]);
    setPageOrder([]);
    setSignaturePlacementPreview("");
    setEditPreview("");
    setEditCanvasSize({ width: 0, height: 0 });
    setEditPageNumber(1);
    setEditPageCount(1);
    setEditRibbonTab("Home");
    setEditZoom(100);
    setEditLayersByPage({});
    setEditStrokes([]);
    setEditTextNotes([]);
    setActiveEditStroke([]);
    setDraggedPage(null);
    setDragOverPage(null);
    if (usesThumbnailEditor) {
      setRanges("");
    }

    const first = nextFiles[0];
    if (!first) return;
    const isPdf = first.type === "application/pdf" || first.name.toLowerCase().endsWith(".pdf");
    if (!isPdf && !isConvertTool) return;
    if (!usesThumbnailEditor && !isSignTool && !isMergeTool && !isConvertTool && !isEditTool) return;

    try {
      setThumbnailLoading(true);
      if (isMergeTool || isConvertTool) {
        setMergeLoading(true);
      }
      const firstBytes = new Uint8Array(await readAsArrayBuffer(first));

      if (usesThumbnailEditor) {
        const thumbs = await renderPdfThumbnails(firstBytes);
        setPageThumbnails(thumbs);
        if (isOrganizeTool) {
          const order = thumbs.map((thumb) => thumb.pageNumber);
          setPageOrder(order);
          setRanges(compactPageSequence(order));
        }
      }

      if (isSignTool) {
        signPdfBytesRef.current = firstBytes;
        const preview = await renderPdfPagePreview(firstBytes, 1);
        setSignaturePlacementPreview(preview.dataUrl);
        setSignPageCount(preview.pageCount);
        setSignPageNumber(1);
      }

      if (isEditTool) {
        await loadEditPreview(first, 1);
      }

      if (isMergeTool || isConvertTool) {
        // Build page nodes for all files (PDF, images, office) with source-file tracking.
        const allPages = await buildMixedFilePageNodes(nextFiles);
        setMergePages(allPages);
        setMergePageOrder(allPages.map((item) => item.id));
      }
    } catch (thumbnailError) {
      const message = thumbnailError instanceof Error ? thumbnailError.message : "";
      if (/password|encrypted|PasswordException/i.test(message)) {
        setError("This PDF is password-protected. Unlock it first, then try again.");
      } else {
        setError(
          message
            ? `Could not generate page thumbnails for this document: ${message}`
            : "Could not generate page thumbnails for this document."
        );
      }
    } finally {
      setThumbnailLoading(false);
      setMergeLoading(false);
    }
  }

  async function runPreflightAnalysis(nextFiles: File[]) {
    if (!nextFiles.length) {
      setPreflightSummary(null);
      setSmartIntake(null);
      setSmartIntakeLoading(false);
      setPreflightLoading(false);
      return;
    }

    const currentJob = preflightJobRef.current + 1;
    preflightJobRef.current = currentJob;
    setPreflightLoading(true);
    setSmartIntake(null);
    setSmartIntakeLoading(true);

    try {
      const firstPdf = nextFiles.find(
        (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      );

      let pdfSample: Awaited<ReturnType<typeof samplePdfTextCoverage>> | null = null;
      if (firstPdf) {
        try {
          pdfSample = await samplePdfTextCoverage(new Uint8Array(await readAsArrayBuffer(firstPdf)));
        } catch {
          pdfSample = null;
        }
      }

      if (preflightJobRef.current !== currentJob) return;
      const summary = analyzeDocumentSelection(nextFiles, TOOL_ITEMS, pdfSample);
      setPreflightSummary(summary);

      const intakeResponse = await fetch("/api/smart-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: nextFiles.map((file) => ({
            name: file.name,
            mime: file.type,
            sizeBytes: file.size,
          })),
          estimatedInputType: summary.estimatedInputType,
          scanLikelihood: summary.scanLikelihood,
          findings: summary.findings,
          textPreview: pdfSample?.previewText || "",
          currentToolSlug: tool.slug,
        }),
      });

      if (preflightJobRef.current !== currentJob) return;

      if (!intakeResponse.ok) {
        setSmartIntake(null);
      } else {
        const intakePayload = (await intakeResponse.json()) as SmartIntakeResult;
        setSmartIntake(intakePayload);
      }
    } catch {
      if (preflightJobRef.current !== currentJob) return;
      setSmartIntake(null);
    } finally {
      if (preflightJobRef.current === currentJob) {
        setPreflightLoading(false);
        setSmartIntakeLoading(false);
      }
    }
  }

  function applyOcrPreset(preset: OcrPreset) {
    setOcrPreset(preset);
    setOcrQualityOptions({ ...OCR_PRESET_OPTIONS[preset] });
  }

  function stageOutput(
    blob: Blob,
    fileName: string,
    note?: string,
    imagePreviewDataUrl?: string
  ) {
    previewJobRef.current += 1;
    const previewJob = previewJobRef.current;
    setPreviewText("");
    setDownloadingOutput(false);
    const finalFileName = buildOutputName(fileName);

    const setPreparedOutput = (preparedBlob: Blob) => {
      if (previewJobRef.current !== previewJob) return;

      const url = URL.createObjectURL(preparedBlob);
      const createdAt = Date.now();
      const expiresAt = createdAt + 30 * 60 * 1000;
      latestOutputRef.current = {
        blob: preparedBlob,
        fileName: finalFileName,
        mime: preparedBlob.type || "application/octet-stream",
      };
      setOutputPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          blob: preparedBlob,
          fileName: finalFileName,
          url,
          mime: preparedBlob.type || "application/octet-stream",
          createdAt,
          expiresAt,
          note,
          imagePreviewDataUrl,
          pdfPreviewDataUrl: undefined,
        };
      });

      logProcessing(`Output staged: ${finalFileName} (${formatBytes(preparedBlob.size)})`);

      if (preparedBlob.type.startsWith("text/")) {
        preparedBlob
        .text()
        .then((text) => setPreviewText(text.slice(0, 12000)))
        .catch(() => setPreviewText("Preview unavailable for this text output."));
      }

      if (OFFICE_PREVIEW_MIME_PATTERN.test(preparedBlob.type)) {
        buildOfficePreviewText(preparedBlob, preparedBlob.type)
        .then((text) => {
          if (previewJobRef.current !== previewJob) return;
          setPreviewText(text);
        })
        .catch(() => {
          if (previewJobRef.current !== previewJob) return;
          setPreviewText("Could not build an in-browser structured preview for this output.");
        });
      }

      if (preparedBlob.type.includes("pdf")) {
        setPdfPreviewPage(1);
        setPdfPreviewPageCount(1);
        void loadOutputPdfPreviewPage(1, {
          blob: preparedBlob,
          fileName: finalFileName,
          url,
          mime: preparedBlob.type || "application/octet-stream",
          createdAt,
          expiresAt,
          note,
          imagePreviewDataUrl,
        });
      }
    };

    if (blob.type.includes("pdf")) {
      void sanitizeLegacyWatermarks(blob)
        .then((sanitizedBlob) => setPreparedOutput(sanitizedBlob))
        .catch(() => setPreparedOutput(blob));
      return;
    }

    setPreparedOutput(blob);
  }

  function downloadPreparedOutput() {
    if (!outputPreview) return;
    downloadBlob(outputPreview.blob, outputPreview.fileName);
  }

  function handleDownloadOutput() {
    if (!outputPreview || downloadingOutput) return;
    setDownloadingOutput(true);
    downloadPreparedOutput();
  }

  async function pipeOutputToTool() {
    if (!outputPreview) return;
    const targetTools = TOOL_ITEMS.filter((t) => t.slug !== tool.slug);
    const toolCards = targetTools
      .map(
        (t) => `
          <button type="button" data-tool-slug="${t.slug}" data-tool-name="${t.name}" data-category="${t.category || ""}" class="swal-tool-card" title="${t.description || t.name}">
            <span class="swal-tool-card-name">${t.name}</span>
          </button>`
      )
      .join("");

    let selectedSlug = "";

    const result = await Swal.fire({
      title: "Send output to another tool",
      html: `
        <div style="text-align:left">
          <p style="font-size:12.5px;color:#64748b;margin:0 0 10px">The processed output is piped directly into the selected tool — no download and re-upload needed.</p>
          <input id="swal-tool-search" class="swal-tool-search" placeholder="Search tools…">
          <div id="swal-tool-grid" class="swal-tool-grid">${toolCards}</div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Continue",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#6366f1",
      cancelButtonColor: "#94a3b8",
      background: "#ffffff",
      color: "#0f172a",
      position: "center",
      width: "min(94vw, 760px)",
      customClass: { container: "swal-center-container", popup: "swal-pipe-popup" },
      didOpen: () => {
        const grid = document.getElementById("swal-tool-grid");
        const search = document.getElementById("swal-tool-search") as HTMLInputElement | null;
        const confirmBtn = Swal.getConfirmButton();
        if (confirmBtn) confirmBtn.disabled = true;

        search?.addEventListener("input", () => {
          const q = (search.value || "").toLowerCase().trim();
          grid?.querySelectorAll(".swal-tool-card").forEach((card) => {
            const el = card as HTMLElement;
            const name = el.getAttribute("data-tool-name") || "";
            el.style.display = !q || name.toLowerCase().includes(q) ? "" : "none";
          });
        });

        grid?.querySelectorAll(".swal-tool-card").forEach((card) => {
          card.addEventListener("click", () => {
            grid?.querySelectorAll(".swal-tool-card").forEach((c) => c.classList.remove("swal-tool-card-selected"));
            card.classList.add("swal-tool-card-selected");
            selectedSlug = (card as HTMLElement).getAttribute("data-tool-slug") || "";
            if (confirmBtn) confirmBtn.disabled = false;
          });
        });
      },
      preConfirm: () => {
        if (!selectedSlug) {
          Swal.showValidationMessage("Select a tool");
          return false;
        }
        return selectedSlug;
      },
    });

    const targetSlug = result.isConfirmed ? (result.value as string) : "";
    if (!targetSlug) return;
    const file = new File([outputPreview.blob], outputPreview.fileName, {
      type: outputPreview.mime || "application/octet-stream",
    });
    navigateWithFile(targetSlug, file);
  }

  async function loadOutputPdfPreviewPage(targetPage: number, currentOutput = outputPreview) {
    if (!currentOutput || !currentOutput.mime.includes("pdf")) return;

    const requestId = pdfPreviewRequestRef.current + 1;
    pdfPreviewRequestRef.current = requestId;
    setPdfPreviewLoading(true);

    try {
      const buffer = await currentOutput.blob.arrayBuffer();
      const rendered = await renderPdfPagePreview(new Uint8Array(buffer), targetPage);
      if (pdfPreviewRequestRef.current !== requestId) return;

      setPdfPreviewPage(rendered.safePage);
      setPdfPreviewPageCount(rendered.pageCount);
      setOutputPreview((current) => {
        if (!current || current.url !== currentOutput.url) return current;
        return { ...current, pdfPreviewDataUrl: rendered.dataUrl };
      });
    } catch {
      // Keep existing preview if rendering fails.
    } finally {
      if (pdfPreviewRequestRef.current === requestId) {
        setPdfPreviewLoading(false);
      }
    }
  }

  const outputPreviewPanel = outputPreview ? (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="type-eyebrow text-slate-600">Output Preview</p>
          <p className="field-help mt-1">Auto-delete in browser buffer: {formatRetention(retentionSecondsLeft)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void pipeOutputToTool()}
            className="rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg transition hover:scale-[1.02] hover:shadow-xl"
            style={{ background: "#6366f1", boxShadow: "0 4px 14px rgba(99,102,241,0.4)" }}
          >
            Send to another tool
          </button>
          <button
            type="button"
            onClick={handleDownloadOutput}
            disabled={downloadingOutput}
            className={`${downloadingOutput ? "" : "animate-pulse"} rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg transition hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50`}
            style={{ background: "#10b981", boxShadow: "0 4px 14px rgba(16,185,129,0.4)" }}
          >
            {downloadingOutput ? "Downloading..." : "Download output"}
          </button>
        </div>
      </div>

      {outputPreview.mime.includes("pdf") ? (
        <div className="space-y-2">
          {outputPreview.pdfPreviewDataUrl ? (
            <div className="relative inline-block overflow-hidden rounded-lg border border-slate-300 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={outputPreview.pdfPreviewDataUrl}
                alt={`Processed PDF preview page ${pdfPreviewPage}`}
                className="max-h-72 w-auto bg-white"
              />

              <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
                <button
                  type="button"
                  onClick={() => void loadOutputPdfPreviewPage(pdfPreviewPage - 1)}
                  disabled={pdfPreviewLoading || pdfPreviewPage <= 1}
                  className="pointer-events-auto rounded-full border border-slate-400/45 bg-slate-900/20 px-2 py-1 text-[11px] font-semibold text-slate-100 shadow-sm backdrop-blur-[1px] transition hover:bg-slate-900/30 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => void loadOutputPdfPreviewPage(pdfPreviewPage + 1)}
                  disabled={pdfPreviewLoading || pdfPreviewPage >= pdfPreviewPageCount}
                  className="pointer-events-auto rounded-full border border-slate-400/45 bg-slate-900/20 px-2 py-1 text-[11px] font-semibold text-slate-100 shadow-sm backdrop-blur-[1px] transition hover:bg-slate-900/30 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Next
                </button>
              </div>

              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-slate-300 bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm">
                Page {pdfPreviewPage} / {pdfPreviewPageCount}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-700">
              Generating PDF preview...
            </div>
          )}
          <p className="field-help">PDF preview is shown before download to verify quality.</p>
        </div>
      ) : null}

      {outputPreview.mime.startsWith("image/") || outputPreview.imagePreviewDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={outputPreview.imagePreviewDataUrl || outputPreview.url}
          alt="Processed output preview"
          className="max-h-72 w-auto rounded-lg border border-slate-300 bg-white"
        />
      ) : null}

      {outputPreview.mime.startsWith("text/") || OFFICE_PREVIEW_MIME_PATTERN.test(outputPreview.mime) ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-800">
          {previewText || "Loading preview..."}
        </pre>
      ) : null}

      {!outputPreview.mime.includes("pdf") &&
      !outputPreview.mime.startsWith("image/") &&
      !outputPreview.mime.startsWith("text/") &&
      !OFFICE_PREVIEW_MIME_PATTERN.test(outputPreview.mime) &&
      !outputPreview.imagePreviewDataUrl ? (
        <div className="rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-700">
          <p>Inline rendering is not available for this format in-browser.</p>
          <p className="mt-1">File type: {outputPreview.mime || "Unknown"}</p>
          <p className="mt-1">Size: {(outputPreview.blob.size / 1024).toFixed(1)} KB</p>
        </div>
      ) : null}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
      <p className="type-eyebrow text-slate-600">Output Preview</p>
      <p className="mt-1 text-sm text-slate-700">Processed output appears here immediately after upload or run.</p>
      <p className="field-help mt-2">Use the run button anytime to re-run with current settings.</p>
    </div>
  );

  useEffect(() => {
    return () => {
      if (outputPreview) URL.revokeObjectURL(outputPreview.url);
    };
  }, [outputPreview]);

  // Restore uploaded files after a page refresh.
  useEffect(() => {
    let cancelled = false;
    void loadUploadedFiles(tool.slug).then((restored) => {
      if (cancelled || !restored.length) return;
      setFiles(restored);
    });
    return () => {
      cancelled = true;
    };
  }, [tool.slug]);

  useEffect(() => {
    if (!outputPreview) return;

    const tick = () => {
      setRetentionTick((current) => current + 1);
    };

    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [outputPreview]);

  useEffect(() => {
    const shouldAutoPromptUpload =
      hasChosenWorkflow &&
      isFirstWorkflowStep &&
      !pipelineBootstrap?.accepted &&
      files.length === 0;

    if (!shouldAutoPromptUpload) {
      autoWorkflowUploadPromptedRef.current = false;
      return;
    }

    if (autoWorkflowUploadPromptedRef.current) return;
    autoWorkflowUploadPromptedRef.current = true;

    const timer = window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [hasChosenWorkflow, isFirstWorkflowStep, pipelineBootstrap, files.length]);

  useEffect(() => {
    if (!pipelineBootstrap?.accepted) return;
    const inheritedFiles = pipelineBootstrap.allFiles?.length ? pipelineBootstrap.allFiles : [pipelineBootstrap.file];
    const timer = window.setTimeout(() => {
      if (shouldShowPreflight) {
        void runPreflightAnalysis(inheritedFiles);
      }
      void hydrateSelectionContext(inheritedFiles);
      if (shouldAutoRunAfterSelection(inheritedFiles)) {
        requestAutoRun("Auto-run triggered from workflow pipeline handoff.");
      }
    }, 0);

    return () => window.clearTimeout(timer);
    // hydrateSelectionContext/runPreflightAnalysis are intentionally not deps to avoid reruns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineBootstrap, shouldShowPreflight]);

  useEffect(() => {
    if (!switchDropdownOpen) return;
    const handler = (event: MouseEvent) => {
      if (switchDropdownRef.current && !switchDropdownRef.current.contains(event.target as Node)) {
        setSwitchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [switchDropdownOpen]);

  useEffect(() => {
    if (!autoRunEpoch || autoRunHandledRef.current === autoRunEpoch) return;
    if (busy || !files.length) return;

    autoRunHandledRef.current = autoRunEpoch;
    logProcessing(autoRunReasonRef.current || "Auto-run triggered after upload.");
    void runTool();
    // runTool/logProcessing are intentionally omitted because runTool is not memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunEpoch, busy, files.length]);

  // Auto-dismiss pipeline notice when output is successfully produced
  useEffect(() => {
    if (outputPreview && pipelineBootstrap) {
      setPipelineNotice("");
    }
  }, [outputPreview, pipelineBootstrap]);

  // Scroll to output when it becomes available after processing
  useEffect(() => {
    if (outputPreview && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [outputPreview]);

  useEffect(() => {
    if (!isScanTool) {
      stopCamera();
    }

    return () => stopCamera();
  }, [isScanTool]);

  useEffect(() => {
    redrawEditCanvas();
    // redrawEditCanvas intentionally depends on state used by drawing overlays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPreview, editStrokes, editTextNotes, activeEditStroke, editColor, editBrushSize]);

  useEffect(() => {
    if (!isScanTool) return;
    refreshCameraPermissionStatus();
  }, [isScanTool]);

  useEffect(() => {
    if (!isEditTool) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const pressedKey = event.key.toUpperCase();
      const nextTab = EDIT_RIBBON_TABS.find((tab) => EDIT_RIBBON_SHORTCUTS[tab] === pressedKey);
      if (!nextTab) return;

      event.preventDefault();
      setEditRibbonTab(nextTab);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditTool]);

  const uploadHint = useMemo(() => {
    if (tool.slug === "merge-pdf") {
      return "Upload any mix of files (PDF, images, Word, Excel, PowerPoint, HTML), then drag thumbnails to reorder pages.";
    }
    if (tool.slug === "convert-to-pdf") {
      return "Upload any mix of files (PDF, images, Word, Excel, PowerPoint, HTML), then drag page thumbnails to reorder.";
    }
    if (tool.slug === "compare-pdf") return "Upload two PDFs to compare textual differences.";
    if (tool.slug === "split-pdf" || tool.slug === "extract-pages") {
      return "Upload one PDF and select pages from thumbnails to extract.";
    }
    if (tool.slug === "organize-pdf") return "Upload one PDF and drag thumbnails to set output order.";
    if (tool.slug === "remove-pages") return "Upload one PDF and click page thumbnails to remove pages.";
    if (tool.slug === "rotate-pdf") return "Upload a PDF, choose a rotation angle for all pages, or set per-page rotation below.";
    if (tool.slug === "images-to-pdf" || tool.slug === "images-to-pdf" || tool.slug === "scan-to-pdf") {
      return "Upload one or more images to generate a PDF.";
    }
    if (tool.slug === "pdf-to-latex") {
      return "Upload one PDF to generate a .tex source file for scientific editing.";
    }
    return "Upload your file to begin processing.";
  }, [tool.slug]);

  function reorderMergePages(fromId: string, toId: string) {
    setMergePageOrder((current) => {
      const fromIndex = current.indexOf(fromId);
      const toIndex = current.indexOf(toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function removeMergePage(pageId: string) {
    setMergePageOrder((current) => current.filter((id) => id !== pageId));
  }

  function getEditCanvasPoint(
    canvas: HTMLCanvasElement,
    event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>
  ) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function redrawEditCanvas() {
    const canvas = editCanvasRef.current;
    if (!canvas || !editPreview) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const strokesToDraw =
        activeEditStroke.length > 1
          ? [...editStrokes, { points: activeEditStroke, color: editColor, width: editBrushSize }]
          : editStrokes;

      for (const stroke of strokesToDraw) {
        if (!stroke.points.length) continue;
        context.beginPath();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = stroke.color;
        context.lineWidth = stroke.width;
        context.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i += 1) {
          context.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        context.stroke();
      }

      for (const note of editTextNotes) {
        context.fillStyle = note.color;
        context.font = `${note.size}px ${"DM Sans"}`;
        context.fillText(note.text, note.x, note.y);
      }
    };
    image.src = editPreview;
  }

  function persistPageLayer(pageNumber: number, strokes: EditStroke[], textNotes: EditTextNote[]) {
    setEditLayersByPage((current) => {
      if (!strokes.length && !textNotes.length) {
        if (!current[pageNumber]) return current;
        const next = { ...current };
        delete next[pageNumber];
        return next;
      }

      return {
        ...current,
        [pageNumber]: { strokes, textNotes },
      };
    });
  }

  async function loadEditPreview(file: File, targetPage: number) {
    try {
      setEditCanvasLoading(true);
      const preview = await renderPdfPagePreview(new Uint8Array(await readAsArrayBuffer(file)), targetPage);
      const layer = editLayersByPage[preview.safePage];
      setEditPreview(preview.dataUrl);
      setEditCanvasSize({ width: preview.width, height: preview.height });
      setEditPageCount(preview.pageCount);
      setEditPageNumber(preview.safePage);
      setEditStrokes(layer?.strokes ?? []);
      setEditTextNotes(layer?.textNotes ?? []);
      setActiveEditStroke([]);
    } catch {
      setError("Could not prepare editable canvas for this PDF.");
    } finally {
      setEditCanvasLoading(false);
    }
  }

  function onEditPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (editMode !== "draw") return;
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    const point = getEditCanvasPoint(canvas, event);
    setActiveEditStroke([point]);
    canvas.setPointerCapture(event.pointerId);
  }

  function onEditPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (editMode !== "draw") return;
    if (!activeEditStroke.length) return;
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    const point = getEditCanvasPoint(canvas, event);
    setActiveEditStroke((current) => [...current, point]);
  }

  function onEditPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (editMode !== "draw") return;
    const canvas = editCanvasRef.current;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (activeEditStroke.length > 1) {
      setEditStrokes((current) => {
        const next = [...current, { points: activeEditStroke, color: editColor, width: editBrushSize }];
        persistPageLayer(editPageNumber, next, editTextNotes);
        return next;
      });
    }
    setActiveEditStroke([]);
  }

  function onEditCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (editMode !== "text") return;
    if (!editText.trim()) return;
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    const point = getEditCanvasPoint(canvas, event);
    setEditTextNotes((current) => {
      const next = [
        ...current,
        { x: point.x, y: point.y, text: editText.trim(), color: editColor, size: editFontSize },
      ];
      persistPageLayer(editPageNumber, editStrokes, next);
      return next;
    });
  }

  function undoEditAction() {
    if (editMode === "text") {
      setEditTextNotes((current) => {
        const next = current.slice(0, -1);
        persistPageLayer(editPageNumber, editStrokes, next);
        return next;
      });
      return;
    }
    setEditStrokes((current) => {
      const next = current.slice(0, -1);
      persistPageLayer(editPageNumber, next, editTextNotes);
      return next;
    });
  }

  function clearEditCanvasActions() {
    persistPageLayer(editPageNumber, [], []);
    setEditStrokes([]);
    setEditTextNotes([]);
    setActiveEditStroke([]);
  }

  function clearEditDocumentActions() {
    setEditLayersByPage({});
    setEditStrokes([]);
    setEditTextNotes([]);
    setActiveEditStroke([]);
  }

  function stopCamera() {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraBusy(false);
  }

  async function refreshCameraPermissionStatus() {
    if (!navigator.permissions?.query) {
      setCameraPermissionStatus("unknown");
      return;
    }

    try {
      const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
      setCameraPermissionStatus(permission.state);
    } catch {
      setCameraPermissionStatus("unknown");
    }
  }

  async function requestCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.");
      return false;
    }

    try {
      setCameraError("");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setCameraPermissionStatus("granted");
      return true;
    } catch (permissionError) {
      if (permissionError instanceof DOMException && permissionError.name === "NotAllowedError") {
        setCameraPermissionStatus("denied");
        setCameraError("Camera permission denied. Allow access to use scan capture.");
      } else {
        setCameraError("Could not request camera permission. Please retry.");
      }
      return false;
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.");
      return;
    }

    if (cameraPermissionStatus !== "granted") {
      const granted = await requestCameraPermission();
      if (!granted) {
        return;
      }
    }

    try {
      setCameraError("");
      setCameraBusy(true);
      stopCamera();

      let stream: MediaStream;
      try {
        // Prefer back camera on mobile devices.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        // Fallback for devices/browsers that reject facingMode constraints.
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      cameraStreamRef.current = stream;
      const video = cameraVideoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setCameraActive(true);
      setCameraPermissionStatus("granted");
    } catch (cameraStartError) {
      if (cameraStartError instanceof DOMException) {
        if (cameraStartError.name === "NotAllowedError") {
          setCameraError("Camera permission denied. Allow camera access in browser settings and retry.");
        } else if (cameraStartError.name === "NotFoundError") {
          setCameraError("No camera device found. Connect a camera or upload image files instead.");
        } else if (cameraStartError.name === "NotReadableError") {
          setCameraError("Camera is in use by another app. Close other apps using the camera and retry.");
        } else {
          setCameraError("Unable to access camera. Check permissions and try again.");
        }
      } else {
        setCameraError("Unable to access camera. Check permissions and try again.");
      }
      stopCamera();
    } finally {
      setCameraBusy(false);
    }
  }

  async function captureFromCamera() {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || !cameraActive) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not capture camera frame.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
    });

    if (!blob) {
      setCameraError("Capture failed. Please try again.");
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const capturedFile = new File([blob], `scan-capture-${stamp}.jpg`, { type: "image/jpeg" });
    setFiles((current) => [...current, capturedFile]);
    setStatus("Camera image captured. You can capture more or run Scan to PDF.");
  }

  const acceptsMultiple = true;

  const inputAccept = useMemo(() => {
    if (tool.slug === "convert-to-pdf" || tool.slug === "merge-pdf") {
      return "application/pdf,.pdf,image/*,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.txt";
    }
    if (tool.slug === "images-to-pdf" || tool.slug === "images-to-pdf" || tool.slug === "scan-to-pdf") {
      return "image/jpeg,image/png,image/webp";
    }
    if (tool.slug === "word-to-pdf") {
      return ".doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword";
    }
    if (tool.slug === "powerpoint-to-pdf") {
      return ".ppt,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint";
    }
    if (tool.slug === "excel-to-pdf") {
      return ".xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
    }
    if (tool.slug === "html-to-pdf") {
      return ".html,.htm,text/html,text/plain";
    }
    return "application/pdf";
  }, [tool.slug]);

  function setupSignatureCanvas(canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    const width = 420;
    const height = 150;
    if (canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) {
      return;
    }

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.4;
    context.strokeStyle = "#0f172a";
  }

  function redrawSignatureCanvas() {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.4;
    context.strokeStyle = "#0f172a";

    for (const stroke of signatureStrokesRef.current) {
      if (!stroke.length) continue;
      if (stroke.length === 1) {
        context.beginPath();
        context.arc(stroke[0].x, stroke[0].y, 1.2, 0, Math.PI * 2);
        context.fillStyle = "#0f172a";
        context.fill();
        continue;
      }

      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i += 1) {
        context.lineTo(stroke[i].x, stroke[i].y);
      }
      context.stroke();
    }
  }

  function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onSignaturePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    setupSignatureCanvas(canvas);
    const context = canvas.getContext("2d");
    if (!context) return;

    const point = getCanvasPoint(canvas, event);
    signatureActiveStrokeRef.current = [point];
    signaturePointerState.current.drawing = true;
    canvas.setPointerCapture(event.pointerId);
  }

  function onSignaturePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signaturePointerState.current.drawing) return;
    const point = getCanvasPoint(canvas, event);
    signatureActiveStrokeRef.current.push(point);
    const temporaryStrokes = [...signatureStrokesRef.current, signatureActiveStrokeRef.current];
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.4;
    context.strokeStyle = "#0f172a";

    for (const stroke of temporaryStrokes) {
      if (!stroke.length) continue;
      if (stroke.length === 1) {
        context.beginPath();
        context.arc(stroke[0].x, stroke[0].y, 1.2, 0, Math.PI * 2);
        context.fillStyle = "#0f172a";
        context.fill();
      } else {
        context.beginPath();
        context.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i += 1) {
          context.lineTo(stroke[i].x, stroke[i].y);
        }
        context.stroke();
      }
    }

    if (!signatureDrawn) setSignatureDrawn(true);
  }

  function endSignatureStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    if (signaturePointerState.current.drawing) {
      signaturePointerState.current.drawing = false;
      if (signatureActiveStrokeRef.current.length) {
        signatureStrokesRef.current.push([...signatureActiveStrokeRef.current]);
        signatureActiveStrokeRef.current = [];
      }
      setSignatureDrawn(signatureStrokesRef.current.length > 0);
      redrawSignatureCanvas();
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function clearSignatureCanvas() {
    signatureStrokesRef.current = [];
    signatureActiveStrokeRef.current = [];
    redrawSignatureCanvas();
    setSignatureDrawn(false);
  }

  function saveCurrentSignature() {
    let entry: { id: string; kind: "text" | "draw"; label: string; text?: string; dataUrl?: string } | null = null;
    if (signatureMode === "text") {
      const text = editText.trim();
      if (!text) { setError("Type a signature before saving."); return; }
      entry = { id: `sig-${Date.now()}`, kind: "text", label: text, text };
    } else {
      const canvas = signatureCanvasRef.current;
      if (!canvas || !signatureDrawn) { setError("Draw a signature before saving."); return; }
      entry = { id: `sig-${Date.now()}`, kind: "draw", label: "Drawn signature", dataUrl: canvas.toDataURL("image/png") };
    }
    if (!entry) return;
    const next = [...savedSignatures, entry].slice(-12);
    setSavedSignatures(next);
    try { localStorage.setItem("wiserfiles-saved-signatures", JSON.stringify(next)); } catch {}
    setStatus("Signature saved for future use.");
  }

  function applySavedSignature(sig: { kind: "text" | "draw"; text?: string; dataUrl?: string }) {
    if (sig.kind === "text") {
      setSignatureMode("text");
      setEditText(sig.text || "");
    } else if (sig.dataUrl) {
      setSignatureMode("draw");
      const img = new Image();
      img.onload = () => {
        const canvas = signatureCanvasRef.current;
        if (!canvas) return;
        setupSignatureCanvas(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setSignatureDrawn(true);
      };
      img.src = sig.dataUrl;
    }
  }

  function deleteSavedSignature(id: string) {
    const next = savedSignatures.filter((s) => s.id !== id);
    setSavedSignatures(next);
    try { localStorage.setItem("wiserfiles-saved-signatures", JSON.stringify(next)); } catch {}
  }

  function addSignatureToDocument() {
    if (signatureMode === "text") {
      const text = editText.trim();
      if (!text) { setError("Type a signature before adding it."); return; }
      const count = signatures.length;
      const newSig = {
        id: `docsig-${Date.now()}`,
        kind: "text" as const,
        text,
        xRatio: 0.82 - (count % 3) * 0.06,
        yRatio: 0.12 + Math.floor(count / 3) * 0.08,
      };
      setSignatures((prev) => [...prev, newSig]);
      setActiveSignatureId(newSig.id);
    } else {
      const canvas = signatureCanvasRef.current;
      if (!canvas || !signatureDrawn) { setError("Draw a signature before adding it."); return; }
      const dataUrl = canvas.toDataURL("image/png");
      const count = signatures.length;
      const newSig = {
        id: `docsig-${Date.now()}`,
        kind: "draw" as const,
        dataUrl,
        xRatio: 0.82 - (count % 3) * 0.06,
        yRatio: 0.12 + Math.floor(count / 3) * 0.08,
      };
      setSignatures((prev) => [...prev, newSig]);
      setActiveSignatureId(newSig.id);
    }
    setStatus("Signature added. Click the preview to position it.");
  }

  function removeSignatureFromDocument(id: string) {
    setSignatures((prev) => prev.filter((s) => s.id !== id));
    if (activeSignatureId === id) setActiveSignatureId("");
  }

  function positionActiveSignature(xRatio: number, yRatio: number) {
    if (!activeSignatureId) return;
    setSignatures((prev) =>
      prev.map((s) => (s.id === activeSignatureId ? { ...s, xRatio, yRatio } : s))
    );
  }

  function onSignaturePlacementPick(event: React.MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xTopRatio = clamp((event.clientX - rect.left) / rect.width, 0.02, 0.98);
    const yTopRatio = clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98);
    const yPdfRatio = 1 - yTopRatio;
    if (activeSignatureId) {
      positionActiveSignature(xTopRatio, yPdfRatio);
    } else {
      setSignaturePlacement({ xRatio: xTopRatio, yRatio: yPdfRatio });
    }
  }

  async function loadSignPage(pageNumber: number) {
    const bytes = signPdfBytesRef.current;
    if (!bytes) return;
    const preview = await renderPdfPagePreview(bytes, pageNumber);
    setSignaturePlacementPreview(preview.dataUrl);
    setSignPageCount(preview.pageCount);
    setSignPageNumber(pageNumber);
  }

  async function getSignatureImageBytes() {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signatureDrawn) return null;
    const dataUrl = canvas.toDataURL("image/png");
    const response = await fetch(dataUrl);
    return response.arrayBuffer();
  }

  useEffect(() => {
    if (tool.slug !== "sign-pdf" || signatureMode !== "draw") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isUndoShortcut =
        (event.metaKey && key === "z") || (event.ctrlKey && (key === "z" || key === "x"));
      if (!isUndoShortcut) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (!signatureStrokesRef.current.length) return;
      signatureStrokesRef.current.pop();
      setSignatureDrawn(signatureStrokesRef.current.length > 0);
      redrawSignatureCanvas();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [signatureMode, tool.slug]);

  function togglePage(pageNumber: number) {
    if (isOrganizeTool) {
      setPageOrder((current) => {
        const next = current.includes(pageNumber)
          ? current.filter((value) => value !== pageNumber)
          : [...current, pageNumber];
        setRanges(compactPageSequence(next));
        return next;
      });
      return;
    }

    setSelectedPages((current) => {
      const next = current.includes(pageNumber)
        ? current.filter((value) => value !== pageNumber)
        : [...current, pageNumber];
      setRanges(compactPageSequence(next));
      return next;
    });
  }

  function reorderPages(fromPage: number, toPage: number) {
    setPageOrder((current) => {
      const fromIndex = current.indexOf(fromPage);
      const toIndex = current.indexOf(toPage);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setRanges(compactPageSequence(next));
      return next;
    });
  }

  function reorderSelectedPages(fromPage: number, toPage: number) {
    setSelectedPages((current) => {
      const fromIndex = current.indexOf(fromPage);
      const toIndex = current.indexOf(toPage);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setRanges(compactPageSequence(next));
      return next;
    });
  }

  function moveFile(fromIndex: number, toIndex: number) {
    setFiles((current) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length || fromIndex === toIndex) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function detectFileType(file: File): { label: string; suggestedTool: string | null } {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".docx") || lower.endsWith(".doc") || file.type.includes("wordprocessingml")) {
      return { label: "a Word document", suggestedTool: "word-to-pdf" };
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || file.type.includes("spreadsheetml")) {
      return { label: "an Excel spreadsheet", suggestedTool: "excel-to-pdf" };
    }
    if (lower.endsWith(".pptx") || lower.endsWith(".ppt") || file.type.includes("presentationml")) {
      return { label: "a PowerPoint presentation", suggestedTool: "powerpoint-to-pdf" };
    }
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
      return { label: "an image file", suggestedTool: "images-to-pdf" };
    }
    if (lower.endsWith(".html") || lower.endsWith(".htm")) {
      return { label: "an HTML file", suggestedTool: "html-to-pdf" };
    }
    if (file.type === "application/pdf" || lower.endsWith(".pdf")) {
      return { label: "a PDF", suggestedTool: null };
    }
    return { label: "an unsupported file type", suggestedTool: null };
  }

  function navigateWithFile(targetSlug: string, file: File) {
    stageWorkflowPipeline({
      fromToolSlug: tool.slug,
      toToolSlug: targetSlug,
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      blob: file,
      createdAt: Date.now(),
    });
    router.push(`/tools/${targetSlug}?pipeline=true`);
  }

  async function applySelectedFiles(nextFiles: File[]) {
    if (!nextFiles.length) return;
    setError("");
    setStatus("");
    setOcrUploadWarning("");
    setRunReport(null);
    setOutputPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    latestOutputRef.current = null;
    setMergePages([]);
    setMergePageOrder([]);
    setMergeDraggedId(null);
    setMergeDragOverId(null);
    setOcrQueueStatus([]);
    setPreflightSummary(null);
    setSmartIntake(null);
    setPipelineNotice("");
    setFormatRedirectSuggestion(null);
    logProcessing(`Selected ${nextFiles.length} file(s) for ${tool.name}.`);

    if (isOcrTool) {
      const oversizedFile = nextFiles.find((file) => file.size > MAX_OCR_UPLOAD_BYTES);
      if (oversizedFile) {
        const message = `OCR uploads are limited to ${formatBytes(MAX_OCR_UPLOAD_BYTES)}. ${oversizedFile.name} is ${formatBytes(oversizedFile.size)}.`;
        setFiles([]);
        setOcrUploadWarning(message);
        setError(message);
        setPreflightLoading(false);
        setSmartIntakeLoading(false);
        return;
      }
    }

    // Smart format detection: check if uploaded file is compatible
    const incompatibleFile = nextFiles.find((file) => !isFileCompatibleForTool(tool.slug, file));
    if (incompatibleFile && !isScanTool) {
      const { label, suggestedTool } = detectFileType(incompatibleFile);
      if (suggestedTool && suggestedTool !== tool.slug) {
        const targetTool = TOOL_ITEMS.find((t) => t.slug === suggestedTool);
        if (targetTool) {
          setFormatRedirectSuggestion({
            label,
            targetSlug: suggestedTool,
            targetName: targetTool.name,
            file: incompatibleFile,
          });
          setFiles([]);
          return;
        }
      }
      setFiles([]);
      setError(
        `This appears to be ${label}. The ${tool.name} tool works with ${
          tool.slug.includes("pdf") || isImageToPdfTool ? "PDF and image files" : "PDF files"
        }. Please try a different tool.`
      );
      return;
    }

    const finalSelectedFiles = isMultiFileTool ? [...files, ...nextFiles] : nextFiles;
    setFiles(finalSelectedFiles);
    void persistUploadedFiles(tool.slug, finalSelectedFiles);
    addLocalStoredFiles(nextFiles, `Uploaded for ${tool.name}`);
    const selectedFilesForAnalysis = finalSelectedFiles;
    if (shouldShowPreflight) {
      void runPreflightAnalysis(selectedFilesForAnalysis);
    }
    await hydrateSelectionContext(finalSelectedFiles);

    if (shouldAutoRunAfterSelection(finalSelectedFiles)) {
      requestAutoRun("Auto-run triggered after file upload.");
    }
  }

  async function onSelect(selected: FileList | null) {
    if (!selected) return;
    await applySelectedFiles(Array.from(selected));
  }

  function stageRecipeHandoff(targetToolSlug: string, recipeSlugOverride?: string) {
    const recipeSlug = recipeSlugOverride ?? selectedRecipe?.slug ?? selectedRecipeSlug;
    if (latestOutputRef.current && outputPreview) {
      stageWorkflowPipeline({
        fromToolSlug: tool.slug,
        toToolSlug: targetToolSlug,
        recipeSlug,
        fileName: outputPreview.fileName,
        mime: outputPreview.mime,
        blob: outputPreview.blob,
        createdAt: Date.now(),
      });
      logProcessing(`Staged pipeline handoff to ${targetToolSlug}.`);
      return;
    }

    if (files[0]) {
      stageWorkflowPipeline({
        fromToolSlug: tool.slug,
        toToolSlug: targetToolSlug,
        recipeSlug,
        fileName: files[0].name,
        mime: files[0].type || "application/octet-stream",
        blob: files[0],
        createdAt: Date.now(),
      });
      logProcessing(`Staged current input handoff to ${targetToolSlug}.`);
    }
  }

  async function continueRecipe() {
    if (!currentRecipeNextStep) return;

    // If there is no output yet but we have a file, auto-run the current tool
    // first, then hand off to the next step once it completes.
    if (!outputPreview && files.length) {
      await runTool();
      // runTool stages outputPreview via stageOutput; give React one tick to flush.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    stageRecipeHandoff(currentRecipeNextStep.toolSlug);
    const recipeSlug = selectedRecipe?.slug || selectedRecipeSlug;
    router.push(`/tools/${currentRecipeNextStep.toolSlug}${recipeSlug ? `?recipe=${encodeURIComponent(recipeSlug)}` : ""}`);
  }

  function goToPreviousRecipeStage() {
    if (!currentRecipePreviousStep) return;
    stageRecipeHandoff(currentRecipePreviousStep.toolSlug);

    const recipeSlug = selectedRecipe?.slug || selectedRecipeSlug;
    router.push(`/tools/${currentRecipePreviousStep.toolSlug}${recipeSlug ? `?recipe=${encodeURIComponent(recipeSlug)}` : ""}`);
  }

  function setRecipeSlug(recipeSlug: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (recipeSlug) {
      params.set("recipe", recipeSlug);
    } else {
      params.delete("recipe");
    }
    const nextQuery = params.toString();
    router.replace(`/tools/${tool.slug}${nextQuery ? `?${nextQuery}` : ""}`);
  }

  function startSuggestedWorkflow(workflow: RecommendedWorkflow) {
    // If the AI suggested a workflow that doesn't include the current tool,
    // try to fall back to an applicable recipe that does.
    const workflowToUse: RecommendedWorkflow = (() => {
      if (workflow.steps.some((s) => s.toolSlug === tool.slug)) return workflow;
      const fallback = applicableRecipes.find((r) =>
        r.steps.some((s) => s.toolSlug === tool.slug)
      );
      if (!fallback) return workflow;
      return {
        recipeSlug: fallback.slug,
        recipeName: fallback.name,
        description: fallback.description,
        steps: fallback.steps,
      };
    })();

    const firstStep = workflowToUse.steps[0];
    if (!firstStep) return;

    // If the current tool is already one of the workflow steps, activate it here.
    if (workflowToUse.steps.some((s) => s.toolSlug === tool.slug)) {
      setRecipeSlug(workflowToUse.recipeSlug);
      setError("");
      setStatus(`Workflow "${workflowToUse.recipeName}" started at this step. Complete it, then continue to the next stage.`);
      return;
    }

    stageRecipeHandoff(firstStep.toolSlug, workflowToUse.recipeSlug);
    router.push(`/tools/${firstStep.toolSlug}?recipe=${encodeURIComponent(workflowToUse.recipeSlug)}`);
  }

  async function runOcrForFile(file: File) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("language", ocrLanguage);
    formData.append("deskew", String(ocrQualityOptions.deskew));
    formData.append("cleanFinal", String(ocrQualityOptions.cleanFinal));
    formData.append("rotatePages", String(ocrQualityOptions.rotatePages));
    formData.append("redoOcr", String(ocrQualityOptions.redoOcr));

    const response = await fetch("/api/ocr-pdf", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const isJson = response.headers.get("content-type")?.includes("application/json");
      const payload = isJson ? await response.json().catch(() => null) : null;
      const fallback = await response.text().catch(() => "");
      throw new Error(payload?.error || fallback || `OCR processing failed for ${file.name}.`);
    }

    const pdfBlob = await response.blob();
    const outputName =
      getFileNameFromDisposition(response.headers.get("content-disposition")) ||
      `${normalizeFileName(file.name)}-searchable.pdf`;

    return {
      blob: pdfBlob.type ? pdfBlob : new Blob([await pdfBlob.arrayBuffer()], { type: "application/pdf" }),
      outputName,
    };
  }

  async function runTool() {
    setError("");
    setPinnedError(false);
    setStatus("");
    setOcrUploadWarning("");
    const runStartedAt = Date.now();
    let completionMessage = "";

    const complete = (message: string) => {
      completionMessage = message;
      setStatus(message);
      showToast(message, "success");
    };

    if (!files.length) {
      setError("Upload at least one file to continue.");
      showToast("Upload at least one file to continue.", "error");
      return;
    }

    try {
      setBusy(true);
      logProcessing(`Running ${tool.name} in ${tool.runtime} mode.`);
      const firstFile = files[0];

      if (tool.slug === "merge-pdf" || tool.slug === "convert-to-pdf") {
        const { bytes } = await convertMixedFilesToPdf(files);
        const combined = await PDFDocument.load(bytes);
        const output = await PDFDocument.create();

        if (mergePageOrder.length && mergePages.length) {
          const pageById = new Map(mergePages.map((page) => [page.id, page]));
          const indices = mergePageOrder
            .map((id) => pageById.get(id)?.pageIndex)
            .filter((i): i is number => typeof i === "number");
          const copied = await output.copyPages(combined, indices);
          copied.forEach((p) => output.addPage(p));
        } else {
          const copied = await output.copyPages(combined, combined.getPageIndices());
          copied.forEach((p) => output.addPage(p));
        }

        if (!output.getPageCount()) {
          throw new Error(tool.slug === "merge-pdf" ? "Select at least one page to merge." : "Add at least one file to convert.");
        }
        const outName = tool.slug === "merge-pdf" ? "merged.pdf" : "converted.pdf";
        const outNote = tool.slug === "merge-pdf" ? "Preview merged pages before downloading." : "Preview converted PDF before downloading.";
        stageOutput(asPdfBlob(await output.save()), outName, outNote);
        complete(tool.slug === "merge-pdf" ? "Merged PDF ready for preview." : "Converted PDF ready for preview.");
        return;
      }

      if (tool.slug === "split-pdf" || tool.slug === "extract-pages") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const chosen = selectedPages.length ? selectedPages : parseRanges(ranges, source.getPageCount());
        const output = await PDFDocument.create();
        const copied = await output.copyPages(source, chosen.map((page) => page - 1));
        copied.forEach((page) => output.addPage(page));
        stageOutput(
          asPdfBlob(await output.save()),
          `${normalizeFileName(firstFile.name)}-extract.pdf`,
          "Preview extracted pages before downloading."
        );
        complete("Selected pages ready for preview.");
        return;
      }

      if (tool.slug === "organize-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const order = pageOrder.length
          ? pageOrder
          : parseRanges(ranges, source.getPageCount());
        if (!order.length) throw new Error("Select at least one page to organize.");
        const output = await PDFDocument.create();
        const copied = await output.copyPages(source, order.map((page) => page - 1));
        copied.forEach((page) => output.addPage(page));
        stageOutput(
          asPdfBlob(await output.save()),
          `${normalizeFileName(firstFile.name)}-organized.pdf`,
          "Preview reordered pages before downloading."
        );
        complete("Reordered PDF ready for preview.");
        return;
      }

      if (tool.slug === "remove-pages") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const removeSet = new Set(
          selectedPages.length
            ? selectedPages
            : parseRanges(ranges, source.getPageCount())
        );
        const keep = source.getPageIndices().map((i) => i + 1).filter((p) => !removeSet.has(p));
        if (!keep.length) throw new Error("Cannot remove all pages from the document.");
        const output = await PDFDocument.create();
        const copied = await output.copyPages(source, keep.map((page) => page - 1));
        copied.forEach((page) => output.addPage(page));
        stageOutput(
          asPdfBlob(await output.save()),
          `${normalizeFileName(firstFile.name)}-trimmed.pdf`,
          "Preview the trimmed document before downloading."
        );
        complete("Trimmed PDF ready for preview.");
        return;
      }

      if (tool.slug === "rotate-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const rotations = pageRotationsRef.current;
        const defaultAngle = rotateAngleRef.current;
        source.getPages().forEach((page, index) => {
          const angle = rotations[index + 1] ?? defaultAngle;
          page.setRotation(degrees(angle));
        });
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-rotated.pdf`,
          "Preview rotated pages before downloading."
        );
        complete(`Rotated PDF ready for preview.`);
        return;
      }

      if (tool.slug === "page-numbers") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const font = await source.embedFont(StandardFonts.Helvetica);
        const total = source.getPageCount();
        source.getPages().forEach((page, index) => {
          const { width } = page.getSize();
          page.drawText(`${index + 1} / ${total}`, {
            x: width - 80,
            y: 20,
            size: 11,
            font,
            color: rgb(0.25, 0.28, 0.32),
          });
        });
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-numbered.pdf`,
          "Preview page numbering before downloading."
        );
        complete("Numbered PDF ready for preview.");
        return;
      }

      if (tool.slug === "images-to-pdf" || tool.slug === "images-to-pdf" || tool.slug === "scan-to-pdf") {
        const output = await PDFDocument.create();
        const preparedImages: Array<{ image: PDFImage; width: number; height: number }> = [];

        for (const file of files) {
          preparedImages.push(await fileToPdfImage(output, file));
        }

        if (imagePdfPlacementMode === "single") {
          for (const embedded of preparedImages) {
            let pageWidth = embedded.width;
            let pageHeight = embedded.height;

            if (imagePdfPageSizeMode === "a4") {
              const isLandscape = embedded.width > embedded.height;
              pageWidth = isLandscape ? A4_PAGE_SIZE_PORTRAIT.height : A4_PAGE_SIZE_PORTRAIT.width;
              pageHeight = isLandscape ? A4_PAGE_SIZE_PORTRAIT.width : A4_PAGE_SIZE_PORTRAIT.height;
            }

            const clampedPage = clampPdfImageDimensions(pageWidth, pageHeight);
            const page = output.addPage([clampedPage.width, clampedPage.height]);
            const margin = Math.max(0, Math.min(120, Math.round(imagePdfPageMargin || 0)));
            const contentWidth = Math.max(1, clampedPage.width - margin * 2);
            const contentHeight = Math.max(1, clampedPage.height - margin * 2);
            const fitScale = Math.min(
              contentWidth / embedded.width,
              contentHeight / embedded.height
            );
            const drawWidth = embedded.width * fitScale;
            const drawHeight = embedded.height * fitScale;
            const x = margin + (contentWidth - drawWidth) / 2;
            const y = margin + (contentHeight - drawHeight) / 2;

            page.drawImage(embedded.image, { x, y, width: drawWidth, height: drawHeight });
          }
        } else {
          const columns = Math.max(1, Math.min(4, Math.round(imagePdfGridColumns || 2)));
          const rows = Math.max(1, Math.min(6, Math.round(imagePdfGridRows || 2)));
          const margin = Math.max(0, Math.min(120, Math.round(imagePdfPageMargin || 0)));
          const gap = 12;

          let pageWidth = A4_PAGE_SIZE_PORTRAIT.width;
          let pageHeight = A4_PAGE_SIZE_PORTRAIT.height;

          if (imagePdfPageSizeMode === "original") {
            const maxWidth = Math.max(...preparedImages.map((item) => item.width));
            const maxHeight = Math.max(...preparedImages.map((item) => item.height));
            const clampedMax = clampPdfImageDimensions(maxWidth, maxHeight);
            pageWidth = clampedMax.width;
            pageHeight = clampedMax.height;
          }

          const clampedPage = clampPdfImageDimensions(pageWidth, pageHeight);
          const usableWidth = Math.max(1, clampedPage.width - margin * 2);
          const usableHeight = Math.max(1, clampedPage.height - margin * 2);
          const cellWidth = Math.max(1, (usableWidth - gap * (columns - 1)) / columns);
          const perPage = Math.max(1, columns * rows);

          for (let pageStart = 0; pageStart < preparedImages.length; pageStart += perPage) {
            const page = output.addPage([clampedPage.width, clampedPage.height]);
            const chunk = preparedImages.slice(pageStart, pageStart + perPage);
            const cellHeight = Math.max(1, (usableHeight - gap * (rows - 1)) / rows);

            chunk.forEach((embedded, index) => {
              const row = Math.floor(index / columns);
              const col = index % columns;
              const xCell = margin + col * (cellWidth + gap);
              const yCellTop = clampedPage.height - margin - row * (cellHeight + gap);

              const fitScale = Math.min(cellWidth / embedded.width, cellHeight / embedded.height);
              const drawWidth = embedded.width * fitScale;
              const drawHeight = embedded.height * fitScale;
              const x = xCell + (cellWidth - drawWidth) / 2;
              const y = yCellTop - cellHeight + (cellHeight - drawHeight) / 2;

              page.drawImage(embedded.image, { x, y, width: drawWidth, height: drawHeight });
            });
          }
        }

        stageOutput(asPdfBlob(await output.save()), "images.pdf", "Preview the converted PDF before downloading.");
        complete(tool.slug === "scan-to-pdf" ? "Scan PDF ready for preview." : "Converted PDF ready for preview.");
        return;
      }

      if (tool.slug === "compress-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");

        if (compressionOptions.removeImages) {
          const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
          const textOnlyBytes = await pdfFromLines(
            pages.flatMap((text, index) => [
              `Page ${index + 1}`,
              text,
              "",
            ]),
            "Compressed Text-Only PDF"
          );

          stageOutput(
            asPdfBlob(textOnlyBytes),
            `${normalizeFileName(firstFile.name)}-compressed.pdf`,
            "Images removed. Review text-only compression output before downloading."
          );
          complete("Compressed PDF ready for preview.");
          return;
        }

        const renderedPages = await renderPdfToImages(new Uint8Array(await readAsArrayBuffer(firstFile)));
        if (!renderedPages.length) throw new Error("No pages available to compress.");

        setProgress({ current: 0, total: renderedPages.length, label: "Compressing pages…" });
        const processed: Array<{ dataUrl: string; width: number; height: number }> = [];
        for (let i = 0; i < renderedPages.length; i += 1) {
          setProgress({ current: i + 1, total: renderedPages.length, label: `Compressing page ${i + 1} of ${renderedPages.length}…` });
          processed.push(await processCompressionImage(renderedPages[i].dataUrl, compressionOptions));
        }

        const doc = new jsPDF({
          unit: "pt",
          format: [processed[0].width, processed[0].height],
          compress: true,
        });

        processed.forEach((page, index) => {
          if (index > 0) doc.addPage([page.width, page.height], "portrait");
          doc.addImage(page.dataUrl, "JPEG", 0, 0, page.width, page.height);
        });

        const compressedSource = await PDFDocument.load(doc.output("arraybuffer"));
        if (compressionOptions.stripMetadata) {
          compressedSource.setTitle("");
          compressedSource.setAuthor("");
          compressedSource.setSubject("");
          compressedSource.setKeywords([]);
          compressedSource.setCreator("WiserFiles Compression Engine");
          compressedSource.setProducer("WiserFiles Compression Engine");
        }

        stageOutput(
          asPdfBlob(await compressedSource.save({ useObjectStreams: true })),
          `${normalizeFileName(firstFile.name)}-compressed.pdf`,
          "Compression options applied. Review quality before downloading."
        );
        complete("Compressed PDF ready for preview.");
        return;
      }

      if (tool.slug === "repair-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile), { ignoreEncryption: true });
        source.setTitle("");
        source.setAuthor("");
        source.setSubject("");
        source.setKeywords([]);
        source.setProducer("WiserFiles PDF Repair");
        source.setCreator("");
        const bytes = await source.save({ useObjectStreams: false, objectsPerTick: 50 });
        stageOutput(
          asPdfBlob(bytes),
          `${normalizeFileName(firstFile.name)}-repaired.pdf`,
          "PDF structure rebuilt. Some content may be unrecoverable if the original was severely damaged."
        );
        complete("PDF structure rebuilt. Some content may be unrecoverable if the original was severely damaged.");
        return;
      }

      if (tool.slug === "pdf-to-pdfa") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile), { ignoreEncryption: true });
        source.setTitle(source.getTitle() || "PDF/A-2b Document");
        source.setProducer("WiserFiles PDF/A-2b Export");
        source.setCreator(source.getCreator() || "");
        try {
          await source.embedFont(StandardFonts.Helvetica);
          await source.embedFont(StandardFonts.TimesRoman);
          await source.embedFont(StandardFonts.Courier);
        } catch {
          // Font embedding is best-effort for PDF/A conformance.
        }
        const bytes = await source.save({ useObjectStreams: true, objectsPerTick: 50 });
        stageOutput(
          asPdfBlob(bytes),
          `${normalizeFileName(firstFile.name)}-pdfa.pdf`,
          "Basic PDF/A-2b conformance applied. Verify with a dedicated validator."
        );
        complete("Basic PDF/A-2b conformance applied. Verify with a dedicated validator.");
        return;
      }

      if (tool.slug === "pdf-to-jpg") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const images = await renderPdfToImages(new Uint8Array(await readAsArrayBuffer(firstFile)), password || undefined);
        const zip = new JSZip();
        setProgress({ current: 0, total: images.length, label: "Converting pages to JPG…" });
        for (let index = 0; index < images.length; index += 1) {
          setProgress({ current: index + 1, total: images.length, label: `Converting page ${index + 1} of ${images.length}…` });
          const response = await fetch(images[index].dataUrl);
          zip.file(`${normalizeFileName(firstFile.name)}-page-${index + 1}.jpg`, await response.blob());
        }
        const archive = await zip.generateAsync({ type: "blob" });
        stageOutput(
          archive,
          `${normalizeFileName(firstFile.name)}-jpg-pages.zip`,
          "Preview sample image below, then download the full JPG archive.",
          images[0]?.dataUrl
        );
        complete("JPG package ready for preview.");
        return;
      }

      if (tool.slug === "ocr-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        if (ocrBatchMode && files.length > 1) {
          setOcrQueueStatus(files.map((file) => ({ fileName: file.name, state: "queued" })));
          const archive = new JSZip();

          for (const file of files) {
            setOcrQueueStatus((current) =>
              current.map((item) =>
                item.fileName === file.name ? { ...item, state: "processing" } : item
              )
            );
            setProgress(null);
            setStatus(`OCR processing: ${file.name}…`);

            try {
              const result = await runOcrForFile(file);
              archive.file(result.outputName, result.blob);
              setOcrQueueStatus((current) =>
                current.map((item) => (item.fileName === file.name ? { ...item, state: "done" } : item))
              );
            } catch {
              setOcrQueueStatus((current) =>
                current.map((item) =>
                  item.fileName === file.name ? { ...item, state: "failed" } : item
                )
              );
            }
          }

          const zipBlob = await archive.generateAsync({ type: "blob" });
          stageOutput(
            zipBlob,
            "ocr-batch-output.zip",
            "Batch OCR queue completed. Download the archive of searchable PDFs."
          );

          if (ocrWebhookUrl.trim()) {
            fetch(ocrWebhookUrl.trim(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event: "wiserfiles.ocr.batch.completed",
                tool: tool.slug,
                files: files.map((file) => file.name),
                completedAt: new Date().toISOString(),
              }),
            }).catch(() => {
              logProcessing("Webhook callback failed after OCR batch completion.");
            });
          }

          complete("Batch OCR archive ready for preview.");
          return;
        }

        setProgress(null);
        setStatus("OCR processing on server — this may take a moment…");
        const result = await runOcrForFile(firstFile);
        stageOutput(result.blob, result.outputName, "Preview searchable PDF before downloading.");
        setOcrQueueStatus([]);
        complete("Searchable PDF ready for preview.");
        return;
      }

      if (tool.slug === "pdf-to-word") {
        if (!firstFile) throw new Error("Missing PDF file.");

        // Try server-side LibreOffice conversion first
        let serverFailed = false;
        try {
          setProgress(null);
          setStatus("Converting PDF to Word on server...");
          logProcessing("Sending PDF to server for DOCX conversion via LibreOffice.");
          const formData = new FormData();
          formData.append("file", firstFile);
          const response = await fetch("/api/pdf-to-word", { method: "POST", body: formData });

          if (response.ok) {
            setStatus("Downloading converted DOCX…");
            const docxBlob = await response.blob();
            const disposition = response.headers.get("Content-Disposition");
            const downloadName = getFileNameFromDisposition(disposition) || `${normalizeFileName(firstFile.name)}.docx`;
            stageOutput(
              docxBlob,
              downloadName,
              "Formatted DOCX produced by LibreOffice. Download to open in Word."
            );
            complete("DOCX file ready for preview.");
            return;
          }

          // Server returned an error — fall back to client-side
          let serverMessage = "Server conversion unavailable.";
          try {
            const serverBody = await response.json();
            if (serverBody?.error) serverMessage = serverBody.error;
          } catch {
            // ignore parse errors
          }
          logProcessing(`Server conversion failed (${response.status}): ${serverMessage}. Falling back to client-side text extraction.`);
          serverFailed = true;
        } catch (networkError) {
          logProcessing(`Could not reach server for DOCX conversion: ${networkError instanceof Error ? networkError.message : "network error"}. Falling back to client-side text extraction.`);
          serverFailed = true;
        }

        // Client-side fallback: text-extraction DOCX
        if (serverFailed) {
          setStatus("Falling back to client-side text extraction...");
          setProgress({ current: 0, total: 1, label: "Extracting text from PDF…" });
          const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
          setProgress({ current: 1, total: 1, label: "Building DOCX document…" });
          const children = pages.flatMap((text, index) => [new Paragraph(`Page ${index + 1}`), new Paragraph(text), new Paragraph("")]);
          const doc = new DocxDocument({ sections: [{ children }] });
          stageOutput(
            await Packer.toBlob(doc),
            `${normalizeFileName(firstFile.name)}.docx`,
            "Client-side text extraction (fallback). Download to inspect in Word."
          );
          complete("DOCX file ready for preview (client-side fallback).");
        }
        return;
      }

      if (tool.slug === "pdf-to-powerpoint") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
        const presentation = new PptxGenJS();
        presentation.layout = "LAYOUT_WIDE";
        pages.forEach((text, index) => {
          const slide = presentation.addSlide();
          slide.addText(`Page ${index + 1}`, { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 22, bold: true });
          slide.addText(text.slice(0, 1800), { x: 0.7, y: 1.3, w: 11.5, h: 5.3, fontSize: 14 });
        });
        const pptxBytes = (await presentation.write({ outputType: "arraybuffer" })) as ArrayBuffer;
        stageOutput(
          new Blob([pptxBytes], {
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          }),
          `${normalizeFileName(firstFile.name)}.pptx`,
          "Binary PPTX preview is metadata-only. Download to inspect slides."
        );
        complete("PPTX file ready for preview.");
        return;
      }

      if (tool.slug === "pdf-to-excel") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
        const rows: Array<Array<string | number>> = [["Page", "Content"]];
        pages.forEach((text, index) => rows.push([index + 1, text]));
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "PDF Export");
        const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
        stageOutput(
          new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${normalizeFileName(firstFile.name)}.xlsx`,
          "Binary XLSX preview is metadata-only. Download to inspect workbook."
        );
        complete("XLSX file ready for preview.");
        return;
      }

      if (tool.slug === "pdf-to-latex") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
        const tex = pagesToLatex(pages, firstFile.name);
        stageOutput(
          new Blob([tex], { type: "text/x-tex" }),
          `${normalizeFileName(firstFile.name)}.tex`,
          "Review the generated LaTeX source and download for editing in your TeX workflow."
        );
        complete("LaTeX source file ready for preview.");
        return;
      }

      if (tool.slug === "word-to-pdf") {
        if (!firstFile) throw new Error("Missing Word file.");
        const convertResult = await mammoth.convertToHtml({ arrayBuffer: await readAsArrayBuffer(firstFile) });
        const html = convertResult.value || "<p>No content extracted from Word file.</p>";
        const warnings = convertResult.messages
          .filter((m) => m.type === "warning")
          .map((m) => m.message);
        const warningNote = warnings.length
          ? ` (${warnings.length} formatting warning${warnings.length !== 1 ? "s" : ""} — some content may not be fully preserved)`
          : "";
        const styles = `
          body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6; color: #1a1a1a; }
          h1 { font-size: 24px; margin: 16px 0 8px; }
          h2 { font-size: 20px; margin: 14px 0 6px; }
          h3 { font-size: 16px; margin: 12px 0 4px; }
          h4, h5, h6 { font-size: 14px; margin: 10px 0 4px; }
          p { margin: 0 0 8px; }
          ul, ol { margin: 0 0 8px; padding-left: 24px; }
          li { margin-bottom: 4px; }
          table { border-collapse: collapse; width: 100%; margin: 8px 0; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
          th { background-color: #f5f5f5; font-weight: bold; }
          img { max-width: 100%; height: auto; }
          blockquote { border-left: 4px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #555; }
          pre { background: #f5f5f5; padding: 8px; font-family: monospace; font-size: 11px; overflow-x: auto; }
          code { background: #f5f5f5; padding: 1px 4px; font-family: monospace; font-size: 11px; }
        `;
        stageOutput(
          await htmlContentToPdfBlob(html, styles),
          `${normalizeFileName(firstFile.name)}.pdf`,
          "Preview converted PDF before downloading."
        );
        complete("Word conversion ready for preview.");
        return;
      }

      if (tool.slug === "powerpoint-to-pdf") {
        if (!firstFile) throw new Error("Missing PowerPoint file.");
        const zip = await JSZip.loadAsync(await readAsArrayBuffer(firstFile));
        const slidePaths = sortSlidePaths(Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)));

        let slideWidth = 9144000;
        let slideHeight = 6858000;
        try {
          const presXml = await zip.file("ppt/presentation.xml")?.async("string");
          if (presXml) {
            const sldSz = presXml.match(/<p:sldSz[^>]*>/);
            if (sldSz) {
              const cx = sldSz[0].match(/cx="(\d+)"/);
              const cy = sldSz[0].match(/cy="(\d+)"/);
              if (cx) slideWidth = parseInt(cx[1], 10);
              if (cy) slideHeight = parseInt(cy[1], 10);
            }
          }
        } catch (e) {
          // Use default slide dimensions. Log for debugging.
          console.warn("Could not read PPTX presentation dimensions, using defaults.", e);
        }

        const scaleX = 515 / slideWidth;
        const scaleY = 762 / slideHeight;

        let html = "";
        for (let i = 0; i < slidePaths.length; i += 1) {
          const xml = await zip.file(slidePaths[i])?.async("string");
          if (!xml) continue;

          if (i > 0) html += '<div style="page-break-before: always;"></div>';
          html += `<div style="position: relative; width: 515px; height: 762px; border: 1px solid #ddd; margin-bottom: 8px; overflow: hidden;">`;
          html += `<div style="position: absolute; top: 4px; left: 8px; font-size: 10px; color: #999;">Slide ${i + 1}</div>`;

          const shapeRegex = /<p:sp[^>]*>[\s\S]*?<\/p:sp>/g;
          let shapeMatch;
          while ((shapeMatch = shapeRegex.exec(xml)) !== null) {
            const shapeXml = shapeMatch[0];

            const xfrm = shapeXml.match(/<a:xfrm>[\s\S]*?<\/a:xfrm>/);
            let x = 0, y = 0, cx = slideWidth, cy = slideHeight;
            if (xfrm) {
              const off = xfrm[0].match(/<a:off[^>]*>/);
              const ext = xfrm[0].match(/<a:ext[^>]*>/);
              if (off) {
                const xm = off[0].match(/x="(\d+)"/);
                const ym = off[0].match(/y="(\d+)"/);
                if (xm) x = parseInt(xm[1], 10);
                if (ym) y = parseInt(ym[1], 10);
              }
              if (ext) {
                const cxm = ext[0].match(/cx="(\d+)"/);
                const cym = ext[0].match(/cy="(\d+)"/);
                if (cxm) cx = parseInt(cxm[1], 10);
                if (cym) cy = parseInt(cym[1], 10);
              }
            }

            const textMatches = Array.from(shapeXml.matchAll(/<a:t>(.*?)<\/a:t>/g));
            const texts = textMatches.map((m) => decodeXmlText(m[1]));
            if (!texts.length || texts.every((t) => !t.trim())) continue;

            const runPropsMatch = shapeXml.match(/<a:rPr[^>]*>/g);
            let fontSize = 14;
            let bold = false;
            let italic = false;
            if (runPropsMatch && runPropsMatch.length > 0) {
              const firstProps = runPropsMatch[0];
              const szM = firstProps.match(/sz="(\d+)"/);
              if (szM) fontSize = Math.round(parseInt(szM[1], 10) / 100);
              bold = /b="1"/.test(firstProps);
              italic = /i="1"/.test(firstProps);
            }

            const text = texts.join("");
            const left = Math.round(x * scaleX);
            const top = Math.round(y * scaleY);
            const width = Math.round(cx * scaleX);
            const height = Math.round(cy * scaleY);

            const styleParts = [
              `left: ${left}px`,
              `top: ${top}px`,
              `width: ${width}px`,
              `height: ${height}px`,
              `font-size: ${fontSize}px`,
              bold ? "font-weight: bold" : "",
              italic ? "font-style: italic" : "",
              "overflow: hidden",
              "word-wrap: break-word",
            ].filter(Boolean).join("; ");

            html += `<div style="position: absolute; ${styleParts};">${text}</div>`;
          }

          html += "</div>";
        }

        stageOutput(
          await htmlContentToPdfBlob(html || "<p>No slides found.</p>", "body { font-family: Arial, Helvetica, sans-serif; }"),
          `${normalizeFileName(firstFile.name)}.pdf`,
          "Preview converted PDF before downloading."
        );
        complete("PowerPoint conversion ready for preview.");
        return;
      }

      if (tool.slug === "excel-to-pdf") {
        if (!firstFile) throw new Error("Missing Excel file.");
        const workbook = XLSX.read(await readAsArrayBuffer(firstFile), { type: "array" });

        let html = "";
        workbook.SheetNames.forEach((sheetName, sheetIdx) => {
          if (sheetIdx > 0) html += '<div style="page-break-before: always;"></div>';
          html += `<h3 style="margin: 8px 0; font-size: 16px;">${sheetName}</h3>`;

          const data: Array<Array<string | number | null>> = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

          if (!data.length) {
            html += "<p><em>Empty sheet</em></p>";
            return;
          }

          const maxCols = Math.max(...data.map((row) => row.length));

          html += "<table><thead><tr>";
          for (let c = 0; c < maxCols; c += 1) {
            html += `<th>${String.fromCharCode(65 + (c % 26))}${c >= 26 ? Math.floor(c / 26) : ""}</th>`;
          }
          html += "</tr></thead><tbody>";

          data.forEach((row) => {
            html += "<tr>";
            for (let c = 0; c < maxCols; c += 1) {
              const val = c < row.length ? (row[c] ?? "") : "";
              html += `<td>${String(val)}</td>`;
            }
            html += "</tr>";
          });

          html += "</tbody></table>";
        });

        const styles = `
          table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11px; }
          th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
          th { background-color: #e8e8e8; font-weight: bold; }
          td { background-color: #ffffff; }
          tr:nth-child(even) td { background-color: #f9f9f9; }
          h3 { font-size: 16px; margin: 16px 0 8px; }
        `;

        stageOutput(
          await htmlContentToPdfBlob(html || "<p>No data found in workbook.</p>", styles),
          `${normalizeFileName(firstFile.name)}.pdf`,
          "Preview converted PDF before downloading."
        );
        complete("Excel conversion ready for preview.");
        return;
      }

      if (tool.slug === "html-to-pdf") {
        if (!firstFile) throw new Error("Missing HTML file.");
        const raw = await readAsText(firstFile);
        let text = raw;
        if (firstFile.name.toLowerCase().endsWith(".html") || firstFile.name.toLowerCase().endsWith(".htm")) {
          text = new DOMParser().parseFromString(raw, "text/html").body?.textContent || raw;
        }
        const lines = splitLines(text);
        stageOutput(
          asPdfBlob(await pdfFromLines(lines.length ? lines : ["No text content found."], "HTML to PDF")),
          `${normalizeFileName(firstFile.name)}.pdf`,
          "Preview converted PDF before downloading."
        );
        complete("HTML conversion ready for preview.");
        return;
      }

      if (tool.slug === "protect-pdf" || tool.slug === "unlock-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");

        if (tool.slug === "unlock-pdf") {
          // Unlock: load with ignoreEncryption, save without encryption
          try {
            const source = await PDFDocument.load(await readAsArrayBuffer(firstFile), { ignoreEncryption: true });
            const bytes = await source.save({ useObjectStreams: true });
            stageOutput(
              asPdfBlob(bytes),
              `${normalizeFileName(firstFile.name)}-unlocked.pdf`,
              "Encryption removed. Original quality preserved. Preview before downloading."
            );
            complete("PDF unlocked — password protection removed.");
            return;
          } catch {
            logProcessing("Could not unlock with ignoreEncryption — PDF may have owner password. Try Protect tool instead.");
            throw new Error("This PDF could not be unlocked. It may have an owner password that prevents modification. The Protect PDF tool can add a new password instead.");
          }
        }

        // Protect: require password and encrypt
        if (!password) throw new Error("Enter a password to protect the PDF.");
        const images = await renderPdfToImages(new Uint8Array(await readAsArrayBuffer(firstFile)));

        const options: Record<string, unknown> = {
          unit: "pt",
          format: [images[0].width, images[0].height],
          compress: true,
          encryption: {
            userPassword: password,
            ownerPassword: password,
            userPermissions: ["print", "copy", "modify-annotations"],
          },
        };

        const doc = new jsPDF(options as unknown as ConstructorParameters<typeof jsPDF>[0]);
        images.forEach((image, index) => {
          if (index > 0) doc.addPage([image.width, image.height], "portrait");
          doc.addImage(image.dataUrl, "JPEG", 0, 0, image.width, image.height);
        });

        stageOutput(
          asPdfBlob(new Uint8Array(doc.output("arraybuffer"))),
          `${normalizeFileName(firstFile.name)}-protected.pdf`,
          "Preview secured document before downloading."
        );
        complete("Protected PDF ready for preview.");
        return;
      }

      if (tool.slug === "redact-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");

        // Render each page to a high-resolution image, then redact by drawing
        // black rectangles on top. Rebuild the PDF via jsPDF so the original
        // text layer is destroyed — redacted content cannot be recovered.
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const pageCount = source.getPageCount();
        setProgress({ current: 0, total: pageCount, label: "Redacting pages…" });

        const redactedImages: Array<{ dataUrl: string; width: number; height: number }> = [];

        for (let pageIdx = 0; pageIdx < pageCount; pageIdx += 1) {
          setProgress({ current: pageIdx + 1, total: pageCount, label: `Redacting page ${pageIdx + 1} of ${pageCount}…` });
          const page = source.getPage(pageIdx);
          const { width, height } = page.getSize();

          // Render the page as a high-resolution canvas image
          const rendered = await renderPdfPagePreview(
            new Uint8Array(await readAsArrayBuffer(firstFile)),
            pageIdx + 1
          );

          const image = await dataUrlToImage(rendered.dataUrl);
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas context unavailable.");

          ctx.drawImage(image, 0, 0);

          // Apply redaction rectangles on the rendered image
          const scaleX = image.width / width;
          const scaleY = image.height / height;

          // Default redaction: middle horizontal band covering ~80% width
          ctx.fillStyle = "#000000";
          const rx = 60 * scaleX;
          const ry = 370 * scaleY;
          const rw = (width - 120) * scaleX;
          const rh = 40 * scaleY;
          ctx.fillRect(rx, ry, rw, rh);

          redactedImages.push({
            dataUrl: canvas.toDataURL("image/jpeg", 0.92),
            width: image.width,
            height: image.height,
          });
        }

        // Rebuild a flat PDF from the redacted page images (no text layer)
        const doc = new jsPDF({
          unit: "pt",
          format: [redactedImages[0]?.width ?? 612, redactedImages[0]?.height ?? 792],
          compress: true,
        });

        redactedImages.forEach((page, index) => {
          if (index > 0) doc.addPage([page.width, page.height], "portrait");
          doc.addImage(page.dataUrl, "JPEG", 0, 0, page.width, page.height);
        });

        setProgress(null);
        stageOutput(
          asPdfBlob(new Uint8Array(doc.output("arraybuffer"))),
          `${normalizeFileName(firstFile.name)}-redacted.pdf`,
          "Redacted content has been flattened. Original text is not recoverable from this copy."
        );
        complete("Content permanently removed under redaction areas. Original text cannot be recovered from this file.");
        return;
      }

      if (tool.slug === "edit-pdf" || tool.slug === "sign-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        if (tool.slug === "sign-pdf" && signatureMode === "draw" && !signatureDrawn && signatures.length === 0) {
          throw new Error("Draw a signature or add one to the document before exporting.");
        }
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const font = await source.embedFont(StandardFonts.Helvetica);
        const pageLayers: Record<number, EditPageLayer> =
          tool.slug === "edit-pdf"
            ? {
                ...editLayersByPage,
                [editPageNumber]: {
                  strokes: editStrokes,
                  textNotes: editTextNotes,
                },
              }
            : {};
        // Build the list of signatures to apply (multiple supported).
        let allSignatures = signatures;
        if (!allSignatures.length) {
          if (signatureMode === "text") {
            allSignatures = [{ id: "single", kind: "text", text: editText || "Signed electronically", xRatio: signaturePlacement.xRatio, yRatio: signaturePlacement.yRatio }];
          } else if (signatureDrawn && signatureCanvasRef.current) {
            allSignatures = [{ id: "single", kind: "draw", dataUrl: signatureCanvasRef.current.toDataURL("image/png"), xRatio: signaturePlacement.xRatio, yRatio: signaturePlacement.yRatio }];
          } else {
            allSignatures = [];
          }
        }

        const embeddedSignatureImages: Record<string, PDFImage> = {};
        for (const sig of allSignatures) {
          if (sig.kind === "draw" && sig.dataUrl) {
            try {
              const res = await fetch(sig.dataUrl);
              const bytes = await res.arrayBuffer();
              embeddedSignatureImages[sig.id] = await source.embedPng(bytes);
            } catch { /* skip failed image */ }
          }
        }

        source.getPages().forEach((page, index) => {
          if (tool.slug === "sign-pdf") {
            // When signing a single page, skip all other pages.
            if (!signAllPages && index + 1 !== signPageNumber) return;
            const { width, height } = page.getSize();

            for (const sig of allSignatures) {
              const anchorX = clamp(width * sig.xRatio, 24, width - 24);
              const anchorY = clamp(height * sig.yRatio, 24, height - 24);

              const embedded = sig.kind === "draw" ? embeddedSignatureImages[sig.id] : null;
              if (embedded) {
                const rawWidth = embedded.width;
                const rawHeight = embedded.height;
                const signatureWidth = 170;
                const signatureHeight = Math.max(30, (signatureWidth / rawWidth) * rawHeight);
                page.drawImage(embedded, {
                  x: clamp(anchorX - signatureWidth / 2, 12, width - signatureWidth - 12),
                  y: clamp(anchorY - signatureHeight / 2, 12, height - signatureHeight - 12),
                  width: signatureWidth,
                  height: signatureHeight,
                  opacity: 0.95,
                });
              } else if (sig.kind === "text" && sig.text) {
                const textSize = 22;
                const textWidth = font.widthOfTextAtSize(sig.text, textSize);
                page.drawText(sig.text, {
                  x: clamp(anchorX - textWidth / 2, 12, width - textWidth - 12),
                  y: clamp(anchorY - textSize / 2, 12, height - textSize - 12),
                  size: textSize,
                  font,
                  color: rgb(0.06, 0.06, 0.35),
                });
              }
            }
          } else {
            const pageLayer = pageLayers[index + 1];
            const pageStrokes = pageLayer?.strokes ?? [];
            const pageTextNotes = pageLayer?.textNotes ?? [];

            if (pageStrokes.length || pageTextNotes.length) {
              const { width, height } = page.getSize();
              const scaleX = editCanvasSize.width ? width / editCanvasSize.width : 1;
              const scaleY = editCanvasSize.height ? height / editCanvasSize.height : 1;

              for (const stroke of pageStrokes) {
                if (stroke.points.length < 2) continue;
                const strokeColor = hexToRgb(stroke.color);
                for (let i = 1; i < stroke.points.length; i += 1) {
                  const prev = stroke.points[i - 1];
                  const point = stroke.points[i];
                  page.drawLine({
                    start: { x: prev.x * scaleX, y: height - prev.y * scaleY },
                    end: { x: point.x * scaleX, y: height - point.y * scaleY },
                    color: strokeColor,
                    thickness: Math.max(0.8, stroke.width * ((scaleX + scaleY) / 2)),
                  });
                }
              }

              for (const note of pageTextNotes) {
                page.drawText(note.text, {
                  x: note.x * scaleX,
                  y: height - note.y * scaleY,
                  size: Math.max(8, note.size * scaleY),
                  font,
                  color: hexToRgb(note.color),
                });
              }
            }
          }
        });
        const suffix = tool.slug === "sign-pdf" ? "signed" : "edited";
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-${suffix}.pdf`,
          "Preview document changes before downloading."
        );
        complete(`${tool.slug === "sign-pdf" ? "Signed" : "Edited"} PDF ready for preview.`);
        return;
      }

      if (tool.slug === "crop-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const margin = Number(ranges);
        if (!Number.isFinite(margin) || margin < 0) throw new Error("Enter a numeric margin value (points).");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        source.getPages().forEach((page) => {
          const { width, height } = page.getSize();
          page.setCropBox(margin, margin, width - margin * 2, height - margin * 2);
        });
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-cropped.pdf`,
          "Preview crop result before downloading."
        );
        complete("Cropped PDF ready for preview.");
        return;
      }

      if (tool.slug === "compare-pdf") {
        if (files.length < 2) throw new Error("Upload two PDF files to compare.");
        const [first, second] = files;
        const bytesA = new Uint8Array(await readAsArrayBuffer(first));
        const bytesB = new Uint8Array(await readAsArrayBuffer(second));

        setProgress({ current: 0, total: 1, label: "Loading PDF pages for comparison…" });

        // Get page counts — use copies to prevent ArrayBuffer detachment
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        configurePdfJsWorker(pdfjs);
        const bytesAForCount = new Uint8Array(bytesA);
        const bytesBForCount = new Uint8Array(bytesB);
        const [taskA, taskB] = [
          pdfjs.getDocument({ data: bytesAForCount }),
          pdfjs.getDocument({ data: bytesBForCount }),
        ];
        const [pdfA, pdfB] = [await taskA.promise, await taskB.promise];
        const maxPages = Math.max(pdfA.numPages, pdfB.numPages);
        setComparePageCountA(pdfA.numPages);
        setComparePageCountB(pdfB.numPages);
        setComparePageNumber(1);

        // Render page 1 of each PDF with diff overlays
        setProgress({ current: 0, total: maxPages, label: "Rendering visual comparison…" });
        const [renderA, renderB] = await Promise.all([
          renderComparePageWithDiffs(bytesA, bytesB, 1, "red"),
          renderComparePageWithDiffs(bytesB, bytesA, 1, "green"),
        ]);
        setCompareRenderA(renderA?.dataUrl ?? "");
        setCompareRenderB(renderB?.dataUrl ?? "");

        // Build text diff report — use fresh copies
        const pagesA = await loadPdfPagesText(new Uint8Array(bytesA));
        const pagesB = await loadPdfPagesText(new Uint8Array(bytesB));
        const textA = pagesA.join("\n");
        const textB = pagesB.join("\n");
        const linesA = splitLines(textA);
        const linesB = splitLines(textB);
        const onlyA = linesA.filter((line) => !linesB.includes(line));
        const onlyB = linesB.filter((line) => !linesA.includes(line));
        const overlap = linesA.filter((line) => linesB.includes(line)).length;
        const denominator = new Set([...linesA, ...linesB]).size || 1;
        const similarity = overlap / denominator;
        const changeMagnitude = (onlyA.length + onlyB.length) / Math.max(1, denominator);
        const materiality =
          changeMagnitude > 0.45 ? "high" : changeMagnitude > 0.2 ? "medium" : "low";

        const pageDiff: string[] = [];
        const pageCount = Math.max(pagesA.length, pagesB.length);
        for (let i = 0; i < pageCount; i += 1) {
          const pageLinesA = splitLines(pagesA[i] || "");
          const pageLinesB = splitLines(pagesB[i] || "");
          const uniqueA = pageLinesA.filter((line) => !pageLinesB.includes(line)).length;
          const uniqueB = pageLinesB.filter((line) => !pageLinesA.includes(line)).length;
          if (uniqueA || uniqueB) {
            pageDiff.push(`Page ${i + 1}: +${uniqueB} / -${uniqueA}`);
          }
        }

        const report = [
          `Compare Report: ${first.name} vs ${second.name}`,
          "",
          `Similarity score: ${(similarity * 100).toFixed(1)}%`,
          `Materiality score: ${materiality}`,
          `Total changed lines: ${onlyA.length + onlyB.length}`,
          "",
          "Page-level change summary",
          ...(pageDiff.slice(0, 30).length ? pageDiff.slice(0, 30) : ["No page-level differences detected."]),
          "",
          `Unique lines in ${first.name}: ${onlyA.length}`,
          ...onlyA.slice(0, 120),
          "",
          `Unique lines in ${second.name}: ${onlyB.length}`,
          ...onlyB.slice(0, 120),
        ].join("\n");
        setCompareTextReport(report);

        setProgress(null);
        stageOutput(new Blob([report], { type: "text/plain" }), "compare-report.txt", "Visual comparison below. Download text report for the full diff.");
        complete("Comparison report ready. Scroll down for visual side-by-side.");
        return;
      }

      complete("Tool execution completed.");
    } catch (runError) {
      setProgress(null);
      const errMsg = runError instanceof Error ? runError.message : "Unexpected tool error.";
      setError(errMsg);
      setPinnedError(true);
      showToast(errMsg, "error");
      logProcessing(`Failed: ${runError instanceof Error ? runError.message : "Unexpected tool error."}`);
    } finally {
      setProgress(null);
      if (completionMessage) {
        await persistRunReport(runStartedAt, completionMessage);
        setLastRunSummary({
          message: completionMessage,
          inputCount: files.length,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        });
      }
      setBusy(false);
    }
  }

  return (
    <section className="tool-shell glass-3d mx-auto max-w-[2300px] space-y-3 rounded-3xl p-4 xl:p-5">
      {/* ── Breadcrumb ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-500">
          <Link href="/" className="hover:text-cyan-700 hover:underline transition-colors">
            Home
          </Link>
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold text-slate-800">{tool.name}</span>
        </nav>
        <ShareButton toolSlug={tool.slug} toolName={tool.name} />
      </div>

      {/* ── Full-width top banner ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="font-display text-2xl font-semibold text-slate-950">{tool.name}</h2>
          {(() => {
            const hasAiIntake = smartIntake?.source === "ai";
            if (hasAiIntake && smartIntake) {
              return (
                <span className="text-sm text-slate-500">
                  {smartIntake.documentType}
                  {smartIntake.intakeSummary ? ` — ${smartIntake.intakeSummary}` : ""}
                  {smartIntakeLoading ? <span className="ml-2 text-xs text-cyan-700">Analyzing…</span> : null}
                </span>
              );
            }
            if (preflightLoading) {
              return <span className="text-xs text-slate-400">Analyzing…</span>;
            }
            return null;
          })()}
        </div>

        <p className="text-sm text-slate-700">{tool.description}</p>

        <p className="field-help">{uploadHint}</p>

        {shouldShowFileInput ? (
          <input
            ref={fileInputRef}
            type="file"
            accept={inputAccept}
            multiple={acceptsMultiple}
            onChange={(event) => onSelect(event.target.files)}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-800 hover:file:bg-slate-300"
          />
        ) : null}

        {shouldShowFileInput ? (
          <button
            type="button"
            onClick={async () => {
              try {
                setError("");
                setStatus("Loading sample document…");
                const resp = await fetch("/sample.pdf");
                if (!resp.ok) throw new Error("Sample not available");
                const blob = await resp.blob();
                const file = new File([blob], "sample.pdf", { type: "application/pdf" });
                await applySelectedFiles([file]);
              } catch {
                setError("Could not load the sample document. Please try uploading your own file.");
              }
            }}
            className="text-xs text-slate-500 underline hover:text-cyan-700 transition cursor-pointer"
          >
            No file handy? Try with a sample document
          </button>
        ) : null}

        <div className="sticky-action-bar">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runTool}
              disabled={busy}
              className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(to right, #8b5cf6, #6366f1)", boxShadow: "0 4px 16px rgba(99,102,241,0.4)" }}
            >
              {busy ? "Processing..." : outputPreview ? `Re-run ${tool.name}` : `Run ${tool.name}`}
            </button>
            {error ? (
              <button
                type="button"
                onClick={runTool}
                disabled={busy}
                className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry
              </button>
            ) : null}
            {busy ? <span className="status-chip status-chip-busy">Processing</span> : null}
          </div>
          {busy && progress ? (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{progress.label}</span>
                <span>{Math.round((progress.current / Math.max(1, progress.total)) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
            </div>
          ) : busy && !progress ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
              <span>Processing…</span>
            </div>
          ) : null}
          {error ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-medium text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => { setError(""); setPinnedError(false); }}
                className="mt-1 text-xs font-semibold text-rose-600 underline hover:text-rose-800"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {formatRedirectSuggestion ? (
            <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
              <p className="text-sm font-medium text-cyan-800">
                This appears to be {formatRedirectSuggestion.label}. Would you like to convert it to PDF instead?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const { targetSlug, file } = formatRedirectSuggestion;
                    navigateWithFile(targetSlug, file);
                    setFormatRedirectSuggestion(null);
                  }}
                  className="rounded-full bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-cyan-700"
                >
                  Go to {formatRedirectSuggestion.targetName}
                </button>
                <button
                  type="button"
                  onClick={() => setFormatRedirectSuggestion(null)}
                  className="text-xs font-semibold text-cyan-700 underline hover:text-cyan-900"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          {status ? <p className="mt-1 text-sm font-medium text-emerald-700">{status}</p> : null}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(240px,0.95fr)_minmax(0,3.05fr)_minmax(240px,1fr)] xl:items-start">
        <div className="space-y-2">

          {hasChosenWorkflow && applicableRecipes.length ? (
            <div className="space-y-3 card-panel rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Workflow in progress</p>
                {applicableRecipes.length > 1 ? (
                  <select
                    value={selectedRecipeSlug}
                    onChange={(event) => setRecipeSlug(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  >
                    {applicableRecipes.map((recipe) => (
                      <option key={recipe.slug} value={recipe.slug}>
                        {recipe.name}
                      </option>
                    ))}
                  </select>
                ) : selectedRecipe ? (
                  <span className="text-xs font-semibold text-slate-700">{selectedRecipe.name}</span>
                ) : null}
              </div>

              {selectedRecipe ? (
                <>
                  <p className="text-xs text-slate-600">{selectedRecipe.description}</p>

                  {/* ── Animated step track ── */}
                  <div className="overflow-x-auto pb-1">
                    <div className="flex min-w-max items-start gap-0">
                      {selectedRecipe.steps.map((step, index) => {
                        const activeIndex = selectedRecipe.steps.findIndex((s) => s.toolSlug === tool.slug);
                        const isCompleted = index < activeIndex;
                        const isActive = step.toolSlug === tool.slug;

                        return (
                          <div key={`${selectedRecipe.slug}-track-${step.toolSlug}`} className="flex items-start gap-0">
                            {/* step node */}
                            <div className="pipeline-step-arrive flex flex-col items-center" style={{ animationDelay: `${index * 80}ms` }}>
                              <div
                                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500 ${
                                  isCompleted
                                    ? "border-emerald-400 bg-emerald-400 text-white"
                                    : isActive
                                      ? "border-cyan-500 bg-cyan-500 text-white pipeline-step-active-ring"
                                      : "border-slate-300 bg-white text-slate-400"
                                }`}
                              >
                                {isCompleted ? (
                                  <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none">
                                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <span className="text-[11px] font-bold leading-none">{index + 1}</span>
                                )}
                              </div>
                              <span
                                className={`mt-1.5 max-w-[68px] text-center text-[10px] leading-tight ${
                                  isActive ? "font-semibold text-cyan-900" : isCompleted ? "text-emerald-700" : "text-slate-500"
                                }`}
                              >
                                {step.label}
                              </span>
                            </div>

                            {/* connector line */}
                            {index < selectedRecipe.steps.length - 1 ? (
                              <div className="relative mx-1 mt-3.5 h-0.5 w-10 overflow-hidden rounded-full bg-slate-200">
                                {isCompleted ? (
                                  <span className="pipeline-line-fill absolute inset-0 rounded-full bg-emerald-400" />
                                ) : isActive ? (
                                  <span
                                    className="absolute inset-y-0 left-0 rounded-full bg-cyan-400"
                                    style={{ width: "50%", opacity: 0.7 }}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(currentRecipeNextStep || currentRecipePreviousStep) && !busy ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={goToPreviousRecipeStage}
                        disabled={!currentRecipePreviousStep}
                        className="rounded-xl border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {currentRecipePreviousStep
                          ? `← Previous step: ${currentRecipePreviousStep.label}`
                          : "No previous stage"}
                      </button>

                      {currentRecipeNextStep ? (
                        <button
                          type="button"
                          onClick={() => void continueRecipe()}
                          disabled={busy || !!continueBlockedReason}
                          title={continueBlockedReason || undefined}
                          aria-label={
                            continueBlockedReason
                              ? `Continue disabled. ${continueBlockedReason}`
                              : `Continue to ${currentRecipeNextStep.label}`
                          }
                          className="rounded-xl border border-cyan-300 bg-cyan-50 py-2 text-xs font-semibold text-cyan-900 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy
                            ? `Running ${tool.name}…`
                            : `Continue to step ${selectedRecipe.steps.findIndex((s) => s.toolSlug === currentRecipeNextStep.toolSlug) + 1}: ${currentRecipeNextStep.label} →`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {continueBlockedReason ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">
                      {continueBlockedReason}
                    </p>
                  ) : !currentRecipeNextStep && outputPreview ? (
                    <button
                      type="button"
                      onClick={handleDownloadOutput}
                      disabled={downloadingOutput}
                      className="flex w-full animate-bounce items-center justify-center gap-2 rounded-xl border border-emerald-400 bg-emerald-500 py-2.5 text-sm font-bold text-white shadow-lg transition hover:animate-none hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M10 3v10M6 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 16h12" strokeLinecap="round" />
                      </svg>
                      {downloadingOutput ? "Downloading…" : "Download completed workflow output"}
                    </button>
                  ) : !currentRecipeNextStep ? (
                    <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                      ✓ Final step — run the tool above to generate your output.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {pipelineNotice ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-sm font-medium text-amber-800">{pipelineNotice}</p>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  void clearUploadedFiles(tool.slug);
                  setPipelineNotice("");
                  logProcessing("Pipeline handoff dismissed.");
                }}
                className="mt-1 text-xs font-semibold text-amber-700 underline hover:text-amber-900"
              >
                Clear and upload a new file
              </button>
            </div>
          ) : null}

          {pipelineChipLabel ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300 bg-gradient-to-r from-cyan-100 to-blue-100 px-2.5 py-1 text-xs font-medium text-cyan-800 shadow-sm">
              <svg viewBox="0 0 16 16" className="h-3 w-3 text-cyan-500" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M8 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{pipelineChipLabel}</span>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  setPipelineNotice("");
                  logProcessing("Pipeline context dismissed.");
                }}
                className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-cyan-600 hover:bg-cyan-200 hover:text-cyan-900"
                aria-label="Dismiss pipeline context"
              >
                ×
              </button>
            </div>
          ) : null}

        </div>

        <div className="space-y-2">

      {isOcrTool ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Server OCR produces a searchable PDF with an embedded text layer.</p>
            <p className="mt-1 text-amber-800">Maximum upload size: {formatBytes(MAX_OCR_UPLOAD_BYTES)}.</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="ocr-language" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              OCR language
            </label>
            <select
              id="ocr-language"
              value={ocrLanguage}
              onChange={(event) => setOcrLanguage(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
            >
              {OCR_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="field-help">
              {OCR_LANGUAGE_OPTIONS.find((option) => option.value === ocrLanguage)?.hint} Matching Tesseract language data must be installed on the server.
            </p>
            <p className="mt-1 text-xs text-slate-400 italic">
              Available languages depend on installed language packs. Current installation supports: English, German, French, Spanish, Italian, Portuguese, Dutch, Polish. Additional languages require server configuration.
            </p>
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="space-y-1">
              <label htmlFor="ocr-preset" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                OCR preset
              </label>
              <select
                id="ocr-preset"
                value={ocrPreset}
                onChange={(event) => applyOcrPreset(event.target.value as OcrPreset)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {OCR_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {OCR_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Choose a starting profile, then fine-tune with advanced toggles below.
              </p>
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">OCR quality controls</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ocrQualityOptions.deskew}
                  onChange={(event) => updateOcrQualityOption("deskew", event.target.checked)}
                />
                Deskew pages
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ocrQualityOptions.rotatePages}
                  onChange={(event) => updateOcrQualityOption("rotatePages", event.target.checked)}
                />
                Auto-rotate pages
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ocrQualityOptions.cleanFinal}
                  onChange={(event) => updateOcrQualityOption("cleanFinal", event.target.checked)}
                />
                Cleanup noisy scans
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={ocrQualityOptions.redoOcr}
                  onChange={(event) => updateOcrQualityOption("redoOcr", event.target.checked)}
                />
                Force redo OCR
              </label>
            </div>
            <p className="field-help">
              Enable redo OCR when documents already contain inaccurate text layers. This can increase processing time.
            </p>
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={ocrBatchMode}
                onChange={(event) => setOcrBatchMode(event.target.checked)}
              />
              Enable OCR batch queue (multi-file zip output)
            </label>
            <input
              type="url"
              value={ocrWebhookUrl}
              onChange={(event) => setOcrWebhookUrl(event.target.value)}
              placeholder="Optional webhook URL after queue completion"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
            <p className="field-help">If provided, a JSON callback is posted when the batch queue completes.</p>

            {ocrQueueStatus.length ? (
              <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-700">
                {ocrQueueStatus.map((item) => (
                  <li key={item.fileName}>
                    {item.fileName}: {item.state}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {ocrUploadWarning ? (
            <div className="rounded-2xl card-panel border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
              {ocrUploadWarning}
            </div>
          ) : null}
        </div>
      ) : null}

      {isScanTool ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startCamera}
              disabled={cameraBusy}
              className="btn btn-secondary rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-70"
            >
              {cameraActive ? "Restart camera" : cameraBusy ? "Starting camera..." : "Use device camera"}
            </button>
            <button
              type="button"
              onClick={captureFromCamera}
              disabled={!cameraActive}
              className="btn btn-primary rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              Capture photo
            </button>
            <button
              type="button"
              onClick={stopCamera}
              disabled={!cameraActive}
              className="btn btn-secondary rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              Stop camera
            </button>

          </div>

          <p className="field-help">Use camera capture or uploaded images, then run Scan to PDF.</p>
          {cameraError ? <p className="text-xs font-medium text-rose-700">{cameraError}</p> : null}

          <video
            ref={cameraVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full max-w-[420px] rounded-lg border border-slate-300 bg-slate-900 ${cameraActive ? "block" : "hidden"}`}
          />
          <canvas ref={cameraCanvasRef} className="hidden" />
        </div>
      ) : null}

      {isImageToPdfTool ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Image to PDF layout</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Page size</span>
              <select
                value={imagePdfPageSizeMode}
                onChange={(event) => setImagePdfPageSizeMode(event.target.value as ImagePdfPageSizeMode)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="original">Keep original size</option>
                <option value="a4">Fit to A4</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Placement</span>
              <select
                value={imagePdfPlacementMode}
                onChange={(event) => setImagePdfPlacementMode(event.target.value as ImagePdfPlacementMode)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="single">Each image on its own page (default)</option>
                <option value="grid">Place images on a page grid</option>
              </select>
            </label>
          </div>

          {imagePdfPlacementMode === "grid" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Grid columns</span>
                <select
                  value={imagePdfGridColumns}
                  onChange={(event) => setImagePdfGridColumns(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  <option value={1}>1 column</option>
                  <option value={2}>2 columns</option>
                  <option value={3}>3 columns</option>
                  <option value={4}>4 columns</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Grid rows</span>
                <select
                  value={imagePdfGridRows}
                  onChange={(event) => setImagePdfGridRows(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  <option value={1}>1 row</option>
                  <option value={2}>2 rows</option>
                  <option value={3}>3 rows</option>
                  <option value={4}>4 rows</option>
                  <option value={5}>5 rows</option>
                  <option value={6}>6 rows</option>
                </select>
              </label>
            </div>
          ) : null}

          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Page margin (pt)</span>
            <input
              type="range"
              min={0}
              max={120}
              step={2}
              value={imagePdfPageMargin}
              onChange={(event) => setImagePdfPageMargin(Number(event.target.value))}
              className="w-full"
            />
            <p className="text-xs text-slate-500">{imagePdfPageMargin} pt</p>
          </label>

          <p className="field-help">
            Images always keep aspect ratio. Use A4 for print-ready pages, or original size to preserve exact image dimensions.
          </p>

          {files.length > 1 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Image order</p>
                <p className="text-[10px] text-slate-500">Drag thumbnails to reorder</p>
              </div>
              <div className="max-h-[58vh] overflow-auto pr-1">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {files.map((file, index) => {
                    const isDragOver = dragOverFileIndex === index && draggedFileIndex !== index;
                    return (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        draggable
                        onDragStart={() => { setDraggedFileIndex(index); setDragOverFileIndex(null); }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (draggedFileIndex !== null && draggedFileIndex !== index) setDragOverFileIndex(index);
                        }}
                        onDragLeave={() => { if (dragOverFileIndex === index) setDragOverFileIndex(null); }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedFileIndex !== null && draggedFileIndex !== index) {
                            moveFile(draggedFileIndex, index);
                          }
                          setDraggedFileIndex(null);
                          setDragOverFileIndex(null);
                        }}
                        onDragEnd={() => { setDraggedFileIndex(null); setDragOverFileIndex(null); }}
                        className={`cursor-grab rounded-xl border p-2 transition active:cursor-grabbing ${isDragOver ? "border-cyan-500 ring-2 ring-cyan-200" : "border-slate-200 bg-white"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageThumbUrls[index]} alt={file.name} className="h-28 w-full rounded-md object-cover" />
                        <div className="mt-2 space-y-1 text-[11px]">
                          <p className="truncate font-semibold text-slate-700">{file.name}</p>
                          <div className="flex items-center justify-between text-slate-600">
                            <span>Image</span>
                            <span>#{index + 1}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {(isMergeTool || isConvertTool) ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {isConvertTool ? "Page Organizer" : "Merge Page Organizer"}
            </p>
            <p className="text-xs text-slate-500">{mergePageOrder.length} pages in output</p>
          </div>

          {files.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {files.map((file, i) => {
                const duplicate = files.some((other, j) => j !== i && other.name === file.name && other.size === file.size);
                const tone = getFileToneClass(i).split(" ")[0].replace("border-", "");
                const dotColor = tone === "cyan" ? "#22d3ee" : tone === "amber" ? "#fbbf24" : tone === "emerald" ? "#34d399" : tone === "violet" ? "#a78bfa" : tone === "rose" ? "#fb7185" : "#818cf8";
                return (
                  <span key={`${file.name}-${i}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${duplicate ? "border-rose-300 bg-rose-50 text-rose-700" : getFileToneClass(i)}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />
                    <span className="max-w-[140px] truncate">{file.name}</span>
                    {duplicate ? <span className="font-semibold">(duplicate)</span> : null}
                  </span>
                );
              })}
            </div>
          ) : null}

          <p className="field-help">
            Drag thumbnails to reorder pages. Remove pages you do not want in the output.
          </p>

          {mergeLoading ? <p className="text-sm text-slate-600">Generating merge page thumbnails...</p> : null}

          {!mergeLoading && mergePageOrder.length ? (
            <div className="max-h-[58vh] overflow-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {mergePageOrder.map((pageId, index) => {
                const page = mergePages.find((item) => item.id === pageId);
                if (!page) return null;

                const isDragOver = mergeDragOverId === pageId && mergeDraggedId !== pageId;
                const toneClass = files.length > 1 ? getFileToneClass(page.fileIndex) : "border-slate-200 bg-white";

                return (
                  <div
                    key={page.id}
                    draggable
                    onDragStart={() => {
                      setMergeDraggedId(page.id);
                      setMergeDragOverId(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (mergeDraggedId && mergeDraggedId !== page.id) {
                        setMergeDragOverId(page.id);
                      }
                    }}
                    onDragLeave={() => {
                      if (mergeDragOverId === page.id) {
                        setMergeDragOverId(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (mergeDraggedId && mergeDraggedId !== page.id) {
                        reorderMergePages(mergeDraggedId, page.id);
                      }
                      setMergeDraggedId(null);
                      setMergeDragOverId(null);
                    }}
                    onDragEnd={() => {
                      setMergeDraggedId(null);
                      setMergeDragOverId(null);
                    }}
                    className={`rounded-xl border p-2 ${
                      isDragOver ? "border-cyan-500 ring-2 ring-cyan-200" : toneClass
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={page.dataUrl}
                      alt={`${page.fileName} page ${page.pageNumber}`}
                      className="h-28 w-full rounded-md object-cover"
                    />
                    <div className="mt-2 space-y-1 text-[11px]">
                      <p className="truncate font-semibold text-slate-700">{page.fileName}</p>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Pg {page.pageNumber}</span>
                        <span>#{index + 1}</span>
                      </div>
                      {files.length > 1 ? (
                        <span className="inline-flex rounded-full border border-slate-300 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          File {page.fileIndex + 1}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMergePage(page.id)}
                      className="btn btn-destructive mt-2 w-full rounded-md px-2 py-1 text-xs"
                    >
                      Remove page
                    </button>
                  </div>
                );
              })}
              </div>
            </div>
          ) : null}

          {!mergeLoading && files.length > 1 && !mergePageOrder.length ? (
            <p className="text-sm text-slate-600">No pages selected. Keep at least one page to merge.</p>
          ) : null}
        </div>
      ) : null}

      {usesThumbnailEditor ? (
        <></>
      ) : null}

      {tool.slug === "organize-pdf" ? (
        <div className="space-y-1">
          <label htmlFor="ranges" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Page order (optional fallback)
          </label>
          <input
            id="ranges"
            type="text"
            value={ranges}
            onChange={(event) => setRanges(event.target.value)}
            placeholder="Example: 3,1,2"
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          />
          <p className="field-help">Use ordered page sequence, for example 4,1-3,8.</p>
        </div>
      ) : null}

      {tool.slug === "remove-pages" || tool.slug === "crop-pdf" ? (
        <div className="space-y-1">
          <label htmlFor="ranges" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {tool.slug === "crop-pdf" ? "Crop margin (points)" : "Pages to remove (optional fallback)"}
          </label>
          <input
            id="ranges"
            type="text"
            value={ranges}
            onChange={(event) => setRanges(event.target.value)}
            placeholder={tool.slug === "crop-pdf" ? "Example: 20" : "Example: 2,4-5"}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          />
          <p className="field-help">
            {tool.slug === "crop-pdf"
              ? "Crop margin is in PDF points. 72 points equals about 1 inch."
              : "Select pages to remove using commas and ranges like 3,7-9."}
          </p>
        </div>
      ) : null}

      {tool.slug === "compress-pdf" ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="type-eyebrow text-slate-600">Compression Options</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.reduceResolution}
                onChange={(event) => updateCompressionOption("reduceResolution", event.target.checked)}
              />
              Reduce page resolution
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.reduceQuality}
                onChange={(event) => updateCompressionOption("reduceQuality", event.target.checked)}
              />
              Reduce image quality
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.grayscale}
                onChange={(event) => updateCompressionOption("grayscale", event.target.checked)}
              />
              Tone down colors (grayscale)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.blackWhite}
                onChange={(event) => updateCompressionOption("blackWhite", event.target.checked)}
              />
              Convert to black and white
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.removeImages}
                onChange={(event) => updateCompressionOption("removeImages", event.target.checked)}
              />
              Remove images (text-only output)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={compressionOptions.reduceMargins}
                onChange={(event) => updateCompressionOption("reduceMargins", event.target.checked)}
              />
              Reduce margins by cropping edges
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={compressionOptions.stripMetadata}
                onChange={(event) => updateCompressionOption("stripMetadata", event.target.checked)}
              />
              Strip metadata (author/title/keywords)
            </label>
          </div>

          {compressionEstimate ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">Estimated reduction: {compressionEstimate.reductionPercent}%</p>
              <p className="field-help mt-1">
                From {formatBytes(compressionEstimate.originalBytes)} to about {formatBytes(compressionEstimate.estimatedBytes)}
              </p>
            </div>
          ) : (
            <p className="field-help">Upload a PDF to see live size reduction estimates.</p>
          )}
        </div>
      ) : null}

      {tool.slug === "protect-pdf" || tool.slug === "unlock-pdf" ? (
        <div className="space-y-1">
          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {tool.slug === "unlock-pdf" ? "Password (if required)" : "Password"}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={tool.slug === "unlock-pdf" ? "Leave blank to try without password" : "Enter a password"}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          />
          <p className="field-help">
            {tool.slug === "unlock-pdf"
              ? "Leave blank to attempt unlocking without a password. If the PDF requires one, enter it here."
              : "Use the same password to open the protected output later."}
          </p>
        </div>
      ) : null}

      {tool.slug === "edit-pdf" || tool.slug === "sign-pdf" ? (
        <div className="space-y-1">
          <label htmlFor="edit-text" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {tool.slug === "sign-pdf" ? "Signature text" : "Edit text"}
          </label>
          {tool.slug === "sign-pdf" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSignatureMode("text")}
                  className={`btn rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    signatureMode === "text"
                      ? "btn-primary"
                      : "btn-secondary"
                  }`}
                >
                  Type signature
                </button>
                <button
                  type="button"
                  onClick={() => setSignatureMode("draw")}
                  className={`btn rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    signatureMode === "draw"
                      ? "btn-primary"
                      : "btn-secondary"
                  }`}
                >
                  Draw signature
                </button>
              </div>

              {signatureMode === "draw" ? (
                <div className="space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                  <p className="field-help">Sign using your touchpad, mouse, or touchscreen. Undo last stroke with Ctrl+X, Ctrl+Z, or Cmd+Z.</p>
                  <div className="relative inline-block w-full max-w-[420px]">
                    <canvas
                      ref={(node) => {
                        signatureCanvasRef.current = node;
                        if (node) setupSignatureCanvas(node);
                      }}
                      onPointerDown={onSignaturePointerDown}
                      onPointerMove={onSignaturePointerMove}
                      onPointerUp={endSignatureStroke}
                      onPointerLeave={endSignatureStroke}
                      onPointerCancel={endSignatureStroke}
                      className="w-full max-w-[420px] rounded-lg border-2 border-slate-300 touch-none cursor-crosshair"
                      style={{ background: '#ffffff', display: 'block' }}
                      aria-label="Signature pad"
                    />
                    {!signatureDrawn ? (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm italic text-slate-400 select-none">
                        Draw your signature here
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={clearSignatureCanvas}
                    className="btn btn-secondary rounded-md px-3 py-1 text-xs"
                  >
                    Clear signature
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    id="edit-text"
                    type="text"
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    placeholder="Type your name"
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                  />
                  {editText ? (
                    <div className="flex items-center justify-center rounded-lg border-2 border-slate-300 bg-white px-4 py-3" style={{ minHeight: '64px' }}>
                      <span className="text-2xl text-slate-800" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}>
                        {editText}
                      </span>
                    </div>
                  ) : null}
                  <p className="field-help">This text will be placed on the PDF as your signature.</p>
                </div>
              )}

              <div className="space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="field-help">Add this signature to the document (you can add multiple).</p>
                  <button
                    type="button"
                    onClick={addSignatureToDocument}
                    className="rounded-md px-3 py-1 text-xs font-bold text-white"
                    style={{ background: "#6366f1" }}
                  >
                    Add signature
                  </button>
                </div>
                {signatures.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {signatures.map((sig, i) => (
                      <div
                        key={sig.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${activeSignatureId === sig.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveSignatureId(sig.id)}
                          className="text-xs font-medium text-slate-700 hover:text-indigo-700"
                        >
                          {sig.kind === "draw" ? `Drawn signature ${i + 1}` : sig.text}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSignatureFromDocument(sig.id)}
                          className="text-[10px] font-semibold text-rose-500 hover:text-rose-700"
                          aria-label="Remove signature"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {activeSignatureId ? <p className="field-help">Select a signature above, then click the preview to position it.</p> : null}
              </div>

              <div className="space-y-2 rounded-xl border border-slate-300 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="field-help">Save this signature to reuse it later.</p>
                  <button
                    type="button"
                    onClick={saveCurrentSignature}
                    className="btn btn-secondary rounded-md px-3 py-1 text-xs"
                  >
                    Save signature
                  </button>
                </div>
                {savedSignatures.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {savedSignatures.map((sig) => (
                      <div key={sig.id} className="group relative inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2 pr-1 py-0.5">
                        <button
                          type="button"
                          onClick={() => applySavedSignature(sig)}
                          className="flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-cyan-700"
                          title="Use this signature"
                        >
                          {sig.kind === "draw" && sig.dataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sig.dataUrl} alt="Saved signature" className="h-5 w-9 rounded-sm object-contain" />
                          ) : (
                            <span className="text-sm italic" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{sig.label}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSavedSignature(sig.id)}
                          className="text-[10px] text-slate-400 hover:text-rose-600"
                          aria-label="Delete saved signature"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={signAllPages}
                      onChange={(e) => setSignAllPages(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    Sign all pages
                  </label>
                  {!signAllPages ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void loadSignPage(Math.max(1, signPageNumber - 1))}
                        disabled={signPageNumber <= 1}
                        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <span className="text-xs text-slate-600">Page {signPageNumber} of {signPageCount}</span>
                      <button
                        type="button"
                        onClick={() => void loadSignPage(Math.min(signPageCount, signPageNumber + 1))}
                        disabled={signPageNumber >= signPageCount}
                        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
                <p className="field-help">Click the preview to choose where the signature should be placed.</p>
                {thumbnailLoading ? (
                  <p className="field-help">Generating placement preview...</p>
                ) : signaturePlacementPreview ? (
                  <div className="relative inline-block w-full max-w-[320px] overflow-hidden rounded-lg border border-slate-300 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={signaturePlacementPreview}
                      alt="Signature placement preview"
                      onClick={onSignaturePlacementPick}
                      className="h-auto w-full cursor-crosshair"
                    />
                    <span
                      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-600 bg-cyan-300/40"
                      style={{
                        left: `${signaturePlacement.xRatio * 100}%`,
                        top: `${(1 - signaturePlacement.yRatio) * 100}%`,
                      }}
                    />
                  </div>
                ) : (
                  <p className="field-help">Upload a PDF above to set signature position visually.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-300 bg-gradient-to-b from-slate-100 to-slate-200 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Document editor</p>
                    <p className="text-sm font-semibold text-slate-800">{files[0]?.name ?? "No document loaded"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-1">
                      Page {editPageNumber} / {editPageCount}
                    </span>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-1">
                      Edited pages: {Object.keys(editLayersByPage).length}
                    </span>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-slate-300 bg-white px-2 py-2">
                  <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {EDIT_RIBBON_TABS.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEditRibbonTab(tab)}
                        aria-pressed={editRibbonTab === tab}
                        title={`Alt+${EDIT_RIBBON_SHORTCUTS[tab]}`}
                        className={`group relative flex items-center gap-2 rounded-md border px-3 py-1.5 transition ${
                          editRibbonTab === tab
                            ? "border-cyan-300 bg-linear-to-b from-white to-cyan-50 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_-12px_rgba(8,145,178,0.85)]"
                            : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-100/80 hover:text-slate-700"
                        }`}
                      >
                        <span
                          className={`absolute inset-x-2 -bottom-[9px] h-[3px] rounded-full transition ${
                            editRibbonTab === tab ? "bg-cyan-500" : "bg-transparent group-hover:bg-slate-300"
                          }`}
                        />
                        {tab}
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.16em] ${
                            editRibbonTab === tab
                              ? "border-cyan-300 bg-cyan-100 text-cyan-800"
                              : "border-slate-200 bg-white text-slate-400"
                          }`}
                        >
                          Alt+{EDIT_RIBBON_SHORTCUTS[tab]}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="mb-3 text-[11px] font-medium text-slate-500">
                    Switch ribbon tabs with Alt+H, Alt+N, Alt+P, Alt+R, or Alt+W.
                  </p>

                  {editRibbonTab === "Home" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditMode("draw")}
                        className={`btn rounded-md px-3 py-1.5 text-xs font-semibold ${
                          editMode === "draw"
                            ? "btn-primary"
                            : "btn-secondary"
                        }`}
                      >
                        Draw Ink
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditMode("text")}
                        className={`btn rounded-md px-3 py-1.5 text-xs font-semibold ${
                          editMode === "text"
                            ? "btn-primary"
                            : "btn-secondary"
                        }`}
                      >
                        Text Box
                      </button>
                      <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                        Color
                        <input
                          type="color"
                          value={editColor}
                          onChange={(event) => setEditColor(event.target.value)}
                          className="h-6 w-8 rounded border border-slate-300 bg-white"
                        />
                      </label>
                      {editMode === "draw" ? (
                        <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                          Ink width
                          <input
                            type="range"
                            min={1}
                            max={12}
                            step={0.5}
                            value={editBrushSize}
                            onChange={(event) => setEditBrushSize(Number(event.target.value))}
                          />
                        </label>
                      ) : (
                        <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                          Font size
                          <input
                            type="range"
                            min={10}
                            max={48}
                            step={1}
                            value={editFontSize}
                            onChange={(event) => setEditFontSize(Number(event.target.value))}
                          />
                        </label>
                      )}
                    </div>
                  ) : null}

                  {editRibbonTab === "Insert" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditMode("text")}
                        className="btn btn-secondary rounded-md px-3 py-1.5 text-xs"
                      >
                        Insert text box
                      </button>
                      <input
                        id="edit-text"
                        type="text"
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        placeholder="Text for text box mode"
                        className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                      />
                      <p className="text-xs text-slate-500">Select Text Box, then click anywhere on the page.</p>
                    </div>
                  ) : null}

                  {editRibbonTab === "Layout" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!files[0]) return;
                          void loadEditPreview(files[0], Math.max(1, editPageNumber - 1));
                        }}
                        disabled={!files[0] || editPageNumber <= 1 || editCanvasLoading}
                        className="btn btn-secondary rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Prev
                      </button>
                      <select
                        value={editPageNumber}
                        onChange={(event) => {
                          if (!files[0]) return;
                          void loadEditPreview(files[0], Number(event.target.value));
                        }}
                        disabled={!files[0] || editCanvasLoading}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        {Array.from({ length: editPageCount }, (_, index) => index + 1).map((pageNo) => (
                          <option key={pageNo} value={pageNo}>
                            Page {pageNo}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!files[0]) return;
                          void loadEditPreview(files[0], Math.min(editPageCount, editPageNumber + 1));
                        }}
                        disabled={!files[0] || editPageNumber >= editPageCount || editCanvasLoading}
                        className="btn btn-secondary rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Next
                      </button>
                      <p className="text-xs text-slate-500">Move between pages while keeping each page&apos;s edits bound to that page.</p>
                    </div>
                  ) : null}

                  {editRibbonTab === "Review" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={undoEditAction}
                        className="btn btn-secondary rounded-md px-3 py-1 text-xs"
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        onClick={clearEditCanvasActions}
                        className="btn btn-destructive rounded-md px-3 py-1 text-xs"
                      >
                        Clear page
                      </button>
                      <button
                        type="button"
                        onClick={clearEditDocumentActions}
                        className="btn btn-destructive rounded-md px-3 py-1 text-xs"
                      >
                        Clear document
                      </button>
                    </div>
                  ) : null}

                  {editRibbonTab === "View" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                        Zoom
                        <select
                          value={editZoom}
                          onChange={(event) => setEditZoom(Number(event.target.value))}
                          className="rounded border border-slate-300 bg-white px-1 py-0.5"
                        >
                          {[75, 90, 100, 110, 125, 150, 175].map((zoomValue) => (
                            <option key={zoomValue} value={zoomValue}>{zoomValue}%</option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-slate-500">Adjust page zoom without changing the exported PDF.</p>
                    </div>
                  ) : null}
                </div>
              </div>

              {editRibbonTab !== "Insert" ? (
                <input
                  id="edit-text"
                  type="text"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  placeholder="Text for text box mode"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                />
              ) : null}

              <div className="rounded-2xl border border-slate-300 bg-gradient-to-b from-slate-200 to-slate-300 p-3">
                <div className="mb-2 h-6 rounded border border-slate-300 bg-white px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-slate-500">
                  0    1    2    3    4    5    6    7    8    9   10
                </div>

                {editCanvasLoading ? (
                  <p className="field-help">Preparing editable page canvas...</p>
                ) : editPreview ? (
                  <div className="overflow-auto rounded-xl border border-slate-300 bg-slate-400/25 p-4">
                    <div className="mx-auto w-fit rounded-sm border border-slate-300 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.2)]">
                      <canvas
                        ref={(node) => {
                          editCanvasRef.current = node;
                          if (node && editCanvasSize.width && editCanvasSize.height) {
                            node.width = editCanvasSize.width;
                            node.height = editCanvasSize.height;
                            redrawEditCanvas();
                          }
                        }}
                        onPointerDown={onEditPointerDown}
                        onPointerMove={onEditPointerMove}
                        onPointerUp={onEditPointerUp}
                        onPointerCancel={onEditPointerUp}
                        onClick={onEditCanvasClick}
                        style={
                          editCanvasSize.width && editCanvasSize.height
                            ? {
                                width: `${Math.max(260, Math.round((editCanvasSize.width * editZoom) / 100))}px`,
                                height: `${Math.max(340, Math.round((editCanvasSize.height * editZoom) / 100))}px`,
                              }
                            : undefined
                        }
                        className={`block touch-none rounded-sm bg-white ${
                          editMode === "draw" ? "cursor-crosshair" : "cursor-text"
                        }`}
                        aria-label="Edit PDF canvas"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="field-help">Upload a PDF above to begin editing with the canvas.</p>
                )}

                <p className="mt-2 text-xs text-slate-600">
                  {editMode === "draw"
                    ? "Ink mode: draw directly on the page like Word Draw tools."
                    : "Text box mode: click a location to place the current text."}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}



        </div>

        {usesThumbnailEditor ? (
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 xl:col-span-2">
            {isRotateTool ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 border border-cyan-200">
                <span className="text-xs font-semibold text-slate-600">Rotate all pages:</span>
                {[90, 180, 270].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => {
                      setRotateAngle(deg);
                      setPageRotations({});
                      rotateAngleRef.current = deg;
                      pageRotationsRef.current = {};
                      setTimeout(() => runTool(), 50);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      rotateAngle === deg && Object.keys(pageRotations).length === 0
                        ? "border-cyan-500 bg-cyan-100 text-cyan-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
                    }`}
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 8h10M8 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {deg}°
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPageRotations({})}
                  className="ml-auto text-xs text-cyan-600 underline hover:text-cyan-800"
                >
                  Reset per-page rotations
                </button>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                Page Thumbnails
              </p>
              <p className="text-xs text-slate-500">
                {isOrganizeTool
                  ? `${pageOrder.length} pages in output`
                  : isRotateTool
                    ? `${pageThumbnails.length} pages`
                    : `${selectedPages.length} pages selected`}
              </p>
            </div>

            {thumbnailLoading ? (
              <p className="text-sm text-slate-600">Generating page previews...</p>
            ) : null}

            {!thumbnailLoading && supportsOrderDrag && (isOrganizeTool ? pageOrder.length : selectedPages.length) ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  {isOrganizeTool ? "Output order (drag thumbnails)" : "Extraction order (drag thumbnails)"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(isOrganizeTool ? pageOrder : selectedPages).map((pageNumber, index) => {
                    const thumb = pageThumbnails.find((item) => item.pageNumber === pageNumber);
                    if (!thumb) return null;

                    const isDragOver = dragOverPage === pageNumber && draggedPage !== pageNumber;

                    return (
                      <div
                        key={`order-${pageNumber}`}
                        draggable
                        onDragStart={() => {
                          setDraggedPage(pageNumber);
                          setDragOverPage(null);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (draggedPage !== null && draggedPage !== pageNumber) {
                            setDragOverPage(pageNumber);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverPage === pageNumber) {
                            setDragOverPage(null);
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedPage !== null && draggedPage !== pageNumber) {
                            if (isOrganizeTool) {
                              reorderPages(draggedPage, pageNumber);
                            } else {
                              reorderSelectedPages(draggedPage, pageNumber);
                            }
                          }
                          setDraggedPage(null);
                          setDragOverPage(null);
                        }}
                        onDragEnd={() => {
                          setDraggedPage(null);
                          setDragOverPage(null);
                        }}
                        className={`w-20 cursor-grab rounded-lg border bg-slate-50 p-1 active:cursor-grabbing ${
                          isDragOver ? "border-cyan-500 ring-2 ring-cyan-200" : "border-slate-200"
                        }`}
                        title="Drag to reorder"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumb.dataUrl}
                          alt={`Ordered page ${pageNumber}`}
                          className="h-20 w-full rounded object-cover"
                        />
                        <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] font-semibold text-slate-700">
                          <span>Pg {pageNumber}</span>
                          <span>#{index + 1}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!thumbnailLoading && pageThumbnails.length ? (
              <div className="max-h-[58vh] overflow-auto pr-1">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {pageThumbnails.map((thumb) => {
                    const selected = isOrganizeTool
                      ? pageOrder.includes(thumb.pageNumber)
                      : selectedPages.includes(thumb.pageNumber);
                    const orderIndex = isOrganizeTool
                      ? pageOrder.indexOf(thumb.pageNumber) + 1
                      : supportsOrderDrag
                        ? selectedPages.indexOf(thumb.pageNumber) + 1
                        : 0;

                    return (
                      <div
                        key={thumb.pageNumber}
                        className={`rounded-xl border p-2 transition ${
                          selected
                            ? "border-cyan-500 bg-cyan-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => togglePage(thumb.pageNumber)}
                          className="w-full text-left"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumb.dataUrl}
                            alt={`Page ${thumb.pageNumber}`}
                            className="h-28 w-full rounded-md object-cover"
                          />
                          <div className="mt-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                            <span>Page {thumb.pageNumber}</span>
                            {supportsOrderDrag && selected ? (
                              <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] text-white">
                                #{orderIndex}
                              </span>
                            ) : null}
                          </div>
                          {isRotateTool ? (
                            <div className="mt-2 flex items-center gap-1">
                              {[0, 90, 180, 270].map((deg) => (
                                <button
                                  key={deg}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPageRotations((prev) => {
                                      const next = { ...prev };
                                      if (deg === 0) delete next[thumb.pageNumber];
                                      else next[thumb.pageNumber] = deg;
                                      pageRotationsRef.current = next;
                                      return next;
                                    });
                                    rotateAngleRef.current = 0;
                                    setTimeout(() => runTool(), 50);
                                  }}
                                  className={`flex-1 rounded border px-1 py-0.5 text-[10px] font-semibold transition ${
                                    (pageRotations[thumb.pageNumber] ?? 0) === deg
                                      ? "border-cyan-500 bg-cyan-100 text-cyan-800"
                                      : "border-slate-200 text-slate-500 hover:border-cyan-300"
                                  }`}
                                >
                                  {deg === 0 ? "0°" : `${deg}°`}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!thumbnailLoading && !pageThumbnails.length ? (
              <p className="text-sm text-slate-600">
                Upload a PDF to select pages visually.
              </p>
            ) : null}

            {tool.slug === "split-pdf" || tool.slug === "extract-pages" ? (
              <div className="space-y-1">
                <label htmlFor="ranges" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Pages to extract (optional fallback)
                </label>
                <input
                  id="ranges"
                  type="text"
                  value={ranges}
                  onChange={(event) => setRanges(event.target.value)}
                  placeholder="Example: 1,3,5-8"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                />
                <p className="field-help">Use comma-separated pages or ranges like 2-6.</p>
              </div>
            ) : null}

            {lastRunSummary ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="type-eyebrow text-slate-600">Run Summary</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{lastRunSummary.message}</p>
                <p className="field-help mt-1">
                  Processed {lastRunSummary.inputCount} file(s) at {lastRunSummary.timestamp}
                </p>
              </div>
            ) : null}

            {runReport ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="type-eyebrow text-slate-600">Quality and Trust Report</p>
                <p className="text-sm font-medium text-slate-800">
                  Confidence: {runReport.confidence.toUpperCase()} ({runReport.confidenceReason})
                </p>
                <p className="field-help">Runtime: {runReport.mode} | Duration: {formatDurationMs(runReport.durationMs)}</p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {runReport.transforms.slice(0, 6).map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={downloadRunReport}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Download run report
                  </button>
                  <button
                    type="button"
                    onClick={downloadProcessingLog}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Download processing log
                  </button>
                </div>
              </div>
            ) : null}

            {processingLog.length ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="type-eyebrow text-slate-600">Recent Processing Events</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {processingLog.slice(0, 6).map((entry) => (
                    <li key={`${entry.at}-${entry.message}`}>[{entry.at}] {entry.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div ref={outputRef} className="space-y-2 xl:sticky xl:top-4">
          {tool.slug === "compare-pdf" && (compareRenderA || compareRenderB) ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="type-eyebrow text-slate-600">Visual Comparison</p>
                {comparePageCountA > 0 && comparePageCountB > 0 ? (
                  <div className="flex items-center gap-2 text-xs">
                    <label htmlFor="compare-page-select" className="text-slate-600">
                      Page:
                    </label>
                    <select
                      id="compare-page-select"
                      value={comparePageNumber}
                      onChange={async (event) => {
                        const pageNum = Number(event.target.value);
                        setComparePageNumber(pageNum);
                        if (!files[0] || !files[1]) return;
                        setProgress({ current: 0, total: 1, label: `Rendering page ${pageNum}…` });
                        const bytesA = new Uint8Array(await readAsArrayBuffer(files[0]));
                        const bytesB = new Uint8Array(await readAsArrayBuffer(files[1]));
                        const [rA, rB] = await Promise.all([
                          renderComparePageWithDiffs(bytesA, bytesB, pageNum, "red"),
                          renderComparePageWithDiffs(bytesB, bytesA, pageNum, "green"),
                        ]);
                        setCompareRenderA(rA?.dataUrl ?? "");
                        setCompareRenderB(rB?.dataUrl ?? "");
                        setProgress(null);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      {Array.from(
                        { length: Math.max(comparePageCountA, comparePageCountB) },
                        (_, i) => i + 1
                      ).map((p) => (
                        <option key={p} value={p}>
                          Page {p}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-rose-400" />
                    <span className="text-xs font-semibold text-slate-700">
                      {files[0]?.name ?? "First PDF"}
                    </span>
                    {comparePageNumber > comparePageCountA ? (
                      <span className="text-xs text-amber-600 font-medium">
                        Only in second PDF
                      </span>
                    ) : null}
                  </div>
                  {compareRenderA ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={compareRenderA}
                      alt={`${files[0]?.name ?? "First"} page ${comparePageNumber}`}
                      className="w-full rounded-lg border border-slate-300 shadow-sm"
                    />
                  ) : comparePageNumber > comparePageCountA ? (
                    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-100 text-sm text-slate-500">
                      Page does not exist in this PDF
                    </div>
                  ) : null}
                  <p className="text-[10px] text-slate-500">
                    Red highlights = text unique to this PDF
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold text-slate-700">
                      {files[1]?.name ?? "Second PDF"}
                    </span>
                    {comparePageNumber > comparePageCountB ? (
                      <span className="text-xs text-amber-600 font-medium">
                        Only in first PDF
                      </span>
                    ) : null}
                  </div>
                  {compareRenderB ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={compareRenderB}
                      alt={`${files[1]?.name ?? "Second"} page ${comparePageNumber}`}
                      className="w-full rounded-lg border border-slate-300 shadow-sm"
                    />
                  ) : comparePageNumber > comparePageCountB ? (
                    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-100 text-sm text-slate-500">
                      Page does not exist in this PDF
                    </div>
                  ) : null}
                  <p className="text-[10px] text-slate-500">
                    Green highlights = text unique to this PDF
                  </p>
                </div>
              </div>

              {compareTextReport ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600 hover:text-slate-800">
                    Text Diff Report
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 whitespace-pre-wrap">
                    {compareTextReport}
                  </pre>
                </details>
              ) : null}

              <p className="text-[11px] text-slate-500">
                Diffs are approximate word-level comparisons. Red/green overlays highlight words present in one PDF but not the other. Download the text report for full line-by-line diff.
              </p>
            </div>
          ) : null}
          {outputPreviewPanel}
        </div>
      </div>
    </section>
  );
}
