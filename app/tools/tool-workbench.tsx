"use client";

import { Document as DocxDocument, Packer, Paragraph } from "docx";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import * as mammoth from "mammoth";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { useEffect, useMemo, useRef, useState } from "react";
import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import type { ToolItem } from "@/lib/tools";

type WorkbenchProps = {
  tool: ToolItem;
};

type PageThumbnail = {
  pageNumber: number;
  dataUrl: string;
};

type OutputPreview = {
  blob: Blob;
  fileName: string;
  url: string;
  mime: string;
  note?: string;
  imagePreviewDataUrl?: string;
  pdfPreviewDataUrl?: string;
};

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

function readAsArrayBuffer(file: File) {
  return file.arrayBuffer();
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
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined });
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

async function renderPdfToImages(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined });
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
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined });
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
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined });
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
  const task = pdfjs.getDocument({ data: bytes, password: password || undefined });
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

async function fileToPdfImage(pdf: PDFDocument, file: File) {
  const lower = file.name.toLowerCase();
  const bytes = await readAsArrayBuffer(file);

  if (lower.endsWith(".png")) return pdf.embedPng(bytes);
  if (lower.endsWith(".webp")) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot convert WEBP image.");
    context.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((generated) => {
        if (!generated) {
          reject(new Error("Failed converting WEBP to PNG."));
          return;
        }
        resolve(generated);
      }, "image/png");
    });

    return pdf.embedPng(await blob.arrayBuffer());
  }

  return pdf.embedJpg(bytes);
}

function sortSlidePaths(paths: string[]) {
  return paths.sort((a, b) => {
    const first = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    const second = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    return first - second;
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

export default function ToolWorkbench({ tool }: WorkbenchProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [ranges, setRanges] = useState("1");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [password, setPassword] = useState("");
  const [editText, setEditText] = useState("Reviewed by PaperTrail");
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
  const [signaturePlacement, setSignaturePlacement] = useState({ xRatio: 0.82, yRatio: 0.12 });
  const [signaturePlacementPreview, setSignaturePlacementPreview] = useState("");
  const [mergePages, setMergePages] = useState<MergePageNode[]>([]);
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
  const [outputPreview, setOutputPreview] = useState<OutputPreview | null>(null);
  const [previewText, setPreviewText] = useState<string>("");
  const [downloadingOutput, setDownloadingOutput] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState<
    "unknown" | "prompt" | "granted" | "denied"
  >("unknown");
  const [lastRunSummary, setLastRunSummary] = useState<{
    message: string;
    inputCount: number;
    timestamp: string;
  } | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const editCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signaturePointerState = useRef<{ drawing: boolean }>({ drawing: false });
  const signatureStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const signatureActiveStrokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const previewJobRef = useRef(0);

  const pageEditSlugs = ["split-pdf", "extract-pages", "remove-pages", "organize-pdf"];
  const usesThumbnailEditor = pageEditSlugs.includes(tool.slug);
  const isOrganizeTool = tool.slug === "organize-pdf";
  const isSignTool = tool.slug === "sign-pdf";
  const isMergeTool = tool.slug === "merge-pdf";
  const isScanTool = tool.slug === "scan-to-pdf";
  const isEditTool = tool.slug === "edit-pdf";
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
    const url = URL.createObjectURL(blob);
    setOutputPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return {
        blob,
        fileName,
        url,
        mime: blob.type || "application/octet-stream",
        note,
        imagePreviewDataUrl,
        pdfPreviewDataUrl: undefined,
      };
    });

    if (blob.type.startsWith("text/")) {
      blob
        .text()
        .then((text) => setPreviewText(text.slice(0, 12000)))
        .catch(() => setPreviewText("Preview unavailable for this text output."));
    }

    if (OFFICE_PREVIEW_MIME_PATTERN.test(blob.type)) {
      buildOfficePreviewText(blob, blob.type)
        .then((text) => {
          if (previewJobRef.current !== previewJob) return;
          setPreviewText(text);
        })
        .catch(() => {
          if (previewJobRef.current !== previewJob) return;
          setPreviewText("Could not build an in-browser structured preview for this output.");
        });
    }

    if (blob.type.includes("pdf")) {
      blob
        .arrayBuffer()
        .then((buffer) => renderPdfFirstPagePreview(new Uint8Array(buffer)))
        .then((dataUrl) => {
          if (previewJobRef.current !== previewJob) return;
          setOutputPreview((current) => {
            if (!current || current.url !== url) return current;
            return { ...current, pdfPreviewDataUrl: dataUrl };
          });
        })
        .catch(() => {
          // Keep iframe preview fallback when generated preview fails.
        });
    }
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

  useEffect(() => {
    return () => {
      if (outputPreview) URL.revokeObjectURL(outputPreview.url);
    };
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
      return "Upload multiple PDFs, then optionally reorder or remove individual pages before merging.";
    }
    if (tool.slug === "compare-pdf") return "Upload two PDFs to compare textual differences.";
    if (tool.slug === "split-pdf" || tool.slug === "extract-pages") {
      return "Upload one PDF and select pages from thumbnails to extract.";
    }
    if (tool.slug === "organize-pdf") return "Upload one PDF and drag thumbnails to set output order.";
    if (tool.slug === "remove-pages") return "Upload one PDF and click page thumbnails to remove pages.";
    if (tool.slug === "jpg-to-pdf" || tool.slug === "scan-to-pdf") {
      return "Upload one or more images to generate a PDF.";
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

  const acceptsMultiple =
    tool.slug === "merge-pdf" ||
    tool.slug === "jpg-to-pdf" ||
    tool.slug === "scan-to-pdf" ||
    tool.slug === "compare-pdf";

  const inputAccept = useMemo(() => {
    if (tool.slug === "jpg-to-pdf" || tool.slug === "scan-to-pdf") {
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

  function onSignaturePlacementPick(event: React.MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xTopRatio = clamp((event.clientX - rect.left) / rect.width, 0.02, 0.98);
    const yTopRatio = clamp((event.clientY - rect.top) / rect.height, 0.02, 0.98);
    setSignaturePlacement({ xRatio: xTopRatio, yRatio: 1 - yTopRatio });
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

  async function onSelect(selected: FileList | null) {
    if (!selected) return;
    setError("");
    setStatus("");
    setOutputPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setMergePages([]);
    setMergePageOrder([]);
    setMergeDraggedId(null);
    setMergeDragOverId(null);
    const nextFiles = Array.from(selected);
    setFiles((current) => (isScanTool ? [...current, ...nextFiles] : nextFiles));

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
    if (!first) {
      return;
    }

    const isPdf =
      first.type === "application/pdf" || first.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return;
    }

    if (!usesThumbnailEditor && !isSignTool && !isMergeTool && !isEditTool) {
      return;
    }

    try {
      setThumbnailLoading(true);
      if (isMergeTool) {
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
        setSignaturePlacementPreview(await renderPdfFirstPagePreview(firstBytes));
      }

      if (isEditTool) {
        await loadEditPreview(first, 1);
      }

      if (isMergeTool) {
        const allPages: MergePageNode[] = [];
        for (let fileIndex = 0; fileIndex < nextFiles.length; fileIndex += 1) {
          const file = nextFiles[fileIndex];
          const thumbs = await renderPdfThumbnails(new Uint8Array(await readAsArrayBuffer(file)));
          for (const thumb of thumbs) {
            allPages.push({
              id: `${fileIndex}-${thumb.pageNumber}-${Math.random().toString(36).slice(2, 7)}`,
              fileIndex,
              fileName: file.name,
              pageIndex: thumb.pageNumber - 1,
              pageNumber: thumb.pageNumber,
              dataUrl: thumb.dataUrl,
            });
          }
        }

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

  async function runTool() {
    setError("");
    setStatus("");
    let completionMessage = "";

    const complete = (message: string) => {
      completionMessage = message;
      setStatus(message);
    };

    if (!files.length) {
      setError("Upload at least one file to continue.");
      return;
    }

    try {
      setBusy(true);
      const firstFile = files[0];

      if (tool.slug === "merge-pdf") {
        const output = await PDFDocument.create();
        if (mergePageOrder.length && mergePages.length) {
          const pageById = new Map(mergePages.map((page) => [page.id, page]));
          const loadedDocs = new Map<number, PDFDocument>();
          for (const pageId of mergePageOrder) {
            const node = pageById.get(pageId);
            if (!node) continue;

            let source = loadedDocs.get(node.fileIndex);
            if (!source) {
              source = await PDFDocument.load(await readAsArrayBuffer(files[node.fileIndex]));
              loadedDocs.set(node.fileIndex, source);
            }

            const [copied] = await output.copyPages(source, [node.pageIndex]);
            output.addPage(copied);
          }
        } else {
          for (const file of files) {
            const source = await PDFDocument.load(await readAsArrayBuffer(file));
            const copied = await output.copyPages(source, source.getPageIndices());
            copied.forEach((page) => output.addPage(page));
          }
        }

        if (!output.getPageCount()) {
          throw new Error("Select at least one page to merge.");
        }
        stageOutput(asPdfBlob(await output.save()), "merged.pdf", "Preview merged pages before downloading.");
        complete("Merged PDF ready for preview.");
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
        source.getPages().forEach((page) => page.setRotation(degrees(90)));
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-rotated.pdf`,
          "Preview rotated pages before downloading."
        );
        complete("Rotated PDF ready for preview.");
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

      if (tool.slug === "watermark-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const font = await source.embedFont(StandardFonts.HelveticaBold);
        source.getPages().forEach((page) => {
          const { width, height } = page.getSize();
          page.drawText(watermarkText || "WATERMARK", {
            x: width * 0.18,
            y: height * 0.45,
            size: 40,
            rotate: degrees(35),
            font,
            color: rgb(0.85, 0.1, 0.1),
            opacity: 0.2,
          });
        });
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-watermarked.pdf`,
          "Preview watermark placement before downloading."
        );
        complete("Watermarked PDF ready for preview.");
        return;
      }

      if (tool.slug === "jpg-to-pdf" || tool.slug === "scan-to-pdf") {
        const output = await PDFDocument.create();
        for (const file of files) {
          const image = await fileToPdfImage(output, file);
          const { width, height } = image.scale(1);
          const page = output.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });
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

        const processed = await Promise.all(
          renderedPages.map((page) => processCompressionImage(page.dataUrl, compressionOptions))
        );

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
          compressedSource.setCreator("PaperTrail Compression Engine");
          compressedSource.setProducer("PaperTrail Compression Engine");
        }

        stageOutput(
          asPdfBlob(await compressedSource.save({ useObjectStreams: true })),
          `${normalizeFileName(firstFile.name)}-compressed.pdf`,
          "Compression options applied. Review quality before downloading."
        );
        complete("Compressed PDF ready for preview.");
        return;
      }

      if (tool.slug === "repair-pdf" || tool.slug === "pdf-to-pdfa") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile), { ignoreEncryption: true });
        if (tool.slug === "pdf-to-pdfa") {
          source.setTitle(source.getTitle() || "PDF-A export");
          source.setProducer("PaperTrail PDF-A Export");
        }
        const bytes = await source.save({ useObjectStreams: false });
        const suffix = tool.slug === "repair-pdf" ? "repaired" : "pdfa";
        stageOutput(
          asPdfBlob(bytes),
          `${normalizeFileName(firstFile.name)}-${suffix}.pdf`,
          "Preview output quality before downloading."
        );
        complete(`${tool.name} output ready for preview.`);
        return;
      }

      if (tool.slug === "pdf-to-jpg") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const images = await renderPdfToImages(new Uint8Array(await readAsArrayBuffer(firstFile)), password || undefined);
        const zip = new JSZip();
        for (let index = 0; index < images.length; index += 1) {
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
        const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
        stageOutput(
          new Blob([pages.map((text, i) => `Page ${i + 1}\n${text}`).join("\n\n")], { type: "text/plain" }),
          `${normalizeFileName(firstFile.name)}-ocr.txt`,
          "Review extracted text before downloading."
        );
        complete("OCR text ready for preview.");
        return;
      }

      if (tool.slug === "pdf-to-word") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const pages = await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(firstFile)));
        const children = pages.flatMap((text, index) => [new Paragraph(`Page ${index + 1}`), new Paragraph(text), new Paragraph("")]);
        const doc = new DocxDocument({ sections: [{ children }] });
        stageOutput(
          await Packer.toBlob(doc),
          `${normalizeFileName(firstFile.name)}.docx`,
          "Binary DOCX preview is metadata-only. Download to inspect in Word."
        );
        complete("DOCX file ready for preview.");
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

      if (tool.slug === "word-to-pdf") {
        if (!firstFile) throw new Error("Missing Word file.");
        const result = await mammoth.extractRawText({ arrayBuffer: await readAsArrayBuffer(firstFile) });
        const lines = splitLines(result.value || "");
        stageOutput(
          asPdfBlob(await pdfFromLines(lines.length ? lines : ["No text extracted from Word file."], "Word to PDF")),
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
        const lines: string[] = [];
        for (let index = 0; index < slidePaths.length; index += 1) {
          const xml = await zip.file(slidePaths[index])?.async("string");
          if (!xml) continue;
          const matches = Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g));
          const text = matches.map((match) => decodeXmlText(match[1])).join(" ").trim();
          lines.push(`Slide ${index + 1}: ${text || "(no text)"}`);
        }
        stageOutput(
          asPdfBlob(await pdfFromLines(lines, "PowerPoint to PDF")),
          `${normalizeFileName(firstFile.name)}.pdf`,
          "Preview converted PDF before downloading."
        );
        complete("PowerPoint conversion ready for preview.");
        return;
      }

      if (tool.slug === "excel-to-pdf") {
        if (!firstFile) throw new Error("Missing Excel file.");
        const workbook = XLSX.read(await readAsArrayBuffer(firstFile), { type: "array" });
        const lines: string[] = [];
        workbook.SheetNames.forEach((sheetName) => {
          lines.push(`Sheet: ${sheetName}`);
          const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName], { header: 1 });
          matrix.forEach((row) => lines.push(row.join(" | ")));
          lines.push("");
        });
        stageOutput(
          asPdfBlob(await pdfFromLines(lines, "Excel to PDF")),
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
        if (!password) throw new Error("Enter a password.");
        const images = await renderPdfToImages(new Uint8Array(await readAsArrayBuffer(firstFile)), tool.slug === "unlock-pdf" ? password : undefined);

        const options: Record<string, unknown> = {
          unit: "pt",
          format: [images[0].width, images[0].height],
          compress: true,
        };

        if (tool.slug === "protect-pdf") {
          options.encryption = {
            userPassword: password,
            ownerPassword: password,
            userPermissions: ["print", "copy", "modify-annotations"],
          };
        }

        const doc = new jsPDF(options as unknown as ConstructorParameters<typeof jsPDF>[0]);
        images.forEach((image, index) => {
          if (index > 0) doc.addPage([image.width, image.height], "portrait");
          doc.addImage(image.dataUrl, "JPEG", 0, 0, image.width, image.height);
        });

        const suffix = tool.slug === "protect-pdf" ? "protected" : "unlocked";
        stageOutput(
          asPdfBlob(new Uint8Array(doc.output("arraybuffer"))),
          `${normalizeFileName(firstFile.name)}-${suffix}.pdf`,
          "Preview secured document before downloading."
        );
        complete(`${tool.slug === "protect-pdf" ? "Protected" : "Unlocked"} PDF ready for preview.`);
        return;
      }

      if (tool.slug === "redact-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        source.getPages().forEach((page) => {
          const { width } = page.getSize();
          page.drawRectangle({ x: 60, y: 370, width: width - 120, height: 40, color: rgb(0, 0, 0) });
        });
        stageOutput(
          asPdfBlob(await source.save()),
          `${normalizeFileName(firstFile.name)}-redacted.pdf`,
          "Preview redaction quality before downloading."
        );
        complete("Redacted PDF ready for preview.");
        return;
      }

      if (tool.slug === "edit-pdf" || tool.slug === "sign-pdf") {
        if (!firstFile) throw new Error("Missing PDF file.");
        if (tool.slug === "sign-pdf" && signatureMode === "draw" && !signatureDrawn) {
          throw new Error("Draw your signature on the signature pad before exporting.");
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
        const hasCanvasEdits =
          tool.slug === "edit-pdf" &&
          Object.values(pageLayers).some(
            (layer) => layer.strokes.length > 0 || layer.textNotes.length > 0
          );
        const signatureImageBytes =
          tool.slug === "sign-pdf" && signatureMode === "draw" ? await getSignatureImageBytes() : null;
        const signatureImage = signatureImageBytes ? await source.embedPng(signatureImageBytes) : null;
        source.getPages().forEach((page, index) => {
          if (tool.slug === "sign-pdf") {
            const { width, height } = page.getSize();
            const anchorX = clamp(width * signaturePlacement.xRatio, 24, width - 24);
            const anchorY = clamp(height * signaturePlacement.yRatio, 24, height - 24);

            if (signatureImage) {
              const rawWidth = signatureImage.width;
              const rawHeight = signatureImage.height;
              const signatureWidth = 170;
              const signatureHeight = Math.max(30, (signatureWidth / rawWidth) * rawHeight);
              page.drawImage(signatureImage, {
                x: clamp(anchorX - signatureWidth / 2, 12, width - signatureWidth - 12),
                y: clamp(anchorY - signatureHeight / 2, 12, height - signatureHeight - 12),
                width: signatureWidth,
                height: signatureHeight,
                opacity: 0.95,
              });
            } else {
              const signatureText = editText || "Signed electronically";
              const textSize = 10;
              const textWidth = font.widthOfTextAtSize(signatureText, textSize);
              page.drawText(signatureText, {
                x: clamp(anchorX - textWidth / 2, 12, width - textWidth - 12),
                y: clamp(anchorY - textSize / 2, 12, height - textSize - 12),
                size: textSize,
                font,
                color: rgb(0.1, 0.1, 0.1),
              });
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
            } else if (!hasCanvasEdits && index === 0) {
              page.drawText(editText, { x: 40, y: 40, size: 12, font, color: rgb(0.12, 0.4, 0.9) });
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
        const textA = (await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(first)))).join("\n");
        const textB = (await loadPdfPagesText(new Uint8Array(await readAsArrayBuffer(second)))).join("\n");
        const linesA = splitLines(textA);
        const linesB = splitLines(textB);
        const onlyA = linesA.filter((line) => !linesB.includes(line));
        const onlyB = linesB.filter((line) => !linesA.includes(line));
        const report = [
          `Compare Report: ${first.name} vs ${second.name}`,
          "",
          `Unique lines in ${first.name}: ${onlyA.length}`,
          ...onlyA.slice(0, 120),
          "",
          `Unique lines in ${second.name}: ${onlyB.length}`,
          ...onlyB.slice(0, 120),
        ].join("\n");
        stageOutput(new Blob([report], { type: "text/plain" }), "compare-report.txt", "Review compare report before downloading.");
        complete("Comparison report ready for preview.");
        return;
      }

      complete("Tool execution completed.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unexpected tool error.");
    } finally {
      if (completionMessage) {
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
    <section className="tool-shell glass-3d space-y-4 rounded-3xl p-6">
      <div className="flex items-center gap-4">
        <h2 className="font-display text-2xl font-semibold text-slate-950">{tool.name}</h2>
      </div>

      <p className="text-sm text-slate-700">{tool.description}</p>

      <p className="field-help">{uploadHint}</p>

      <input
        type="file"
        accept={inputAccept}
        multiple={acceptsMultiple}
        onChange={(event) => onSelect(event.target.files)}
        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
      />

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

      {isMergeTool ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Merge Page Organizer
            </p>
            <p className="text-xs text-slate-500">{mergePageOrder.length} pages in output</p>
          </div>

          <p className="field-help">
            Drag thumbnails to reorder pages. Remove pages you do not want in the merged output.
          </p>

          {mergeLoading ? <p className="text-sm text-slate-600">Generating merge page thumbnails...</p> : null}

          {!mergeLoading && mergePageOrder.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
          ) : null}

          {!mergeLoading && files.length > 1 && !mergePageOrder.length ? (
            <p className="text-sm text-slate-600">No pages selected. Keep at least one page to merge.</p>
          ) : null}
        </div>
      ) : null}

      {usesThumbnailEditor ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              Page Thumbnails
            </p>
            <p className="text-xs text-slate-500">
              {isOrganizeTool
                ? `${pageOrder.length} pages in output`
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!thumbnailLoading && !pageThumbnails.length ? (
            <p className="text-sm text-slate-600">
              Upload a PDF to select pages visually.
            </p>
          ) : null}
        </div>
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

      {tool.slug === "watermark-pdf" ? (
        <div className="space-y-1">
          <label htmlFor="watermark" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Watermark text
          </label>
          <input
            id="watermark"
            type="text"
            value={watermarkText}
            onChange={(event) => setWatermarkText(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          />
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
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
          />
          <p className="field-help">Use the same password to open the protected output later.</p>
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
                <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
                  <p className="field-help">Sign using your touchpad, mouse, or touchscreen. Undo last stroke with Ctrl+X, Ctrl+Z, or Cmd+Z.</p>
                  <canvas
                    ref={(node) => {
                      signatureCanvasRef.current = node;
                      if (node) setupSignatureCanvas(node);
                    }}
                    onPointerDown={onSignaturePointerDown}
                    onPointerMove={onSignaturePointerMove}
                    onPointerUp={endSignatureStroke}
                    onPointerCancel={endSignatureStroke}
                    className="w-full max-w-[420px] rounded-lg border border-slate-300 bg-white touch-none"
                    aria-label="Signature pad"
                  />
                  <button
                    type="button"
                    onClick={clearSignatureCanvas}
                    className="btn btn-secondary rounded-md px-3 py-1 text-xs"
                  >
                    Clear signature
                  </button>
                </div>
              ) : (
                <input
                  id="edit-text"
                  type="text"
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                />
              )}

              <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
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

      <button
        type="button"
        onClick={runTool}
        disabled={busy}
        className="btn btn-primary rounded-full px-5 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-500"
      >
        {busy ? "Processing..." : `Run ${tool.name}`}
      </button>

      {files.length ? (
        <ul className="space-y-1 text-sm text-slate-700">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}

      {outputPreview ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="type-eyebrow text-slate-600">Output Preview</p>
              <p className="text-sm font-medium text-slate-800">{outputPreview.fileName}</p>
              {outputPreview.note ? <p className="field-help mt-1">{outputPreview.note}</p> : null}
            </div>
            <button
              type="button"
              onClick={handleDownloadOutput}
              disabled={downloadingOutput}
              className={`${downloadingOutput ? "" : "animate-pulse"} btn btn-primary rounded-full px-4 py-2 text-xs uppercase tracking-wide shadow-[0_0_0_0_rgba(8,145,178,0.45)] disabled:cursor-not-allowed disabled:bg-cyan-200`}
            >
              {downloadingOutput ? "Downloading..." : "Download output"}
            </button>
          </div>

          {outputPreview.mime.includes("pdf") ? (
            <div className="space-y-2">
              {outputPreview.pdfPreviewDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={outputPreview.pdfPreviewDataUrl}
                  alt="Processed PDF first-page preview"
                  className="max-h-72 w-auto rounded-lg border border-slate-300 bg-white"
                />
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

          {(outputPreview.mime.startsWith("text/") || OFFICE_PREVIEW_MIME_PATTERN.test(outputPreview.mime)) ? (
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
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {busy ? <span className="status-chip status-chip-busy">Processing</span> : null}
        {status ? <span className="status-chip status-chip-ok">Ready</span> : null}
        {error ? <span className="status-chip status-chip-error">Failed</span> : null}
      </div>

      {lastRunSummary ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="type-eyebrow text-slate-600">Run Summary</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{lastRunSummary.message}</p>
          <p className="field-help mt-1">
            Processed {lastRunSummary.inputCount} file(s) at {lastRunSummary.timestamp}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
      {status ? <p className="text-sm font-medium text-emerald-700">{status}</p> : null}
    </section>
  );
}
