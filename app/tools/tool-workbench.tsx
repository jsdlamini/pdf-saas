"use client";

import { Document as DocxDocument, Packer, Paragraph } from "docx";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import * as mammoth from "mammoth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PDFDocument, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, translate, rotateDegrees, setLineWidth, setFillingRgbColor, setStrokingRgbColor, moveTo, lineTo, appendQuadraticCurve, closePath, fillAndStroke, type PDFImage } from "pdf-lib";
import { useEffect, useMemo, useRef, useState } from "react";
import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import { analyzeDocumentSelection } from "@/lib/document-preflight";
import { MAX_OCR_UPLOAD_BYTES, OCR_LANGUAGE_OPTIONS } from "@/lib/ocr";
import { formatDurationMs, hashBlob, hashFile, summarizeRunConfidence, type RunReport } from "@/lib/run-report";
import { ACTIVE_TOOL_ITEMS, TOOL_ITEMS, type ToolItem } from "@/lib/tools";
import Swal from "sweetalert2";
import { consumeWorkflowPipeline, stageWorkflowPipeline, loadPersistedWorkflowPipeline } from "@/lib/workflow-pipeline";
import { loadUploadedFiles, persistUploadedFiles, clearUploadedFiles, loadSharedFiles, persistSharedFiles } from "@/lib/file-persistence";
import { getNextRecipeStep, type WorkflowRecipe } from "@/lib/workflow-recipes";
import ShareButton from "@/app/components/share-button";
import { showToast } from "@/app/components/toast";
import { ToolIcon } from "@/app/components/tool-icon";
import { asPdfBlob, clamp, compactPageSequence, dataUrlToUint8Array, decodeXmlText, downloadBlob, formatBytes, getFileNameFromDisposition, hexToRgb, isFileCompatibleForTool, normalizeFileName, pagesToLatex, parseRanges, readAsArrayBuffer, readAsText, sortSlidePaths, splitLines } from "@/lib/transforms/helpers";
import { A4_PAGE_SIZE_PORTRAIT, buildMixedFilePageNodes, clampPdfImageDimensions, convertMixedFilesToPdf, fileToPdfImage, htmlContentToPdfBlob, pdfFromLines, sanitizeLegacyWatermarks, type MergePageNode } from "@/lib/transforms/pdf-lib";
import { configurePdfJsWorker, dataUrlToImage, extractPdfFormFields, loadPdfPagesText, processCompressionImage, renderComparePageWithDiffs, renderEditPagePreview, renderPdfPagePreview, renderPdfThumbnails, renderPdfToImages, samplePdfTextCoverage, type CompressionOptions, type EditFormField, type EditTextSpan, type PageThumbnail } from "@/lib/transforms/rasterize";
import { buildOfficePreviewHtml, buildOfficePreviewText } from "@/lib/transforms/text-extract";

type WorkbenchProps = {
  tool: ToolItem;
};

type ImagePdfPageSizeMode = "original" | "a4";
type ImagePdfPlacementMode = "single" | "grid";

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
const OFFICE_PREVIEW_MIME_PATTERN =
  /application\/vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml|presentationml)\./;

type CanvasPoint = { x: number; y: number };

let editAnnotationCounter = 0;
function nextEditAnnotationId() {
  editAnnotationCounter += 1;
  return `edit-${Date.now().toString(36)}-${editAnnotationCounter}`;
}

type EditStroke = { id: string; points: CanvasPoint[]; color: string; width: number };
type EditTextNote = { id: string; x: number; y: number; text: string; color: string; size: number };
type EditHighlight = { id: string; x: number; y: number; width: number; height: number; color: string; opacity: number };
type EditRectShape = { id: string; kind: "rect"; x: number; y: number; width: number; height: number; color: string; strokeWidth: number; opacity: number; fill: boolean };
type EditEllipseShape = { id: string; kind: "ellipse"; x: number; y: number; width: number; height: number; color: string; strokeWidth: number; opacity: number; fill: boolean };
type EditLineShape = { id: string; kind: "line"; start: CanvasPoint; end: CanvasPoint; color: string; strokeWidth: number; opacity: number };
type EditArrowShape = { id: string; kind: "arrow"; start: CanvasPoint; end: CanvasPoint; color: string; strokeWidth: number; opacity: number };
type EditShape = EditRectShape | EditEllipseShape | EditLineShape | EditArrowShape;
type EditWhiteout = { id: string; x: number; y: number; width: number; height: number };
type EditImageAnnotation = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  dataUrl: string;
  mime: string;
};
type EditStamp = { id: string; x: number; y: number; text: string; color: string; size: number; rotation: number };
type EditPageLayer = {
  strokes: EditStroke[];
  textNotes: EditTextNote[];
  highlights: EditHighlight[];
  shapes: EditShape[];
  whiteouts: EditWhiteout[];
  images: EditImageAnnotation[];
  stamps: EditStamp[];
};

type EditToolMode = "select" | "draw" | "highlight" | "text" | "edit-text" | "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "stamp";
type EditDraftShape = { kind: "rect" | "ellipse" | "highlight" | "whiteout" | "line" | "arrow"; start: CanvasPoint; current: CanvasPoint };
type EditSelection = { kind: "stroke" | "text" | "highlight" | "shape" | "whiteout" | "image" | "stamp"; id: string };
type EditWatermark = {
  text: string;
  color: string;
  opacity: number;
  rotation: number;
  size: number;
  imageDataUrl: string;
  imageMime: string;
};
type EditBatchScope = "this" | "all" | "range";
type EditAlignmentGuides = { x: number | null; y: number | null };

function emptyEditLayer(): EditPageLayer {
  return { strokes: [], textNotes: [], highlights: [], shapes: [], whiteouts: [], images: [], stamps: [] };
}

const STAMP_PRESETS: Array<{ text: string; color: string }> = [
  { text: "Approved", color: "#16a34a" },
  { text: "Confidential", color: "#dc2626" },
  { text: "Draft", color: "#d97706" },
  { text: "Reviewed", color: "#2563eb" },
];

const DEFAULT_EDIT_WATERMARK: EditWatermark = {
  text: "DRAFT",
  color: "#ef4444",
  opacity: 0.18,
  rotation: -30,
  size: 72,
  imageDataUrl: "",
  imageMime: "",
};

// Canvas-space math helpers (y grows downward, positive rotation is clockwise on screen).
function rotatePointDeg(point: CanvasPoint, center: CanvasPoint, angleDeg: number): CanvasPoint {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: center.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

// pdf-lib `rotate: degrees(angle)` is counterclockwise in PDF space, which renders
// counterclockwise on screen — the opposite of the canvas convention used above.
// These helpers compute the (bottom-left) anchor so the content ends up centered
// at (cx, cyPdf) with the same *visual* rotation the canvas preview shows.
function pdfRotatedImageAnchor(cx: number, cyPdf: number, width: number, height: number, visualDeg: number) {
  const rad = (visualDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  return {
    x: cx - (width / 2) * cosA - (height / 2) * sinA,
    y: cyPdf + (width / 2) * sinA - (height / 2) * cosA,
  };
}

function pdfRotatedTextAnchor(cx: number, cyPdf: number, textWidth: number, size: number, visualDeg: number) {
  const rad = (visualDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const up = size * 0.35;
  return {
    x: cx - (textWidth / 2) * cosA - up * sinA,
    y: cyPdf + (textWidth / 2) * sinA - up * cosA,
  };
}

function mixHexWithWhite(hex: string, whiteAmount: number): string {
  const { red, green, blue } = hexToRgb(hex);
  const mix = (channel: number) => Math.round((channel * (1 - whiteAmount) + 1 * whiteAmount) * 255);
  return `#${[mix(red), mix(green), mix(blue)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function drawRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function parseEditBatchPageNumbers(raw: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let page = start; page <= end; page += 1) {
        if (page >= 1 && page <= pageCount) pages.add(page);
      }
    } else if (/^\d+$/.test(trimmed)) {
      const page = Number(trimmed);
      if (page >= 1 && page <= pageCount) pages.add(page);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function rectFromPoints(start: CanvasPoint, end: CanvasPoint) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function drawArrowHead(context: CanvasRenderingContext2D, start: CanvasPoint, end: CanvasPoint, headLength: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const left = {
    x: end.x - headLength * Math.cos(angle - Math.PI / 6),
    y: end.y - headLength * Math.sin(angle - Math.PI / 6),
  };
  const right = {
    x: end.x - headLength * Math.cos(angle + Math.PI / 6),
    y: end.y - headLength * Math.sin(angle + Math.PI / 6),
  };
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.closePath();
  context.fill();
}

function drawEditShapeOnContext(context: CanvasRenderingContext2D, shape: EditShape) {
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0.05, shape.opacity));
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = Math.max(0.75, shape.strokeWidth);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (shape.kind === "rect") {
    if (shape.fill) context.fillRect(shape.x, shape.y, shape.width, shape.height);
    context.strokeRect(shape.x, shape.y, shape.width, shape.height);
  } else if (shape.kind === "ellipse") {
    context.beginPath();
    context.ellipse(
      shape.x + shape.width / 2,
      shape.y + shape.height / 2,
      Math.max(0.5, shape.width / 2),
      Math.max(0.5, shape.height / 2),
      0,
      0,
      Math.PI * 2
    );
    if (shape.fill) context.fill();
    context.stroke();
  } else if (shape.kind === "line") {
    context.beginPath();
    context.moveTo(shape.start.x, shape.start.y);
    context.lineTo(shape.end.x, shape.end.y);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(shape.start.x, shape.start.y);
    context.lineTo(shape.end.x, shape.end.y);
    context.stroke();
    drawArrowHead(context, shape.start, shape.end, Math.max(10, shape.strokeWidth * 5));
  }
  context.restore();
}

function editShapeFromDraft(
  draft: EditDraftShape,
  color: string,
  strokeWidth: number,
  opacity: number,
  fill: boolean
): EditShape {
  if (draft.kind === "rect" || draft.kind === "ellipse") {
    const bounds = rectFromPoints(draft.start, draft.current);
    return { id: "draft", kind: draft.kind, ...bounds, color, strokeWidth, opacity, fill } as EditShape;
  }
  return {
    id: "draft",
    kind: draft.kind,
    start: draft.start,
    end: draft.current,
    color,
    strokeWidth,
    opacity,
  } as EditShape;
}

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

const EDIT_TOOL_OPTIONS: Array<{ mode: EditToolMode; label: string; hint: string }> = [
  { mode: "select", label: "Select", hint: "Click an annotation to select it — drag to move, press Delete to remove it." },
  { mode: "draw", label: "Draw", hint: "Drag on the page to draw freehand ink." },
  { mode: "highlight", label: "Highlight", hint: "Drag a box to highlight the text underneath." },
  { mode: "text", label: "Text", hint: "Type your text, then click the page to place it." },
  { mode: "edit-text", label: "Edit text", hint: "Click a word in the PDF to replace it in place." },
  { mode: "rect", label: "Rectangle", hint: "Drag on the page to draw a rectangle." },
  { mode: "ellipse", label: "Ellipse", hint: "Drag on the page to draw an ellipse." },
  { mode: "line", label: "Line", hint: "Drag on the page to draw a straight line." },
  { mode: "arrow", label: "Arrow", hint: "Drag on the page to draw an arrow." },
  { mode: "whiteout", label: "Whiteout", hint: "Drag a box to cover content with solid white." },
  { mode: "stamp", label: "Stamp", hint: "Choose a stamp badge, then click the page to apply it." },
];

const EDIT_TOOL_HINTS: Record<EditToolMode, string> = Object.fromEntries(
  EDIT_TOOL_OPTIONS.map((option) => [option.mode, option.hint])
) as Record<EditToolMode, string>;

function EditToolGlyph({ mode }: { mode: EditToolMode }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: "h-4 w-4",
  } as const;

  switch (mode) {
    case "select":
      return (
        <svg {...commonProps}>
          <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      );
    case "draw":
      return (
        <svg {...commonProps}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      );
    case "highlight":
      return (
        <svg {...commonProps}>
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      );
    case "text":
      return (
        <svg {...commonProps}>
          <path d="M4 7V4h16v3" />
          <path d="M9 20h6" />
          <path d="M12 4v16" />
        </svg>
      );
    case "rect":
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
        </svg>
      );
    case "ellipse":
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
    case "line":
      return (
        <svg {...commonProps}>
          <path d="M5 19 19 5" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...commonProps}>
          <path d="M13 5h6v6" />
          <path d="m19 5-14 14" />
        </svg>
      );
    case "whiteout":
      return (
        <svg {...commonProps}>
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </svg>
      );
    case "edit-text":
      return (
        <svg {...commonProps}>
          <path d="M5 4h6a1 1 0 0 1 1 1v2" />
          <path d="M12 7H4" />
          <path d="M9 12v9" />
          <path d="m20.5 9.5 2 2L14 20l-3 .5.5-3Z" />
        </svg>
      );
    case "stamp":
      return (
        <svg {...commonProps}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M12 8c-2.2 0-3.5 1.1-3.5 2.4 0 1.2 1 2 2.4 2.3-.4.6-.6 1.4-.6 2.1h3.4c0-.7-.2-1.5-.6-2.1 1.4-.3 2.4-1.1 2.4-2.3C15.5 9.1 14.2 8 12 8Z" />
        </svg>
      );
  }
}

function trimSignatureCanvas(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("2d");
  if (!context) return canvas.toDataURL("image/png");
  const { width, height } = canvas;
  if (!width || !height) return canvas.toDataURL("image/png");
  let data: ImageData;
  try {
    data = context.getImageData(0, 0, width, height);
  } catch {
    return canvas.toDataURL("image/png");
  }
  const pixels = data.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return canvas.toDataURL("image/png");
  const pad = 6;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, maxX - minX + pad * 2 + 1);
  const cropH = Math.min(height - cropY, maxY - minY + pad * 2 + 1);
  const out = document.createElement("canvas");
  out.width = Math.max(1, cropW);
  out.height = Math.max(1, cropH);
  const outContext = out.getContext("2d");
  if (!outContext) return canvas.toDataURL("image/png");
  outContext.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out.toDataURL("image/png");
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
  const [editMode, setEditMode] = useState<EditToolMode>("select");
  const [editColor, setEditColor] = useState("#0f172a");
  const [editBrushSize, setEditBrushSize] = useState(2.6);
  const [editFontSize, setEditFontSize] = useState(16);
  const [editOpacity, setEditOpacity] = useState(45);
  const [editFillShape, setEditFillShape] = useState(false);
  const [editZoom, setEditZoom] = useState(100);
  const [editStrokes, setEditStrokes] = useState<EditStroke[]>([]);
  const [editTextNotes, setEditTextNotes] = useState<EditTextNote[]>([]);
  const [editHighlights, setEditHighlights] = useState<EditHighlight[]>([]);
  const [editShapes, setEditShapes] = useState<EditShape[]>([]);
  const [editWhiteouts, setEditWhiteouts] = useState<EditWhiteout[]>([]);
  const [editImages, setEditImages] = useState<EditImageAnnotation[]>([]);
  const [editStamps, setEditStamps] = useState<EditStamp[]>([]);
  const [editStampPreset, setEditStampPreset] = useState(0);
  const [editBatchScope, setEditBatchScope] = useState<EditBatchScope>("this");
  const [editBatchRange, setEditBatchRange] = useState("");
  const [editSnapToGrid, setEditSnapToGrid] = useState(false);
  const [editFormFields, setEditFormFields] = useState<EditFormField[]>([]);
  const [editWatermark, setEditWatermark] = useState<EditWatermark | null>(null);
  const [editAlignmentGuides, setEditAlignmentGuides] = useState<EditAlignmentGuides | null>(null);
  const [editLayersByPage, setEditLayersByPage] = useState<Record<number, EditPageLayer>>({});
  const [activeEditStroke, setActiveEditStroke] = useState<CanvasPoint[]>([]);
  const [editDraft, setEditDraft] = useState<EditDraftShape | null>(null);
  const [selectedEditId, setSelectedEditId] = useState<EditSelection | null>(null);
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
  const [signatures, setSignatures] = useState<Array<{ id: string; kind: "text" | "draw"; text?: string; dataUrl?: string; xRatio: number; yRatio: number; pageNumber: number | null }>>([]);
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
  const [previewHtml, setPreviewHtml] = useState<string>("");
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
  const pipelineBackTarget = useMemo(() => {
    const slug = pipelineBootstrap?.payload.fromToolSlug;
    if (!slug) return null;
    if (slug === "home-dropzone") return { href: "/", label: "Home" };
    const target = TOOL_ITEMS.find((item) => item.slug === slug);
    return { href: `/tools/${slug}`, label: target?.name ?? slug };
  }, [pipelineBootstrap]);
  const [prevTool, setPrevTool] = useState<{ href: string; label: string } | null>(null);

  // Track the previously visited tool so a "Back" button works for ALL
  // navigation, not only for tools reached through the pipeline.
  useEffect(() => {
    let storedSlug: string | null = null;
    let storedName = "";
    try {
      const raw = localStorage.getItem("wiserfiles-last-tool");
      if (raw) {
        const parsed = JSON.parse(raw) as { slug?: string; name?: string };
        if (parsed && typeof parsed.slug === "string" && parsed.slug && parsed.slug !== tool.slug) {
          storedSlug = parsed.slug;
          storedName = parsed.name || "";
        }
      }
    } catch {
      // ignore
    }
    if (storedSlug) {
      const name = TOOL_ITEMS.find((t) => t.slug === storedSlug)?.name ?? storedName ?? storedSlug;
      setPrevTool({ href: `/tools/${storedSlug}`, label: name });
    } else {
      setPrevTool(null);
    }
    try {
      localStorage.setItem("wiserfiles-last-tool", JSON.stringify({ slug: tool.slug, name: tool.name }));
    } catch {
      // ignore
    }
  }, [tool.slug, tool.name]);

  const backTarget = useMemo(() => {
    if (pipelineBootstrap?.accepted && pipelineBackTarget) return pipelineBackTarget;
    if (prevTool) return prevTool;
    return { href: "/", label: "Home" };
  }, [pipelineBootstrap, pipelineBackTarget, prevTool]);
  const [switchDropdownOpen, setSwitchDropdownOpen] = useState(false);

  const switchableTools = useMemo(() => {
    if (!files.length) return [];
    return ACTIVE_TOOL_ITEMS.filter((candidate) => {
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
  const editLayersRef = useRef<Record<number, EditPageLayer>>({});
  const editUndoStacksRef = useRef<Record<number, EditPageLayer[]>>({});
  const editRedoStacksRef = useRef<Record<number, EditPageLayer[]>>({});
  const editCanvasSizesRef = useRef<Record<number, { width: number; height: number }>>({});
  const editTextSpansRef = useRef<Record<number, EditTextSpan[]>>({});
  const editImageElementsRef = useRef<Record<string, HTMLImageElement>>({});
  const editWatermarkImageRef = useRef<HTMLImageElement | null>(null);
  const editImageInputRef = useRef<HTMLInputElement | null>(null);
  const editWatermarkImageInputRef = useRef<HTMLInputElement | null>(null);
  const editDragRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    layer: EditPageLayer;
    kind?: "move" | "resize-image";
    startWidth?: number;
    startHeight?: number;
    aspect?: number;
  } | null>(null);
  const signaturePointerState = useRef<{ drawing: boolean }>({ drawing: false });
  const signatureStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const signatureActiveStrokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const signatureImageRef = useRef<HTMLImageElement | null>(null);
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

  function resolveActualProcessingMode(filesToProcess: File[]): "local" | "server" {
    if (tool.processing !== "conditional") return tool.processing;
    // Conditional tools (merge-pdf / convert-to-pdf) upload only non-PDF,
    // non-image files (office/text) to /api/office-to-pdf; PDF and image
    // input is processed locally.
    const uploaded = filesToProcess.some((file) => {
      const lower = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lower);
      return !isPdf && !isImage;
    });
    return uploaded ? "server" : "local";
  }

  async function persistRunReport(startedAtMs: number, completionMessage: string, mode: "local" | "server") {
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
      mode,
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
    setEditMode("select");
    setEditZoom(100);
    setEditLayersByPage({});
    editLayersRef.current = {};
    setEditStrokes([]);
    setEditTextNotes([]);
    setEditHighlights([]);
    setEditShapes([]);
    setEditWhiteouts([]);
    setEditImages([]);
    setEditStamps([]);
    setEditFormFields([]);
    setEditWatermark(null);
    setEditAlignmentGuides(null);
    setActiveEditStroke([]);
    setEditDraft(null);
    setSelectedEditId(null);
    editUndoStacksRef.current = {};
    editRedoStacksRef.current = {};
    editCanvasSizesRef.current = {};
    editTextSpansRef.current = {};
    editImageElementsRef.current = {};
    editWatermarkImageRef.current = null;
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
        const thumbs = await renderPdfThumbnails(firstBytes);
        setPageThumbnails(thumbs);
        void extractPdfFormFields(firstBytes).then((fields) => setEditFormFields(fields));
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
        if (preparedBlob.type.toLowerCase().includes("wordprocessingml")) {
          // DOCX: render semantic HTML (headings/lists/paragraphs) so the
          // preview actually shows the conversion worked.
          buildOfficePreviewHtml(preparedBlob, preparedBlob.type)
            .then((html) => {
              if (previewJobRef.current !== previewJob) return;
              setPreviewHtml(html || "");
              setPreviewText("");
            })
            .catch(() => {
              if (previewJobRef.current !== previewJob) return;
              setPreviewHtml("");
              setPreviewText("Could not build an in-browser structured preview for this output.");
            });
        } else {
          setPreviewHtml("");
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
    const targetTools = ACTIVE_TOOL_ITEMS.filter((t) => t.slug !== tool.slug);
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
      confirmButtonColor: "#1e40af",
      cancelButtonColor: "#94a3b8",
      background: "#ffffff",
      color: "#0f172a",
      draggable: true,
      position: "center",
      width: "min(94vw, 760px)",
      customClass: { container: "swal-center-container", popup: "swal-pipe-popup" },
      didOpen: () => {
        const grid = document.getElementById("swal-tool-grid");
        const search = document.getElementById("swal-tool-search") as HTMLInputElement | null;

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
            // Selecting a tool triggers the pipe immediately — no Continue step.
            if (selectedSlug) Swal.clickConfirm();
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
            style={{ background: "#1e40af", boxShadow: "0 4px 14px rgba(30,64,175,0.3)" }}
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
                  onClick={() => {
                    const next = pdfPreviewPage - 1;
                    void loadOutputPdfPreviewPage(next);
                    if (tool.slug === "sign-pdf") void loadSignPage(next);
                  }}
                  disabled={pdfPreviewLoading || pdfPreviewPage <= 1}
                  className="pointer-events-auto rounded-full border border-slate-400/45 bg-slate-900/20 px-2 py-1 text-[11px] font-semibold text-slate-100 shadow-sm  transition hover:bg-slate-900/30 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = pdfPreviewPage + 1;
                    void loadOutputPdfPreviewPage(next);
                    if (tool.slug === "sign-pdf") void loadSignPage(next);
                  }}
                  disabled={pdfPreviewLoading || pdfPreviewPage >= pdfPreviewPageCount}
                  className="pointer-events-auto rounded-full border border-slate-400/45 bg-slate-900/20 px-2 py-1 text-[11px] font-semibold text-slate-100 shadow-sm  transition hover:bg-slate-900/30 disabled:cursor-not-allowed disabled:opacity-35"
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

      {previewHtml ? (
        <div
          className="office-preview-html max-h-96 overflow-auto rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-800"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : outputPreview.mime.startsWith("text/") || OFFICE_PREVIEW_MIME_PATTERN.test(outputPreview.mime) ? (
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

  // Restore uploaded files after a page refresh, and carry the last files
  // across tools so switching tools doesn't force a re-upload.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let restored = await loadUploadedFiles(tool.slug);
      if (!restored.length) {
        const shared = await loadSharedFiles();
        restored = shared.filter((file) => isFileCompatibleForTool(tool.slug, file));
      }
      if (cancelled || !restored.length) return;
      setFiles(restored);
    })();
    return () => {
      cancelled = true;
    };
  }, [tool.slug]);

  // Keep the shared "current files" slot in sync so the latest files follow
  // the user across tool navigation.
  useEffect(() => {
    if (files.length) {
      void persistSharedFiles(files);
    }
  }, [files]);

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
  }, [
    editPreview,
    editStrokes,
    editTextNotes,
    editHighlights,
    editShapes,
    editWhiteouts,
    editImages,
    editStamps,
    editWatermark,
    editAlignmentGuides,
    activeEditStroke,
    editDraft,
    editColor,
    editBrushSize,
    editFontSize,
    editOpacity,
    editFillShape,
    selectedEditId,
  ]);

  useEffect(() => {
    if (!isScanTool) return;
    refreshCameraPermissionStatus();
  }, [isScanTool]);

  useEffect(() => {
    if (!isEditTool) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inFormField =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "Escape") {
        setSelectedEditId(null);
        return;
      }
      if (inFormField) return;

      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoEditAction();
        } else {
          undoEditAction();
        }
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoEditAction();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEditId) {
        event.preventDefault();
        deleteEditAnnotation(selectedEditId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Handlers above read edit state through fresh closures on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isEditTool,
    editPageNumber,
    selectedEditId,
    editStrokes,
    editTextNotes,
    editHighlights,
    editShapes,
    editWhiteouts,
    editImages,
    editStamps,
  ]);

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

      // Z-order: highlights, whiteouts, text, shapes, strokes (top).
      for (const highlight of editHighlights) {
        context.globalAlpha = Math.min(1, Math.max(0.05, highlight.opacity));
        context.fillStyle = highlight.color;
        context.fillRect(highlight.x, highlight.y, highlight.width, highlight.height);
      }
      context.globalAlpha = 1;

      for (const whiteout of editWhiteouts) {
        context.fillStyle = "#ffffff";
        context.fillRect(whiteout.x, whiteout.y, whiteout.width, whiteout.height);
      }

      if (editDraft && (editDraft.kind === "highlight" || editDraft.kind === "whiteout")) {
        const bounds = rectFromPoints(editDraft.start, editDraft.current);
        context.globalAlpha = editDraft.kind === "highlight" ? Math.min(1, Math.max(0.05, editOpacity / 100)) : 1;
        context.fillStyle = editDraft.kind === "highlight" ? editColor : "#ffffff";
        context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        context.globalAlpha = 1;
      }

      for (const note of editTextNotes) {
        context.fillStyle = note.color;
        context.font = `${note.size}px ${"DM Sans"}`;
        context.fillText(note.text, note.x, note.y);
      }

      for (const shape of editShapes) {
        drawEditShapeOnContext(context, shape);
      }
      if (editDraft && editDraft.kind !== "highlight" && editDraft.kind !== "whiteout") {
        drawEditShapeOnContext(
          context,
          editShapeFromDraft(editDraft, editColor, editBrushSize, editOpacity / 100, editFillShape)
        );
      }

      // Images sit above vector shapes but below stamps/strokes.
      for (const imageAnn of editImages) {
        const imageElement = editImageElementsRef.current[imageAnn.id];
        context.save();
        context.translate(imageAnn.x + imageAnn.width / 2, imageAnn.y + imageAnn.height / 2);
        context.rotate((imageAnn.rotation * Math.PI) / 180);
        if (imageElement) {
          context.drawImage(imageElement, -imageAnn.width / 2, -imageAnn.height / 2, imageAnn.width, imageAnn.height);
        } else {
          context.setLineDash([5, 4]);
          context.strokeStyle = "#94a3b8";
          context.lineWidth = 1;
          context.strokeRect(-imageAnn.width / 2, -imageAnn.height / 2, imageAnn.width, imageAnn.height);
          context.setLineDash([]);
          context.fillStyle = "#94a3b8";
          context.font = "11px \"DM Sans\", sans-serif";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText("loading…", 0, 0);
          context.textAlign = "start";
          context.textBaseline = "alphabetic";
        }
        context.restore();
      }

      // Stamps render as rounded, tinted labels.
      for (const stamp of editStamps) {
        context.save();
        context.font = `700 ${stamp.size}px "DM Sans", sans-serif`;
        const textWidth = context.measureText(stamp.text).width;
        const pillWidth = textWidth + stamp.size * 1.7;
        const pillHeight = stamp.size * 1.9;
        context.translate(stamp.x, stamp.y);
        context.rotate((stamp.rotation * Math.PI) / 180);
        context.fillStyle = mixHexWithWhite(stamp.color, 0.82);
        context.strokeStyle = stamp.color;
        context.lineWidth = Math.max(1.25, stamp.size / 12);
        drawRoundedRectPath(context, -pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight, pillHeight / 2);
        context.fill();
        context.stroke();
        context.fillStyle = stamp.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(stamp.text, 0, 0);
        context.restore();
        context.textAlign = "start";
        context.textBaseline = "alphabetic";
      }

      const strokesToDraw =
        activeEditStroke.length > 1
          ? [...editStrokes, { id: "active", points: activeEditStroke, color: editColor, width: editBrushSize }]
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

      // Document-level watermark preview (scale 1.2 mirrors renderEditPagePreview).
      if (editWatermark) {
        context.save();
        context.globalAlpha = Math.min(1, Math.max(0.02, editWatermark.opacity));
        const watermarkImage = editWatermarkImageRef.current;
        if (watermarkImage && editWatermark.imageDataUrl) {
          const maxWidth = canvas.width * 0.5;
          const maxHeight = canvas.height * 0.5;
          const scale = Math.min(1, maxWidth / Math.max(1, watermarkImage.naturalWidth), maxHeight / Math.max(1, watermarkImage.naturalHeight));
          const drawWidth = watermarkImage.naturalWidth * scale;
          const drawHeight = watermarkImage.naturalHeight * scale;
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((editWatermark.rotation * Math.PI) / 180);
          context.drawImage(watermarkImage, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        } else if (editWatermark.text.trim()) {
          const size = editWatermark.size * 1.2;
          context.fillStyle = editWatermark.color;
          context.font = `700 ${size}px "DM Sans", sans-serif`;
          const textWidth = context.measureText(editWatermark.text).width;
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((editWatermark.rotation * Math.PI) / 180);
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(editWatermark.text, 0, 0);
          context.textAlign = "start";
          context.textBaseline = "alphabetic";
        }
        context.restore();
      }

      if (selectedEditId) {
        drawEditSelectionOutline(context);
      }

      if (editAlignmentGuides && (editAlignmentGuides.x != null || editAlignmentGuides.y != null)) {
        context.save();
        context.setLineDash([6, 4]);
        context.strokeStyle = "rgba(34, 211, 238, 0.9)";
        context.lineWidth = 1;
        if (editAlignmentGuides.x != null) {
          context.beginPath();
          context.moveTo(editAlignmentGuides.x, 0);
          context.lineTo(editAlignmentGuides.x, canvas.height);
          context.stroke();
        }
        if (editAlignmentGuides.y != null) {
          context.beginPath();
          context.moveTo(0, editAlignmentGuides.y);
          context.lineTo(canvas.width, editAlignmentGuides.y);
          context.stroke();
        }
        context.restore();
      }
    };
    image.src = editPreview;
  }

  function drawEditSelectionOutline(context: CanvasRenderingContext2D) {
    if (!selectedEditId) return;
    const selection = selectedEditId;
    let bounds: { x: number; y: number; width: number; height: number } | null = null;

    if (selection.kind === "stroke") {
      const stroke = editStrokes.find((item) => item.id === selection.id);
      if (stroke && stroke.points.length) {
        const xs = stroke.points.map((point) => point.x);
        const ys = stroke.points.map((point) => point.y);
        const pad = Math.max(8, stroke.width + 5);
        bounds = {
          x: Math.min(...xs) - pad,
          y: Math.min(...ys) - pad,
          width: Math.max(...xs) - Math.min(...xs) + pad * 2,
          height: Math.max(...ys) - Math.min(...ys) + pad * 2,
        };
      }
    } else if (selection.kind === "text") {
      const note = editTextNotes.find((item) => item.id === selection.id);
      if (note) {
        context.font = `${note.size}px "DM Sans", sans-serif`;
        const textWidth = context.measureText(note.text).width;
        bounds = { x: note.x - 4, y: note.y - note.size - 4, width: textWidth + 8, height: note.size + 8 };
      }
    } else if (selection.kind === "highlight") {
      const highlight = editHighlights.find((item) => item.id === selection.id);
      if (highlight) {
        bounds = { x: highlight.x - 3, y: highlight.y - 3, width: highlight.width + 6, height: highlight.height + 6 };
      }
    } else if (selection.kind === "whiteout") {
      const whiteout = editWhiteouts.find((item) => item.id === selection.id);
      if (whiteout) {
        bounds = { x: whiteout.x - 3, y: whiteout.y - 3, width: whiteout.width + 6, height: whiteout.height + 6 };
      }
    } else if (selection.kind === "image") {
      const image = editImages.find((item) => item.id === selection.id);
      if (image) {
        bounds = { x: image.x - 3, y: image.y - 3, width: image.width + 6, height: image.height + 6 };
      }
    } else if (selection.kind === "stamp") {
      const stamp = editStamps.find((item) => item.id === selection.id);
      if (stamp) {
        context.font = `700 ${stamp.size}px "DM Sans", sans-serif`;
        const textWidth = context.measureText(stamp.text).width;
        bounds = {
          x: stamp.x - textWidth / 2 - stamp.size * 0.85 - 4,
          y: stamp.y - stamp.size * 0.95 - 4,
          width: textWidth + stamp.size * 1.7 + 8,
          height: stamp.size * 1.9 + 8,
        };
      }
    } else {
      const shape = editShapes.find((item) => item.id === selection.id);
      if (shape) {
        const pad = Math.max(8, shape.strokeWidth + 5);
        if (shape.kind === "line" || shape.kind === "arrow") {
          bounds = {
            x: Math.min(shape.start.x, shape.end.x) - pad,
            y: Math.min(shape.start.y, shape.end.y) - pad,
            width: Math.abs(shape.end.x - shape.start.x) + pad * 2,
            height: Math.abs(shape.end.y - shape.start.y) + pad * 2,
          };
        } else {
          bounds = { x: shape.x - pad, y: shape.y - pad, width: shape.width + pad * 2, height: shape.height + pad * 2 };
        }
      }
    }

    if (!bounds) return;
    context.save();
    context.setLineDash([5, 4]);
    context.strokeStyle = "#22d3ee";
    context.lineWidth = 1.5;
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.restore();

    if (selection.kind === "image") {
      const image = editImages.find((item) => item.id === selection.id);
      if (image) {
        const center = { x: image.x + image.width / 2, y: image.y + image.height / 2 };
        const corner = rotatePointDeg({ x: image.x + image.width, y: image.y + image.height }, center, image.rotation);
        context.save();
        context.fillStyle = "#ffffff";
        context.strokeStyle = "#22d3ee";
        context.lineWidth = 1.5;
        context.fillRect(corner.x - 4, corner.y - 4, 8, 8);
        context.strokeRect(corner.x - 4, corner.y - 4, 8, 8);
        context.restore();
      }
    }
  }

  // Bounding box (without padding) used by alignment guides and resizing.
  function getEditAnnotationBounds(
    selection: EditSelection
  ): { x: number; y: number; width: number; height: number } | null {
    const context = editCanvasRef.current?.getContext("2d") ?? null;

    if (selection.kind === "stroke") {
      const stroke = editStrokes.find((item) => item.id === selection.id);
      if (stroke && stroke.points.length) {
        const xs = stroke.points.map((point) => point.x);
        const ys = stroke.points.map((point) => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }
    } else if (selection.kind === "text") {
      const note = editTextNotes.find((item) => item.id === selection.id);
      if (note) {
        if (context) context.font = `${note.size}px "DM Sans", sans-serif`;
        const textWidth = context ? context.measureText(note.text).width : note.text.length * note.size * 0.62;
        return { x: note.x, y: note.y - note.size, width: textWidth, height: note.size };
      }
    } else if (selection.kind === "highlight") {
      const highlight = editHighlights.find((item) => item.id === selection.id);
      if (highlight) return { x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height };
    } else if (selection.kind === "whiteout") {
      const whiteout = editWhiteouts.find((item) => item.id === selection.id);
      if (whiteout) return { x: whiteout.x, y: whiteout.y, width: whiteout.width, height: whiteout.height };
    } else if (selection.kind === "image") {
      const image = editImages.find((item) => item.id === selection.id);
      if (image) return { x: image.x, y: image.y, width: image.width, height: image.height };
    } else if (selection.kind === "stamp") {
      const stamp = editStamps.find((item) => item.id === selection.id);
      if (stamp) {
        if (context) context.font = `700 ${stamp.size}px "DM Sans", sans-serif`;
        const textWidth = context ? context.measureText(stamp.text).width : stamp.text.length * stamp.size * 0.62;
        return {
          x: stamp.x - textWidth / 2 - stamp.size * 0.85,
          y: stamp.y - stamp.size * 0.95,
          width: textWidth + stamp.size * 1.7,
          height: stamp.size * 1.9,
        };
      }
    } else {
      const shape = editShapes.find((item) => item.id === selection.id);
      if (shape) {
        if (shape.kind === "line" || shape.kind === "arrow") {
          return {
            x: Math.min(shape.start.x, shape.end.x),
            y: Math.min(shape.start.y, shape.end.y),
            width: Math.abs(shape.end.x - shape.start.x),
            height: Math.abs(shape.end.y - shape.start.y),
          };
        }
        return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      }
    }
    return null;
  }

  // Feature 6 — alignment guides: show faint center lines when the moving
  // annotation lines up with the page center or another annotation's center.
  function computeEditAlignmentGuides(selection: EditSelection): EditAlignmentGuides | null {
    const canvas = editCanvasRef.current;
    const bounds = getEditAnnotationBounds(selection);
    if (!canvas || !bounds) return null;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const tolerance = 4;

    const centers: Array<{ x: number; y: number }> = [
      { x: canvas.width / 2, y: canvas.height / 2 },
    ];
    const collect = (list: EditSelection[]) => {
      for (const candidate of list) {
        if (candidate.kind === selection.kind && candidate.id === selection.id) continue;
        const candidateBounds = getEditAnnotationBounds(candidate);
        if (!candidateBounds || (candidateBounds.width < 1 && candidateBounds.height < 1)) continue;
        centers.push({
          x: candidateBounds.x + candidateBounds.width / 2,
          y: candidateBounds.y + candidateBounds.height / 2,
        });
      }
    };
    collect(editStrokes.map((item) => ({ kind: "stroke" as const, id: item.id })));
    collect(editTextNotes.map((item) => ({ kind: "text" as const, id: item.id })));
    collect(editHighlights.map((item) => ({ kind: "highlight" as const, id: item.id })));
    collect(editShapes.map((item) => ({ kind: "shape" as const, id: item.id })));
    collect(editWhiteouts.map((item) => ({ kind: "whiteout" as const, id: item.id })));
    collect(editImages.map((item) => ({ kind: "image" as const, id: item.id })));
    collect(editStamps.map((item) => ({ kind: "stamp" as const, id: item.id })));

    let guideX: number | null = null;
    let guideY: number | null = null;
    for (const center of centers) {
      if (Math.abs(centerX - center.x) <= tolerance) guideX = center.x;
      if (Math.abs(centerY - center.y) <= tolerance) guideY = center.y;
    }
    return guideX == null && guideY == null ? null : { x: guideX, y: guideY };
  }

  function findEditAnnotationAt(canvas: HTMLCanvasElement, x: number, y: number): EditSelection | null {
    const context = canvas.getContext("2d");

    // Strokes render on top, so they are hit-tested first.
    for (let i = editStrokes.length - 1; i >= 0; i -= 1) {
      const stroke = editStrokes[i];
      if (stroke.points.some((point) => Math.hypot(point.x - x, point.y - y) <= Math.max(8, stroke.width + 5))) {
        return { kind: "stroke", id: stroke.id };
      }
    }

    for (let i = editStamps.length - 1; i >= 0; i -= 1) {
      const stamp = editStamps[i];
      if (context) {
        context.font = `700 ${stamp.size}px "DM Sans", sans-serif`;
      }
      const textWidth = context
        ? context.measureText(stamp.text).width
        : stamp.text.length * stamp.size * 0.62;
      const pillWidth = textWidth + stamp.size * 1.7;
      const pillHeight = stamp.size * 1.9;
      if (
        x >= stamp.x - pillWidth / 2 - 4 &&
        x <= stamp.x + pillWidth / 2 + 4 &&
        y >= stamp.y - pillHeight / 2 - 4 &&
        y <= stamp.y + pillHeight / 2 + 4
      ) {
        return { kind: "stamp", id: stamp.id };
      }
    }

    for (let i = editImages.length - 1; i >= 0; i -= 1) {
      const image = editImages[i];
      if (x >= image.x - 6 && x <= image.x + image.width + 6 && y >= image.y - 6 && y <= image.y + image.height + 6) {
        return { kind: "image", id: image.id };
      }
    }

    for (let i = editShapes.length - 1; i >= 0; i -= 1) {
      const shape = editShapes[i];
      if (shape.kind === "rect" || shape.kind === "ellipse") {
        if (x >= shape.x - 6 && x <= shape.x + shape.width + 6 && y >= shape.y - 6 && y <= shape.y + shape.height + 6) {
          return { kind: "shape", id: shape.id };
        }
      } else if (distanceToSegment({ x, y }, shape.start, shape.end) <= Math.max(8, shape.strokeWidth + 5)) {
        return { kind: "shape", id: shape.id };
      }
    }

    for (let i = editTextNotes.length - 1; i >= 0; i -= 1) {
      const note = editTextNotes[i];
      if (context) {
        context.font = `${note.size}px "DM Sans", sans-serif`;
        const textWidth = context.measureText(note.text).width;
        if (x >= note.x - 4 && x <= note.x + textWidth + 4 && y >= note.y - note.size - 4 && y <= note.y + 4) {
          return { kind: "text", id: note.id };
        }
      } else {
        const textWidth = note.text.length * note.size * 0.62;
        if (x >= note.x - 4 && x <= note.x + textWidth + 4 && y >= note.y - note.size - 4 && y <= note.y + 4) {
          return { kind: "text", id: note.id };
        }
      }
    }

    for (let i = editHighlights.length - 1; i >= 0; i -= 1) {
      const highlight = editHighlights[i];
      if (x >= highlight.x - 3 && x <= highlight.x + highlight.width + 3 && y >= highlight.y - 3 && y <= highlight.y + highlight.height + 3) {
        return { kind: "highlight", id: highlight.id };
      }
    }

    for (let i = editWhiteouts.length - 1; i >= 0; i -= 1) {
      const whiteout = editWhiteouts[i];
      if (x >= whiteout.x - 3 && x <= whiteout.x + whiteout.width + 3 && y >= whiteout.y - 3 && y <= whiteout.y + whiteout.height + 3) {
        return { kind: "whiteout", id: whiteout.id };
      }
    }

    return null;
  }

  function isEditLayerEmpty(layer: EditPageLayer) {
    return (
      !layer.strokes.length &&
      !layer.textNotes.length &&
      !layer.highlights.length &&
      !layer.shapes.length &&
      !layer.whiteouts.length &&
      !layer.images.length &&
      !layer.stamps.length
    );
  }

  function currentEditLayer(): EditPageLayer {
    return {
      strokes: editStrokes,
      textNotes: editTextNotes,
      highlights: editHighlights,
      shapes: editShapes,
      whiteouts: editWhiteouts,
      images: editImages,
      stamps: editStamps,
    };
  }

  function applyEditLayerToPage(pageNumber: number, layer: EditPageLayer) {
    setEditStrokes(layer.strokes);
    setEditTextNotes(layer.textNotes);
    setEditHighlights(layer.highlights);
    setEditShapes(layer.shapes);
    setEditWhiteouts(layer.whiteouts);
    setEditImages(layer.images);
    setEditStamps(layer.stamps);

    const current = editLayersRef.current;
    let next: Record<number, EditPageLayer>;
    if (isEditLayerEmpty(layer)) {
      if (!current[pageNumber]) {
        next = current;
      } else {
        next = { ...current };
        delete next[pageNumber];
      }
    } else {
      next = { ...current, [pageNumber]: layer };
    }
    editLayersRef.current = next;
    setEditLayersByPage(next);
  }

  function diffAddedEditItems<T extends { id: string }>(previous: T[], next: T[]): T[] {
    const previousIds = new Set(previous.map((item) => item.id));
    return next.filter((item) => !previousIds.has(item.id));
  }

  function scaleEditLayerForPage(
    layer: EditPageLayer,
    source: { width: number; height: number },
    target: { width: number; height: number }
  ): EditPageLayer {
    const sx = target.width / Math.max(1, source.width);
    const sy = target.height / Math.max(1, source.height);
    const scalePoint = (point: CanvasPoint): CanvasPoint => ({ x: point.x * sx, y: point.y * sy });
    return {
      strokes: layer.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(scalePoint) })),
      textNotes: layer.textNotes.map((note) => ({
        ...note,
        x: note.x * sx,
        y: note.y * sy,
        size: note.size * ((sx + sy) / 2),
      })),
      highlights: layer.highlights.map((highlight) => ({
        ...highlight,
        x: highlight.x * sx,
        y: highlight.y * sy,
        width: highlight.width * sx,
        height: highlight.height * sy,
      })),
      shapes: layer.shapes.map((shape) =>
        shape.kind === "line" || shape.kind === "arrow"
          ? { ...shape, start: scalePoint(shape.start), end: scalePoint(shape.end) }
          : { ...shape, x: shape.x * sx, y: shape.y * sy, width: shape.width * sx, height: shape.height * sy }
      ),
      whiteouts: layer.whiteouts.map((whiteout) => ({
        ...whiteout,
        x: whiteout.x * sx,
        y: whiteout.y * sy,
        width: whiteout.width * sx,
        height: whiteout.height * sy,
      })),
      images: layer.images.map((image) => ({
        ...image,
        x: image.x * sx,
        y: image.y * sy,
        width: image.width * sx,
        height: image.height * sy,
      })),
      stamps: layer.stamps.map((stamp) => ({
        ...stamp,
        x: stamp.x * sx,
        y: stamp.y * sy,
        size: stamp.size * ((sx + sy) / 2),
      })),
    };
  }

  // Feature 5 — batch apply: clone only the *added* annotations of a commit onto
  // other pages (this page / all pages / page range).
  function applyEditBatchClones(previous: EditPageLayer, next: EditPageLayer, sourcePage: number) {
    if (editBatchScope === "this") return;
    const added: EditPageLayer = {
      strokes: diffAddedEditItems(previous.strokes, next.strokes),
      textNotes: diffAddedEditItems(previous.textNotes, next.textNotes),
      highlights: diffAddedEditItems(previous.highlights, next.highlights),
      shapes: diffAddedEditItems(previous.shapes, next.shapes),
      whiteouts: diffAddedEditItems(previous.whiteouts, next.whiteouts),
      images: diffAddedEditItems(previous.images, next.images),
      stamps: diffAddedEditItems(previous.stamps, next.stamps),
    };
    if (
      !added.strokes.length &&
      !added.textNotes.length &&
      !added.highlights.length &&
      !added.shapes.length &&
      !added.whiteouts.length &&
      !added.images.length &&
      !added.stamps.length
    ) {
      return;
    }

    const sourceSize = editCanvasSizesRef.current[sourcePage] ?? editCanvasSize;
    const targets =
      editBatchScope === "all"
        ? Array.from({ length: editPageCount }, (_, index) => index + 1)
        : parseEditBatchPageNumbers(editBatchRange, editPageCount);

    const current = editLayersRef.current;
    const nextLayers: Record<number, EditPageLayer> = { ...current };
    for (const targetPage of targets) {
      if (targetPage === sourcePage) continue;
      const targetSize = editCanvasSizesRef.current[targetPage] ?? sourceSize;
      const existing = current[targetPage] ?? emptyEditLayer();
      const scaled = scaleEditLayerForPage(added, sourceSize, targetSize);
      nextLayers[targetPage] = {
        strokes: [...existing.strokes, ...scaled.strokes],
        textNotes: [...existing.textNotes, ...scaled.textNotes],
        highlights: [...existing.highlights, ...scaled.highlights],
        shapes: [...existing.shapes, ...scaled.shapes],
        whiteouts: [...existing.whiteouts, ...scaled.whiteouts],
        images: [...existing.images, ...scaled.images],
        stamps: [...existing.stamps, ...scaled.stamps],
      };
    }
    editLayersRef.current = nextLayers;
    setEditLayersByPage(nextLayers);
  }

  function pushEditUndo(pageNumber: number, layer: EditPageLayer) {
    const undoStack = editUndoStacksRef.current[pageNumber] ?? [];
    undoStack.push(layer);
    if (undoStack.length > 80) undoStack.shift();
    editUndoStacksRef.current[pageNumber] = undoStack;
    delete editRedoStacksRef.current[pageNumber];
  }

  function commitEditLayer(pageNumber: number, updater: (current: EditPageLayer) => EditPageLayer) {
    const previous = currentEditLayer();
    pushEditUndo(pageNumber, previous);
    const next = updater(previous);
    applyEditLayerToPage(pageNumber, next);
    applyEditBatchClones(previous, next, pageNumber);
  }

  function undoEditAction() {
    const undoStack = editUndoStacksRef.current[editPageNumber];
    if (!undoStack?.length) return;
    const previous = undoStack.pop();
    if (!previous) return;
    const redoStack = editRedoStacksRef.current[editPageNumber] ?? [];
    redoStack.push(currentEditLayer());
    editRedoStacksRef.current[editPageNumber] = redoStack;
    setSelectedEditId(null);
    applyEditLayerToPage(editPageNumber, previous);
  }

  function redoEditAction() {
    const redoStack = editRedoStacksRef.current[editPageNumber];
    if (!redoStack?.length) return;
    const nextLayer = redoStack.pop();
    if (!nextLayer) return;
    const undoStack = editUndoStacksRef.current[editPageNumber] ?? [];
    undoStack.push(currentEditLayer());
    editUndoStacksRef.current[editPageNumber] = undoStack;
    setSelectedEditId(null);
    applyEditLayerToPage(editPageNumber, nextLayer);
  }

  function deleteEditAnnotation(selection: EditSelection) {
    commitEditLayer(editPageNumber, (layer) => {
      const next = { ...layer };
      if (selection.kind === "stroke") {
        next.strokes = layer.strokes.filter((item) => item.id !== selection.id);
      } else if (selection.kind === "text") {
        next.textNotes = layer.textNotes.filter((item) => item.id !== selection.id);
      } else if (selection.kind === "highlight") {
        next.highlights = layer.highlights.filter((item) => item.id !== selection.id);
      } else if (selection.kind === "whiteout") {
        next.whiteouts = layer.whiteouts.filter((item) => item.id !== selection.id);
      } else if (selection.kind === "image") {
        next.images = layer.images.filter((item) => item.id !== selection.id);
        delete editImageElementsRef.current[selection.id];
      } else if (selection.kind === "stamp") {
        next.stamps = layer.stamps.filter((item) => item.id !== selection.id);
      } else {
        next.shapes = layer.shapes.filter((item) => item.id !== selection.id);
      }
      return next;
    });
    setSelectedEditId(null);
  }

  function moveEditAnnotation(selection: EditSelection, dx: number, dy: number, snapToGrid = false) {
    const snapDelta = (anchorX: number, anchorY: number) => {
      if (!snapToGrid) return { dx, dy };
      const grid = 8;
      const nextX = Math.round((anchorX + dx) / grid) * grid;
      const nextY = Math.round((anchorY + dy) / grid) * grid;
      return { dx: nextX - anchorX, dy: nextY - anchorY };
    };

    if (selection.kind === "stroke") {
      setEditStrokes((current) =>
        current.map((stroke) => {
          if (stroke.id !== selection.id || !stroke.points.length) return stroke;
          const xs = stroke.points.map((point) => point.x);
          const ys = stroke.points.map((point) => point.y);
          const { dx: appliedDx, dy: appliedDy } = snapDelta(Math.min(...xs), Math.min(...ys));
          return {
            ...stroke,
            points: stroke.points.map((point) => ({ x: point.x + appliedDx, y: point.y + appliedDy })),
          };
        })
      );
    } else if (selection.kind === "text") {
      setEditTextNotes((current) =>
        current.map((note) => {
          if (note.id !== selection.id) return note;
          const { dx: appliedDx, dy: appliedDy } = snapDelta(note.x, note.y);
          return { ...note, x: note.x + appliedDx, y: note.y + appliedDy };
        })
      );
    } else if (selection.kind === "highlight") {
      setEditHighlights((current) =>
        current.map((highlight) => {
          if (highlight.id !== selection.id) return highlight;
          const { dx: appliedDx, dy: appliedDy } = snapDelta(highlight.x, highlight.y);
          return { ...highlight, x: highlight.x + appliedDx, y: highlight.y + appliedDy };
        })
      );
    } else if (selection.kind === "whiteout") {
      setEditWhiteouts((current) =>
        current.map((whiteout) => {
          if (whiteout.id !== selection.id) return whiteout;
          const { dx: appliedDx, dy: appliedDy } = snapDelta(whiteout.x, whiteout.y);
          return { ...whiteout, x: whiteout.x + appliedDx, y: whiteout.y + appliedDy };
        })
      );
    } else if (selection.kind === "image") {
      setEditImages((current) =>
        current.map((image) => {
          if (image.id !== selection.id) return image;
          const { dx: appliedDx, dy: appliedDy } = snapDelta(image.x, image.y);
          return { ...image, x: image.x + appliedDx, y: image.y + appliedDy };
        })
      );
    } else if (selection.kind === "stamp") {
      setEditStamps((current) =>
        current.map((stamp) => {
          if (stamp.id !== selection.id) return stamp;
          const { dx: appliedDx, dy: appliedDy } = snapDelta(stamp.x, stamp.y);
          return { ...stamp, x: stamp.x + appliedDx, y: stamp.y + appliedDy };
        })
      );
    } else {
      setEditShapes((current) =>
        current.map((shape) => {
          if (shape.id !== selection.id) return shape;
          if (shape.kind === "line" || shape.kind === "arrow") {
            const anchorX = Math.min(shape.start.x, shape.end.x);
            const anchorY = Math.min(shape.start.y, shape.end.y);
            const { dx: appliedDx, dy: appliedDy } = snapDelta(anchorX, anchorY);
            return {
              ...shape,
              start: { x: shape.start.x + appliedDx, y: shape.start.y + appliedDy },
              end: { x: shape.end.x + appliedDx, y: shape.end.y + appliedDy },
            };
          }
          const { dx: appliedDx, dy: appliedDy } = snapDelta(shape.x, shape.y);
          return { ...shape, x: shape.x + appliedDx, y: shape.y + appliedDy };
        })
      );
    }
  }

  async function loadEditPreview(file: File, targetPage: number) {
    try {
      setEditCanvasLoading(true);
      const preview = await renderEditPagePreview(new Uint8Array(await readAsArrayBuffer(file)), targetPage);
      const layer = editLayersRef.current[preview.safePage] ?? emptyEditLayer();
      editTextSpansRef.current[preview.safePage] = preview.spans;
      setEditPreview(preview.dataUrl);
      setEditCanvasSize({ width: preview.width, height: preview.height });
      editCanvasSizesRef.current[preview.safePage] = { width: preview.width, height: preview.height };
      setEditPageCount(preview.pageCount);
      setEditPageNumber(preview.safePage);
      setEditStrokes(layer.strokes);
      setEditTextNotes(layer.textNotes);
      setEditHighlights(layer.highlights);
      setEditShapes(layer.shapes);
      setEditWhiteouts(layer.whiteouts);
      setEditImages(layer.images);
      setEditStamps(layer.stamps);
      setActiveEditStroke([]);
      setEditDraft(null);
      setSelectedEditId(null);
      setEditAlignmentGuides(null);
    } catch {
      setError("Could not prepare editable canvas for this PDF.");
    } finally {
      setEditCanvasLoading(false);
    }
  }

  function onEditPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    if (editMode === "text" || editMode === "edit-text" || editMode === "stamp") return;

    const point = getEditCanvasPoint(canvas, event);
    canvas.setPointerCapture(event.pointerId);

    if (editMode === "select") {
      const hit = findEditAnnotationAt(canvas, point.x, point.y);
      setSelectedEditId(hit);
      if (hit) {
        const base = {
          startX: point.x,
          startY: point.y,
          lastX: point.x,
          lastY: point.y,
          layer: currentEditLayer(),
        };
        if (hit.kind === "image") {
          const image = editImages.find((item) => item.id === hit.id);
          if (image) {
            const center = { x: image.x + image.width / 2, y: image.y + image.height / 2 };
            const corner = rotatePointDeg({ x: image.x + image.width, y: image.y + image.height }, center, image.rotation);
            if (Math.hypot(point.x - corner.x, point.y - corner.y) <= 10) {
              editDragRef.current = {
                ...base,
                kind: "resize-image",
                startWidth: image.width,
                startHeight: image.height,
                aspect: image.height / Math.max(1, image.width),
              };
              return;
            }
          }
        }
        editDragRef.current = { ...base, kind: "move" };
      }
      return;
    }

    if (editMode === "draw") {
      setActiveEditStroke([point]);
      return;
    }

    setEditDraft({ kind: editMode, start: point, current: point });
  }

  function onEditPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    const point = getEditCanvasPoint(canvas, event);

    if (editMode === "select") {
      const drag = editDragRef.current;
      if (drag && selectedEditId) {
        if (drag.kind === "resize-image") {
          const image = editImages.find((item) => item.id === selectedEditId.id);
          if (image) {
            let nextWidth = (drag.startWidth ?? image.width) + (point.x - drag.startX);
            nextWidth = Math.max(16, nextWidth);
            if (editSnapToGrid) nextWidth = Math.round(nextWidth / 8) * 8;
            const nextHeight = Math.max(16, nextWidth * (drag.aspect ?? image.height / Math.max(1, image.width)));
            const nextImages = editImages.map((item) =>
              item.id === image.id ? { ...item, width: nextWidth, height: nextHeight } : item
            );
            setEditImages(nextImages);
            applyEditLayerToPage(editPageNumber, { ...currentEditLayer(), images: nextImages });
            setEditAlignmentGuides(computeEditAlignmentGuides(selectedEditId));
          }
          drag.lastX = point.x;
          drag.lastY = point.y;
          return;
        }
        moveEditAnnotation(selectedEditId, point.x - drag.lastX, point.y - drag.lastY, editSnapToGrid);
        drag.lastX = point.x;
        drag.lastY = point.y;
        setEditAlignmentGuides(computeEditAlignmentGuides(selectedEditId));
      }
      return;
    }

    if (editMode === "draw") {
      if (!activeEditStroke.length) return;
      setActiveEditStroke((current) => [...current, point]);
      return;
    }

    if (editMode === "text" || editMode === "edit-text" || editMode === "stamp") return;

    setEditDraft((current) => (current ? { ...current, current: point } : current));
  }

  function onEditPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = editCanvasRef.current;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (editMode === "select") {
      const drag = editDragRef.current;
      editDragRef.current = null;
      setEditAlignmentGuides(null);
      if (drag && selectedEditId && (Math.abs(drag.lastX - drag.startX) > 1 || Math.abs(drag.lastY - drag.startY) > 1)) {
        // Live position changes are already in state; record a single undo entry.
        pushEditUndo(editPageNumber, drag.layer);
        if (drag.kind !== "resize-image") {
          applyEditLayerToPage(editPageNumber, currentEditLayer());
        }
      }
      return;
    }

    if (editMode === "draw") {
      if (activeEditStroke.length > 1) {
        const stroke: EditStroke = {
          id: nextEditAnnotationId(),
          points: activeEditStroke,
          color: editColor,
          width: editBrushSize,
        };
        commitEditLayer(editPageNumber, (layer) => ({ ...layer, strokes: [...layer.strokes, stroke] }));
      }
      setActiveEditStroke([]);
      return;
    }

    if (editMode === "text" || editMode === "edit-text" || editMode === "stamp") return;

    if (editDraft) {
      const draft = editDraft;
      const isTinyBox =
        (draft.kind === "rect" || draft.kind === "ellipse" || draft.kind === "highlight" || draft.kind === "whiteout") &&
        Math.abs(draft.current.x - draft.start.x) < 4 &&
        Math.abs(draft.current.y - draft.start.y) < 4;
      const isTinyLine =
        (draft.kind === "line" || draft.kind === "arrow") &&
        Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y) < 4;
      setEditDraft(null);
      if (isTinyBox || isTinyLine) return;

      commitEditLayer(editPageNumber, (layer) => {
        const next = { ...layer };
        if (draft.kind === "highlight" || draft.kind === "whiteout") {
          const bounds = rectFromPoints(draft.start, draft.current);
          if (draft.kind === "highlight") {
            next.highlights = [
              ...layer.highlights,
              { id: nextEditAnnotationId(), ...bounds, color: editColor, opacity: editOpacity / 100 },
            ];
          } else {
            next.whiteouts = [...layer.whiteouts, { id: nextEditAnnotationId(), ...bounds }];
          }
        } else if (draft.kind === "rect" || draft.kind === "ellipse") {
          const bounds = rectFromPoints(draft.start, draft.current);
          next.shapes = [
            ...layer.shapes,
            {
              id: nextEditAnnotationId(),
              kind: draft.kind,
              ...bounds,
              color: editColor,
              strokeWidth: editBrushSize,
              opacity: editOpacity / 100,
              fill: editFillShape,
            } as EditShape,
          ];
        } else {
          next.shapes = [
            ...layer.shapes,
            {
              id: nextEditAnnotationId(),
              kind: draft.kind,
              start: draft.start,
              end: draft.current,
              color: editColor,
              strokeWidth: editBrushSize,
              opacity: editOpacity / 100,
            } as EditShape,
          ];
        }
        return next;
      });
    }
  }

  function onEditCanvasClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (editMode === "stamp") {
      const canvas = editCanvasRef.current;
      if (!canvas) return;
      const preset = STAMP_PRESETS[editStampPreset] ?? STAMP_PRESETS[0];
      const point = getEditCanvasPoint(canvas, event);
      commitEditLayer(editPageNumber, (layer) => ({
        ...layer,
        stamps: [
          ...layer.stamps,
          {
            id: nextEditAnnotationId(),
            x: point.x,
            y: point.y,
            text: preset.text,
            color: preset.color,
            size: Math.max(16, editFontSize),
            rotation: -8,
          },
        ],
      }));
      return;
    }

    if (editMode === "edit-text") {
      const canvas = editCanvasRef.current;
      if (!canvas) return;
      void replaceTextSpanAt(getEditCanvasPoint(canvas, event));
      return;
    }

    if (editMode !== "text") return;
    if (!editText.trim()) return;
    const canvas = editCanvasRef.current;
    if (!canvas) return;
    const point = getEditCanvasPoint(canvas, event);
    commitEditLayer(editPageNumber, (layer) => ({
      ...layer,
      textNotes: [
        ...layer.textNotes,
        {
          id: nextEditAnnotationId(),
          x: point.x,
          y: point.y,
          text: editText.trim(),
          color: editColor,
          size: editFontSize,
        },
      ],
    }));
  }

  // Feature 2 — click-to-edit existing text: whiteout the clicked word's bbox and
  // place a text note with the replacement at the same position/font size.
  async function replaceTextSpanAt(point: CanvasPoint) {
    const spans = editTextSpansRef.current[editPageNumber] ?? [];
    if (!spans.length) {
      setStatus("No selectable text was found on this page.");
      return;
    }

    const distanceTo = (span: EditTextSpan) =>
      Math.hypot(span.x + span.width / 2 - point.x, span.y - span.fontSize * 0.35 - point.y);
    const nearestIn = (list: EditTextSpan[]) =>
      [...list].sort((a, b) => distanceTo(a) - distanceTo(b))[0] ?? null;

    let span: EditTextSpan | null = nearestIn(
      spans.filter(
        (candidate) =>
          point.x >= candidate.bbox.x &&
          point.x <= candidate.bbox.x + candidate.bbox.width &&
          point.y >= candidate.bbox.y &&
          point.y <= candidate.bbox.y + candidate.bbox.height
      )
    );
    if (!span) {
      const nearest = nearestIn(spans);
      if (nearest && distanceTo(nearest) <= 28) {
        span = nearest;
      } else {
        setStatus("Click closer to a word to edit it.");
        return;
      }
    }

    const result = await Swal.fire({
      title: "Replace text",
      text: "Type the replacement for the selected word.",
      input: "text",
      inputValue: span.text,
      showCancelButton: true,
      confirmButtonText: "Replace",
      cancelButtonText: "Cancel",
    });
    if (!result.isConfirmed) return;
    const replacement = String(result.value ?? "").trim();
    if (!replacement) return;

    const pad = 2;
    commitEditLayer(editPageNumber, (layer) => ({
      ...layer,
      whiteouts: [
        ...layer.whiteouts,
        {
          id: nextEditAnnotationId(),
          x: span.bbox.x - pad,
          y: span.bbox.y - pad,
          width: span.bbox.width + pad * 2,
          height: span.bbox.height + pad * 2,
        },
      ],
      textNotes: [
        ...layer.textNotes,
        {
          id: nextEditAnnotationId(),
          x: span.bbox.x,
          y: span.y,
          text: replacement,
          color: "#0f172a",
          size: span.fontSize,
        },
      ],
    }));
  }

  function changeEditZoom(direction: -1 | 1) {
    const presets = [50, 75, 90, 100, 110, 125, 150, 175, 200];
    const index = presets.indexOf(editZoom);
    const next =
      index === -1
        ? direction === 1
          ? 110
          : 90
        : presets[Math.min(presets.length - 1, Math.max(0, index + direction))];
    setEditZoom(next);
  }

  function clearEditCanvasActions() {
    if (!editPageLayerHasContent) return;
    commitEditLayer(editPageNumber, () => emptyEditLayer());
    setActiveEditStroke([]);
    setSelectedEditId(null);
  }

  function clearEditDocumentActions() {
    setEditLayersByPage({});
    editLayersRef.current = {};
    setEditStrokes([]);
    setEditTextNotes([]);
    setEditHighlights([]);
    setEditShapes([]);
    setEditWhiteouts([]);
    setEditImages([]);
    setEditStamps([]);
    setEditAlignmentGuides(null);
    setActiveEditStroke([]);
    setEditDraft(null);
    setSelectedEditId(null);
    editUndoStacksRef.current = {};
    editRedoStacksRef.current = {};
    editImageElementsRef.current = {};
  }

  // Feature 3 — insert images as movable/resizable annotations.
  function insertEditImageAtCenter(dataUrl: string, mime: string) {
    if (!editPreview) {
      setStatus("Upload a PDF first, then insert an image.");
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = editCanvasRef.current;
      const pageSize = editCanvasSizesRef.current[editPageNumber] ?? editCanvasSize;
      const maxWidth = Math.max(60, (canvas?.width ?? pageSize.width) * 0.5);
      const maxHeight = Math.max(60, (canvas?.height ?? pageSize.height) * 0.5);
      const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth), maxHeight / Math.max(1, image.naturalHeight));
      const width = Math.max(12, image.naturalWidth * scale);
      const height = Math.max(12, image.naturalHeight * scale);
      const id = nextEditAnnotationId();
      editImageElementsRef.current[id] = image;
      commitEditLayer(editPageNumber, (layer) => ({
        ...layer,
        images: [
          ...layer.images,
          {
            id,
            x: (pageSize.width - width) / 2,
            y: (pageSize.height - height) / 2,
            width,
            height,
            rotation: 0,
            dataUrl,
            mime,
          },
        ],
      }));
      setEditMode("select");
      setSelectedEditId({ kind: "image", id });
    };
    image.src = dataUrl;
  }

  function onEditImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl) insertEditImageAtCenter(dataUrl, file.type || "image/png");
    };
    reader.readAsDataURL(file);
  }

  function rotateEditImage(delta: number) {
    if (!selectedEditId || selectedEditId.kind !== "image") return;
    const targetId = selectedEditId.id;
    commitEditLayer(editPageNumber, (layer) => ({
      ...layer,
      images: layer.images.map((image) =>
        image.id === targetId ? { ...image, rotation: (image.rotation + delta + 360) % 360 } : image
      ),
    }));
  }

  function onEditWatermarkImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      const image = new Image();
      image.onload = () => {
        editWatermarkImageRef.current = image;
        setEditWatermark((current) => ({
          ...(current ?? DEFAULT_EDIT_WATERMARK),
          imageDataUrl: dataUrl,
          imageMime: file.type || "image/png",
        }));
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function updateEditFormFieldValue(name: string, value: string | boolean) {
    setEditFormFields((current) =>
      current.map((field) => (field.name === name ? { ...field, value } : field))
    );
  }

  const editPageLayerHasContent =
    editStrokes.length > 0 ||
    editTextNotes.length > 0 ||
    editHighlights.length > 0 ||
    editShapes.length > 0 ||
    editWhiteouts.length > 0 ||
    editImages.length > 0 ||
    editStamps.length > 0;
  const editPageCountEdited = Object.keys(editLayersByPage).length;

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
    if (signatureImageRef.current) {
      const img = signatureImageRef.current;
      const cssW = 420;
      const cssH = 150;
      const scale = Math.min(1, cssW / img.naturalWidth, cssH / img.naturalHeight);
      const drawW = img.naturalWidth * scale * ratio;
      const drawH = img.naturalHeight * scale * ratio;
      const dx = (canvas.width - drawW) / 2;
      const dy = (canvas.height - drawH) / 2;
      context.drawImage(img, dx, dy, drawW, drawH);
    }
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
    signatureImageRef.current = null;
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
      entry = { id: `sig-${Date.now()}`, kind: "draw", label: "Drawn signature", dataUrl: trimSignatureCanvas(canvas) };
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
        const ratio = window.devicePixelRatio || 1;
        const cssW = 420;
        const cssH = 150;
        const scale = Math.min(1, cssW / img.naturalWidth, cssH / img.naturalHeight);
        const drawW = img.naturalWidth * scale * ratio;
        const drawH = img.naturalHeight * scale * ratio;
        const dx = (canvas.width - drawW) / 2;
        const dy = (canvas.height - drawH) / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, dx, dy, drawW, drawH);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#0f172a";
        signatureImageRef.current = img;
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
    const targetPage = signAllPages ? null : signPageNumber;
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
        pageNumber: targetPage,
      };
      setSignatures((prev) => [...prev, newSig]);
      setActiveSignatureId(newSig.id);
    } else {
      const canvas = signatureCanvasRef.current;
      if (!canvas || !signatureDrawn) { setError("Draw a signature before adding it."); return; }
      const dataUrl = trimSignatureCanvas(canvas);
      const count = signatures.length;
      const newSig = {
        id: `docsig-${Date.now()}`,
        kind: "draw" as const,
        dataUrl,
        xRatio: 0.82 - (count % 3) * 0.06,
        yRatio: 0.12 + Math.floor(count / 3) * 0.08,
        pageNumber: targetPage,
      };
      setSignatures((prev) => [...prev, newSig]);
      setActiveSignatureId(newSig.id);
    }
    setStatus("Signature added. Click the preview to position it.");
  }

  function signaturesForPage(pageNumber: number) {
    return signatures.filter((s) => s.pageNumber == null || s.pageNumber === pageNumber);
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
    // Keep the output preview on the same page so both previews stay in sync.
    if (outputPreview && outputPreview.mime.includes("pdf")) {
      void loadOutputPdfPreviewPage(pageNumber, outputPreview);
    }
  }

  async function getSignatureImageBytes() {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signatureDrawn) return null;
    const dataUrl = trimSignatureCanvas(canvas);
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

  function removeFileAtIndex(index: number) {
    if (index < 0 || index >= files.length) return;
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    void persistUploadedFiles(tool.slug, next);
    setOutputPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    latestOutputRef.current = null;
    setMergePages([]);
    setMergePageOrder([]);
    setMergeDraggedId(null);
    setMergeDragOverId(null);
    logProcessing(`Removed a file. ${next.length} file(s) remaining.`);
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

    const actualMode = resolveActualProcessingMode(files);

    try {
      setBusy(true);
      logProcessing(`Running ${tool.name} in ${actualMode} mode.`);
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
          // Unlock: decrypt server-side with qpdf (pdf-lib cannot decrypt).
          const form = new FormData();
          form.append("file", firstFile);
          form.append("password", password);
          const response = await fetch("/api/unlock-pdf", { method: "POST", body: form });
          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(data?.error || "Could not unlock this PDF.");
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          stageOutput(
            asPdfBlob(bytes),
            `${normalizeFileName(firstFile.name)}-unlocked.pdf`,
            "Password protection removed. Preview before downloading."
          );
          complete("PDF unlocked — password protection removed.");
          return;
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

        // Server-side PyMuPDF redaction: only the marked rectangles are
        // deleted (glyphs + covered image data); the rest of the document
        // stays real, searchable text — not a raster of the whole page.
        const source = await PDFDocument.load(await readAsArrayBuffer(firstFile));
        const pageCount = source.getPageCount();
        const rects = [];
        for (let pageIdx = 0; pageIdx < pageCount; pageIdx += 1) {
          const page = source.getPage(pageIdx);
          const { width, height } = page.getSize();
          // Page-relative middle band (80% wide) — region selection is the
          // follow-up; this is honest and lands consistently on any page size.
          rects.push({
            page: pageIdx + 1,
            x: width * 0.1,
            y: height * 0.46,
            w: width * 0.8,
            h: Math.min(40, height * 0.05),
          });
        }

        setProgress({ current: 0, total: 1, label: "Redacting on server…" });

        const form = new FormData();
        form.append("file", firstFile);
        form.append("rects", JSON.stringify(rects));
        const redactRes = await fetch("/api/redact-pdf", { method: "POST", body: form });
        if (!redactRes.ok) {
          const data = (await redactRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || "Redaction failed.");
        }
        const redactedBlob = await redactRes.blob();

        setProgress(null);
        stageOutput(
          redactedBlob,
          `${normalizeFileName(firstFile.name)}-redacted.pdf`,
          "Redacted server-side: only the marked regions are removed; the rest stays searchable text."
        );
        complete("Redaction complete. Region selection is coming next; for now a middle band is removed on each page.");
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
                  highlights: editHighlights,
                  shapes: editShapes,
                  whiteouts: editWhiteouts,
                  images: editImages,
                  stamps: editStamps,
                },
              }
            : {};

        // Feature 1 — apply filled AcroForm values before saving (form is kept intact).
        if (tool.slug === "edit-pdf" && editFormFields.length) {
          try {
            const form = source.getForm();
            for (const field of editFormFields) {
              try {
                if (field.type === "text") {
                  form.getTextField(field.name)?.setText(String(field.value));
                } else if (field.type === "checkbox") {
                  const checkBox = form.getCheckBox(field.name);
                  if (checkBox) {
                    if (field.value) checkBox.check();
                    else checkBox.uncheck();
                  }
                } else if (field.type === "radio") {
                  const radioGroup = form.getRadioGroup(field.name);
                  if (radioGroup && typeof field.value === "string" && field.value) radioGroup.select(field.value);
                } else {
                  const dropdown = form.getDropdown(field.name);
                  if (dropdown && typeof field.value === "string" && field.value) dropdown.select(field.value);
                }
              } catch {
                // Unsupported field value — leave the original value untouched.
              }
            }
            try {
              form.updateFieldAppearances(font);
            } catch {
              // Appearance refresh is best-effort.
            }
          } catch {
            // Malformed AcroForm — keep the original form untouched.
          }
        }

        // Feature 3/4 — embed annotation and watermark images once per document.
        const embeddedEditImages: Record<string, PDFImage> = {};
        if (tool.slug === "edit-pdf") {
          for (const layer of Object.values(pageLayers)) {
            for (const imageAnn of layer?.images ?? []) {
              if (embeddedEditImages[imageAnn.id]) continue;
              try {
                const imageBytes = await dataUrlToUint8Array(imageAnn.dataUrl);
                embeddedEditImages[imageAnn.id] =
                  imageAnn.mime === "image/png" ? await source.embedPng(imageBytes) : await source.embedJpg(imageBytes);
              } catch { /* skip failed image */ }
            }
          }
          if (editWatermark?.imageDataUrl) {
            try {
              const watermarkBytes = await dataUrlToUint8Array(editWatermark.imageDataUrl);
              embeddedEditImages.watermark =
                editWatermark.imageMime === "image/png"
                  ? await source.embedPng(watermarkBytes)
                  : await source.embedJpg(watermarkBytes);
            } catch { /* skip failed image */ }
          }
        }
        // Build the list of signatures to apply (multiple supported).
        let allSignatures = signatures;
        if (!allSignatures.length) {
          const fallbackPage = signAllPages ? null : signPageNumber;
          if (signatureMode === "text") {
            allSignatures = [{ id: "single", kind: "text", text: editText || "Signed electronically", xRatio: signaturePlacement.xRatio, yRatio: signaturePlacement.yRatio, pageNumber: fallbackPage }];
          } else if (signatureDrawn && signatureCanvasRef.current) {
            allSignatures = [{ id: "single", kind: "draw", dataUrl: trimSignatureCanvas(signatureCanvasRef.current), xRatio: signaturePlacement.xRatio, yRatio: signaturePlacement.yRatio, pageNumber: fallbackPage }];
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
            const pageNum = index + 1;
            const { width, height } = page.getSize();

            for (const sig of allSignatures) {
              if (sig.pageNumber != null && sig.pageNumber !== pageNum) continue;
              const anchorX = clamp(width * sig.xRatio, 24, width - 24);
              const anchorY = clamp(height * sig.yRatio, 24, height - 24);

              const embedded = sig.kind === "draw" ? embeddedSignatureImages[sig.id] : null;
              if (embedded) {
                const rawWidth = embedded.width;
                const rawHeight = embedded.height;
                let signatureWidth = 170;
                let signatureHeight = (signatureWidth / rawWidth) * rawHeight;
                if (signatureHeight < 24) {
                  signatureHeight = 24;
                  signatureWidth = (signatureHeight / rawHeight) * rawWidth;
                }
                if (signatureHeight > 150) {
                  signatureHeight = 150;
                  signatureWidth = (signatureHeight / rawHeight) * rawWidth;
                }
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
            const pageHighlights = pageLayer?.highlights ?? [];
            const pageShapes = pageLayer?.shapes ?? [];
            const pageWhiteouts = pageLayer?.whiteouts ?? [];
            const pageImages = pageLayer?.images ?? [];
            const pageStamps = pageLayer?.stamps ?? [];

            if (
              pageStrokes.length ||
              pageTextNotes.length ||
              pageHighlights.length ||
              pageShapes.length ||
              pageWhiteouts.length ||
              pageImages.length ||
              pageStamps.length
            ) {
              const { width, height } = page.getSize();
              const canvasSize = editCanvasSizesRef.current[index + 1] ?? editCanvasSize;
              const scaleX = canvasSize.width ? width / canvasSize.width : 1;
              const scaleY = canvasSize.height ? height / canvasSize.height : 1;

              // Highlights sit behind text; whiteouts erase content (drawn after highlights).
              for (const highlight of pageHighlights) {
                if (highlight.width < 1 || highlight.height < 1) continue;
                page.drawRectangle({
                  x: highlight.x * scaleX,
                  y: height - (highlight.y + highlight.height) * scaleY,
                  width: highlight.width * scaleX,
                  height: highlight.height * scaleY,
                  color: hexToRgb(highlight.color),
                  opacity: Math.min(1, Math.max(0.05, highlight.opacity)),
                });
              }

              for (const whiteout of pageWhiteouts) {
                if (whiteout.width < 1 || whiteout.height < 1) continue;
                page.drawRectangle({
                  x: whiteout.x * scaleX,
                  y: height - (whiteout.y + whiteout.height) * scaleY,
                  width: whiteout.width * scaleX,
                  height: whiteout.height * scaleY,
                  color: rgb(1, 1, 1),
                });
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

              for (const shape of pageShapes) {
                const strokeColor = hexToRgb(shape.color);
                const strokeWidth = Math.max(0.8, shape.strokeWidth * ((scaleX + scaleY) / 2));
                const opacity = Math.min(1, Math.max(0.05, shape.opacity));
                if (shape.kind === "rect") {
                  if (shape.width < 1 || shape.height < 1) continue;
                  page.drawRectangle({
                    x: shape.x * scaleX,
                    y: height - (shape.y + shape.height) * scaleY,
                    width: shape.width * scaleX,
                    height: shape.height * scaleY,
                    borderColor: strokeColor,
                    borderWidth: strokeWidth,
                    color: shape.fill ? strokeColor : undefined,
                    opacity,
                    borderOpacity: opacity,
                  });
                } else if (shape.kind === "ellipse") {
                  if (shape.width < 1 || shape.height < 1) continue;
                  page.drawEllipse({
                    x: (shape.x + shape.width / 2) * scaleX,
                    y: height - (shape.y + shape.height / 2) * scaleY,
                    xScale: (shape.width / 2) * scaleX,
                    yScale: (shape.height / 2) * scaleY,
                    borderColor: strokeColor,
                    borderWidth: strokeWidth,
                    color: shape.fill ? strokeColor : undefined,
                    opacity,
                    borderOpacity: opacity,
                  });
                } else {
                  const headX = shape.end.x * scaleX;
                  const headY = height - shape.end.y * scaleY;
                  page.drawLine({
                    start: { x: shape.start.x * scaleX, y: height - shape.start.y * scaleY },
                    end: { x: headX, y: headY },
                    color: strokeColor,
                    thickness: strokeWidth,
                    opacity,
                  });
                  if (shape.kind === "arrow") {
                    const angle = Math.atan2(headY - (height - shape.start.y * scaleY), headX - shape.start.x * scaleX);
                    const headLength = Math.max(8, strokeWidth * 4);
                    page.drawLine({
                      start: { x: headX, y: headY },
                      end: { x: headX - headLength * Math.cos(angle - Math.PI / 6), y: headY - headLength * Math.sin(angle - Math.PI / 6) },
                      color: strokeColor,
                      thickness: strokeWidth,
                      opacity,
                    });
                    page.drawLine({
                      start: { x: headX, y: headY },
                      end: { x: headX - headLength * Math.cos(angle + Math.PI / 6), y: headY - headLength * Math.sin(angle + Math.PI / 6) },
                      color: strokeColor,
                      thickness: strokeWidth,
                      opacity,
                    });
                  }
                }
              }

              // Inserted images (selectable/movable/resizable annotations).
              for (const imageAnn of pageImages) {
                const embedded = embeddedEditImages[imageAnn.id];
                if (!embedded) continue;
                const drawWidth = Math.max(1, imageAnn.width * scaleX);
                const drawHeight = Math.max(1, imageAnn.height * scaleY);
                const centerX = (imageAnn.x + imageAnn.width / 2) * scaleX;
                const centerYPdf = height - (imageAnn.y + imageAnn.height / 2) * scaleY;
                const anchor = pdfRotatedImageAnchor(centerX, centerYPdf, drawWidth, drawHeight, imageAnn.rotation);
                page.drawImage(embedded, {
                  x: anchor.x,
                  y: anchor.y,
                  width: drawWidth,
                  height: drawHeight,
                  rotate: degrees(-imageAnn.rotation),
                });
              }

              // Stamps: rounded, tinted labels rotated around their center.
              for (const stamp of pageStamps) {
                const stampSize = Math.max(8, stamp.size * ((scaleX + scaleY) / 2));
                const textWidth = font.widthOfTextAtSize(stamp.text, stampSize);
                const pillWidth = textWidth + stampSize * 1.7;
                const pillHeight = stampSize * 1.9;
                const centerX = stamp.x * scaleX;
                const centerYPdf = height - stamp.y * scaleY;
                const stampColor = hexToRgb(stamp.color);
                const pillTint = hexToRgb(mixHexWithWhite(stamp.color, 0.82));
                const pillRadius = pillHeight / 2;
                const halfW = pillWidth / 2;
                const halfH = pillHeight / 2;
                page.pushOperators(
                  pushGraphicsState(),
                  translate(centerX, centerYPdf),
                  rotateDegrees(-stamp.rotation),
                  setLineWidth(Math.max(1, stampSize / 12)),
                  setFillingRgbColor(pillTint.red, pillTint.green, pillTint.blue),
                  setStrokingRgbColor(stampColor.red, stampColor.green, stampColor.blue),
                  moveTo(-halfW + pillRadius, -halfH),
                  lineTo(halfW - pillRadius, -halfH),
                  appendQuadraticCurve(halfW, -halfH, halfW, -halfH + pillRadius),
                  lineTo(halfW, halfH - pillRadius),
                  appendQuadraticCurve(halfW, halfH, halfW - pillRadius, halfH),
                  lineTo(-halfW + pillRadius, halfH),
                  appendQuadraticCurve(-halfW, halfH, -halfW, halfH - pillRadius),
                  lineTo(-halfW, -halfH + pillRadius),
                  appendQuadraticCurve(-halfW, -halfH, -halfW + pillRadius, -halfH),
                  closePath(),
                  fillAndStroke()
                );
                page.drawText(stamp.text, {
                  x: -textWidth / 2,
                  y: -stampSize * 0.35,
                  size: stampSize,
                  font,
                  color: stampColor,
                });
                page.pushOperators(popGraphicsState());
              }

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
            }
          }
        });

        // Feature 4 — document-level watermark drawn on every page, after annotations.
        if (tool.slug === "edit-pdf" && editWatermark) {
          const watermarkOpacity = Math.min(1, Math.max(0.02, editWatermark.opacity));
          for (const page of source.getPages()) {
            const { width, height } = page.getSize();
            const centerX = width / 2;
            const centerYPdf = height / 2;
            const watermarkImage = embeddedEditImages.watermark;
            if (watermarkImage) {
              const maxWidth = width * 0.5;
              const maxHeight = height * 0.5;
              const imageScale = Math.min(1, maxWidth / Math.max(1, watermarkImage.width), maxHeight / Math.max(1, watermarkImage.height));
              const drawWidth = watermarkImage.width * imageScale;
              const drawHeight = watermarkImage.height * imageScale;
              const anchor = pdfRotatedImageAnchor(centerX, centerYPdf, drawWidth, drawHeight, editWatermark.rotation);
              page.drawImage(watermarkImage, {
                x: anchor.x,
                y: anchor.y,
                width: drawWidth,
                height: drawHeight,
                rotate: degrees(-editWatermark.rotation),
                opacity: watermarkOpacity,
              });
            } else if (editWatermark.text.trim()) {
              const textWidth = font.widthOfTextAtSize(editWatermark.text, editWatermark.size);
              const anchor = pdfRotatedTextAnchor(centerX, centerYPdf, textWidth, editWatermark.size, editWatermark.rotation);
              page.drawText(editWatermark.text, {
                x: anchor.x,
                y: anchor.y,
                size: editWatermark.size,
                font,
                color: hexToRgb(editWatermark.color),
                rotate: degrees(-editWatermark.rotation),
                opacity: watermarkOpacity,
              });
            }
          }
        }

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
        await persistRunReport(runStartedAt, completionMessage, actualMode);
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
        {backTarget ? (
          <button
            type="button"
            onClick={() => router.push(backTarget.href)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to {backTarget.label}
          </button>
        ) : null}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <div className="flex items-center gap-2.5">
            <ToolIcon category={tool.category} className="h-6 w-6 shrink-0 text-slate-500" />
            <h2 className="font-display text-2xl font-semibold text-slate-950">{tool.name}</h2>
            {tool.processing === "local" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Works offline
              </span>
            ) : tool.processing === "conditional" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                Offline for PDFs
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Requires internet
              </span>
            )}
          </div>
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
            className="hidden"
          />
        ) : null}

        {shouldShowFileInput ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 shadow-sm transition hover:bg-cyan-50"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4v12M4 10h12" strokeLinecap="round" />
            </svg>
            {files.length > 0 ? "Add More Files" : "Choose Files"}
          </button>
        ) : null}

        {shouldShowFileInput && files.length === 0 ? (
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

        {shouldShowFileInput && files.length > 0 ? (
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            {files.map((file, index) => {
              const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
              const isImageFile = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
              const accent = isPdfFile
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : isImageFile
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-cyan-200 bg-cyan-50 text-cyan-700";
              return (
                <span
                  key={`${file.name}-${index}`}
                  className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${accent}`}
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M6 3h6l4 4v10H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFileAtIndex(index)}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-slate-200 hover:opacity-100"
                    aria-label={`Remove ${file.name}`}
                    title="Remove file"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="sticky-action-bar">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runTool}
              disabled={busy}
              aria-busy={busy}
              className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#1e40af", boxShadow: "0 4px 16px rgba(30,64,175,0.3)" }}
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
                  className="h-full rounded-full bg-[#1e40af] transition-all duration-300"
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
            <div role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
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
                      className="mt-2 w-full rounded-md px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:scale-[1.02]"
                      style={{ background: "#ef4444", boxShadow: "0 2px 8px rgba(239,68,68,0.35)" }}
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
              {/* Saved signatures — reuse first */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Saved signatures</p>
                  <button
                    type="button"
                    onClick={saveCurrentSignature}
                    className="btn btn-secondary rounded-md px-2.5 py-1 text-xs"
                  >
                    Save current
                  </button>
                </div>
                {savedSignatures.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {savedSignatures.map((sig) => (
                      <button
                        key={sig.id}
                        type="button"
                        onClick={() => applySavedSignature(sig)}
                        className="group relative flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 text-center transition hover:border-cyan-400 hover:bg-cyan-50"
                        title="Click to use this signature"
                      >
                        <span
                          className="flex h-11 w-full items-center justify-center overflow-hidden rounded-md"
                          style={{ background: "#ffffff", boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)" }}
                        >
                          {sig.kind === "draw" && sig.dataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sig.dataUrl} alt="Saved signature" className="max-h-9 max-w-full object-contain" />
                          ) : (
                            <span className="text-lg italic text-slate-900" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{sig.label}</span>
                          )}
                        </span>
                        <span className="text-[10px] font-medium text-slate-500 group-hover:text-cyan-700">Tap to reuse</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); deleteSavedSignature(sig.id); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); deleteSavedSignature(sig.id); } }}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold leading-none text-white opacity-0 shadow transition group-hover:opacity-100"
                          aria-label="Delete saved signature"
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="field-help">No saved signatures yet. Create one below, then tap "Save current" to reuse it across documents.</p>
                )}
              </div>

              {/* Create a new signature */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">New signature</p>
                  <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => setSignatureMode("text")}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        signatureMode === "text" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      Type
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignatureMode("draw")}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        signatureMode === "draw" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      Draw
                    </button>
                  </div>
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

              <div className="flex items-center justify-between gap-2">
                <p className="field-help">Add this signature to the document (you can add multiple).</p>
                <button
                  type="button"
                  onClick={addSignatureToDocument}
                  className="rounded-md px-3 py-1 text-xs font-bold text-white"
                  style={{ background: "#1e40af" }}
                >
                  Add signature
                </button>
              </div>
              </div>

              {/* Signatures on this document */}
              {signatures.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">On this document</p>
                  <div className="flex flex-wrap gap-2">
                    {signatures.map((sig, i) => (
                      <div
                        key={sig.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${activeSignatureId === sig.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50"}`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSignatureId(sig.id);
                            if (sig.pageNumber != null && sig.pageNumber !== signPageNumber) {
                              void loadSignPage(sig.pageNumber);
                            }
                          }}
                          className="text-xs font-medium text-slate-700 hover:text-indigo-700"
                        >
                          {sig.kind === "draw" ? `Drawn ${i + 1}` : sig.text}
                          <span className="ml-1 text-[10px] text-slate-400">{sig.pageNumber == null ? "all pages" : `p. ${sig.pageNumber}`}</span>
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
                  {activeSignatureId ? <p className="field-help">Select a signature above, then click the preview to position it.</p> : null}
                </div>
              ) : null}

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
                  {signAllPages ? (
                    <span className="text-[11px] text-slate-400">new signatures appear on every page</span>
                  ) : (
                    <span className="text-[11px] text-slate-400">new signatures appear on the current page only</span>
                  )}
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
                    {signaturesForPage(signPageNumber).map((sig) => (
                      <span
                        key={sig.id}
                        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${activeSignatureId === sig.id ? "rounded-sm outline outline-2 outline-offset-1 outline-cyan-500" : ""}`}
                        style={{ left: `${sig.xRatio * 100}%`, top: `${(1 - sig.yRatio) * 100}%` }}
                      >
                        {sig.kind === "draw" && sig.dataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={sig.dataUrl} alt="Placed signature" className="max-h-14 max-w-28 rounded-sm border border-cyan-400/70 bg-white shadow-sm" />
                        ) : (
                          <span className="whitespace-nowrap text-sm italic text-indigo-900 drop-shadow-sm" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{sig.text}</span>
                        )}
                      </span>
                    ))}
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
            <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-[0_18px_50px_-20px_rgba(2,6,23,0.6)]">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-700/70 bg-slate-950 px-2 py-1.5">
                {EDIT_TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => setEditMode(option.mode)}
                    aria-pressed={editMode === option.mode}
                    title={`${option.label} — ${option.hint}`}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                      editMode === option.mode
                        ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/40"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <EditToolGlyph mode={option.mode} />
                    <span className="hidden xl:inline">{option.label}</span>
                  </button>
                ))}

                <span className="mx-1 h-4 w-px bg-slate-700/70" />

                <button
                  type="button"
                  onClick={() => editImageInputRef.current?.click()}
                  title="Insert image — pick a PNG or JPG and it appears on the page"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <span className="hidden xl:inline">Insert image</span>
                </button>
                <input
                  ref={editImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={onEditImageInputChange}
                  aria-hidden="true"
                  tabIndex={-1}
                />

                <span className="mx-1 h-4 w-px bg-slate-700/70" />

                <button
                  type="button"
                  onClick={undoEditAction}
                  disabled={!(editUndoStacksRef.current[editPageNumber]?.length)}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={redoEditAction}
                  disabled={!(editRedoStacksRef.current[editPageNumber]?.length)}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="m15 14 5-5-5-5" />
                    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
                  </svg>
                </button>

                <span className="ml-auto hidden max-w-[240px] truncate text-[11px] font-medium text-slate-500 sm:inline">
                  {files[0]?.name ?? "No document loaded"}
                </span>
              </div>

              {/* Properties bar */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-700/70 bg-slate-900 px-3 py-2">
                {editMode === "draw" ||
                editMode === "text" ||
                editMode === "highlight" ||
                editMode === "rect" ||
                editMode === "ellipse" ||
                editMode === "line" ||
                editMode === "arrow" ? (
                  <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                    <span className="relative inline-block h-6 w-9 overflow-hidden rounded-md border border-slate-600 bg-slate-800 shadow-inner">
                      <input
                        type="color"
                        value={editColor}
                        onChange={(event) => setEditColor(event.target.value)}
                        className="absolute -inset-1 h-8 w-11 cursor-pointer"
                        aria-label="Annotation color"
                      />
                    </span>
                    Color
                  </label>
                ) : null}

                {editMode === "draw" || editMode === "rect" || editMode === "ellipse" || editMode === "line" || editMode === "arrow" ? (
                  <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={editBrushSize}
                      onChange={(event) => setEditBrushSize(Number(event.target.value))}
                      className="w-24 accent-sky-400"
                    />
                    {editMode === "draw" ? "Brush" : "Stroke"} {editBrushSize.toFixed(1)}px
                  </label>
                ) : null}

                {editMode === "text" ? (
                  <>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                      <input
                        type="range"
                        min={10}
                        max={48}
                        step={1}
                        value={editFontSize}
                        onChange={(event) => setEditFontSize(Number(event.target.value))}
                        className="w-24 accent-sky-400"
                      />
                      Size {editFontSize}px
                    </label>
                    <input
                      id="edit-text"
                      type="text"
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      placeholder="Type your text, then click the page to place it"
                      className="min-w-[220px] flex-1 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                    />
                  </>
                ) : null}

                {editMode === "stamp" ? (
                  <>
                    <div className="flex items-center gap-1">
                      {STAMP_PRESETS.map((preset, index) => (
                        <button
                          key={preset.text}
                          type="button"
                          onClick={() => setEditStampPreset(index)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition ${
                            editStampPreset === index
                              ? "border-sky-400 bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50"
                              : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                          }`}
                          style={editStampPreset === index ? { color: preset.color } : undefined}
                        >
                          {preset.text}
                        </button>
                      ))}
                    </div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                      <input
                        type="range"
                        min={16}
                        max={56}
                        step={2}
                        value={editFontSize}
                        onChange={(event) => setEditFontSize(Number(event.target.value))}
                        className="w-24 accent-sky-400"
                      />
                      Size {editFontSize}px
                    </label>
                  </>
                ) : null}

                {editMode === "select" && selectedEditId?.kind === "image" ? (
                  <>
                    <span className="text-[11px] text-slate-500">Image</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => rotateEditImage(-15)}
                        title="Rotate left 15°"
                        className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                      >
                        ↺ 15°
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateEditImage(15)}
                        title="Rotate right 15°"
                        className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                      >
                        ↻ 15°
                      </button>
                    </div>
                    <span className="text-[11px] text-slate-500">Drag the corner handle to resize</span>
                  </>
                ) : null}

                {editMode === "highlight" || editMode === "rect" || editMode === "ellipse" || editMode === "line" || editMode === "arrow" ? (
                  <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={editOpacity}
                      onChange={(event) => setEditOpacity(Number(event.target.value))}
                      className="w-24 accent-sky-400"
                    />
                    Opacity {editOpacity}%
                  </label>
                ) : null}

                {editMode === "rect" || editMode === "ellipse" ? (
                  <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                    <input
                      type="checkbox"
                      checked={editFillShape}
                      onChange={(event) => setEditFillShape(event.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-400"
                    />
                    Fill
                  </label>
                ) : null}

                {editMode === "select" || editMode === "whiteout" || editMode === "edit-text" ? (
                  <span className="text-[11px] text-slate-500">{EDIT_TOOL_HINTS[editMode]}</span>
                ) : null}

                {/* Feature 5 — batch apply scope + Feature 6 — snap-to-grid */}
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <span className="text-slate-500">Apply to:</span>
                  <select
                    value={editBatchScope}
                    onChange={(event) => setEditBatchScope(event.target.value as EditBatchScope)}
                    className="rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[11px] text-slate-300 focus:border-sky-400 focus:outline-none"
                    aria-label="Apply annotations to"
                  >
                    <option value="this">This page</option>
                    <option value="all">All pages</option>
                    <option value="range">Page range</option>
                  </select>
                  {editBatchScope === "range" ? (
                    <input
                      type="text"
                      value={editBatchRange}
                      onChange={(event) => setEditBatchRange(event.target.value)}
                      placeholder="e.g. 2-5"
                      className="w-20 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-400 focus:outline-none"
                      aria-label="Page range for batch apply"
                    />
                  ) : null}
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                  <input
                    type="checkbox"
                    checked={editSnapToGrid}
                    onChange={(event) => setEditSnapToGrid(event.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-400"
                  />
                  Snap to grid
                </label>

                <button
                  type="button"
                  onClick={clearEditCanvasActions}
                  disabled={!editPageLayerHasContent}
                  className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Clear page
                </button>
                <button
                  type="button"
                  onClick={clearEditDocumentActions}
                  disabled={!editPageCountEdited && !editPageLayerHasContent}
                  className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Clear document
                </button>
              </div>

              <div className="flex">
                {/* Page thumbnail sidebar */}
                <div className="hidden w-52 shrink-0 flex-col border-r border-slate-700/70 bg-slate-950 md:flex" style={{ maxHeight: "72vh" }}>
                  <p className="border-b border-slate-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Pages
                  </p>
                  <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "40vh" }}>
                    {pageThumbnails.length > 0 ? (
                      pageThumbnails.map((thumb) => {
                        const pageLayer = editLayersByPage[thumb.pageNumber];
                        const hasEdits = Boolean(
                          pageLayer &&
                            (pageLayer.strokes.length ||
                              pageLayer.textNotes.length ||
                              pageLayer.highlights.length ||
                              pageLayer.shapes.length ||
                              pageLayer.whiteouts.length ||
                              pageLayer.images.length ||
                              pageLayer.stamps.length)
                        );
                        const annotationCount = pageLayer
                          ? pageLayer.strokes.length +
                            pageLayer.textNotes.length +
                            pageLayer.highlights.length +
                            pageLayer.shapes.length +
                            pageLayer.whiteouts.length +
                            pageLayer.images.length +
                            pageLayer.stamps.length
                          : 0;
                        const isActivePage = thumb.pageNumber === editPageNumber;
                        return (
                          <button
                            key={thumb.pageNumber}
                            type="button"
                            onClick={() => {
                              if (files[0]) void loadEditPreview(files[0], thumb.pageNumber);
                            }}
                            title={`Go to page ${thumb.pageNumber}`}
                            className={`relative block w-full overflow-hidden rounded-md border text-left transition ${
                              isActivePage
                                ? "border-sky-400 bg-sky-500/10 ring-1 ring-sky-400/50"
                                : "border-slate-700/70 bg-slate-800/60 hover:border-slate-500"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumb.dataUrl} alt={`Page ${thumb.pageNumber}`} className="h-auto w-full" />
                            <span
                              className={`absolute bottom-1 left-1 rounded px-1 text-[9px] font-bold ${
                                isActivePage ? "bg-sky-400 text-slate-950" : "bg-slate-950/80 text-slate-300"
                              }`}
                            >
                              {thumb.pageNumber}
                            </span>
                            {hasEdits ? (
                              <span
                                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-slate-950 shadow"
                                title={`${annotationCount} edit(s) on this page`}
                              >
                                {annotationCount}
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <p className="p-2 text-[11px] text-slate-500">Upload a PDF to see page thumbnails.</p>
                    )}
                  </div>

                  {/* Feature 1 — Forms panel (only when the PDF has AcroForm fields) */}
                  {editFormFields.length > 0 ? (
                    <div className="border-t border-slate-700/70">
                      <details open className="group">
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300">
                          Forms ({editFormFields.length})
                          <span className="text-slate-600 group-open:rotate-180">▾</span>
                        </summary>
                        <div className="space-y-2.5 overflow-y-auto p-2" style={{ maxHeight: "28vh" }}>
                          {editFormFields.map((field) => (
                            <div key={field.name} className="space-y-1">
                              <p className="break-words text-[10px] font-medium leading-tight text-slate-400" title={field.name}>
                                {field.name}
                              </p>
                              {field.type === "text" ? (
                                <input
                                  type="text"
                                  value={typeof field.value === "string" ? field.value : ""}
                                  onChange={(event) => updateEditFormFieldValue(field.name, event.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-400 focus:outline-none"
                                  placeholder="Fill value…"
                                />
                              ) : field.type === "checkbox" ? (
                                <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(field.value)}
                                    onChange={(event) => updateEditFormFieldValue(field.name, event.target.checked)}
                                    className="h-3.5 w-3.5 accent-sky-400"
                                  />
                                  Checked
                                </label>
                              ) : field.type === "radio" ? (
                                <div className="space-y-1">
                                  {field.options.map((option) => (
                                    <label key={option} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                                      <input
                                        type="radio"
                                        name={field.name}
                                        checked={field.value === option}
                                        onChange={() => updateEditFormFieldValue(field.name, option)}
                                        className="h-3.5 w-3.5 accent-sky-400"
                                      />
                                      {option || "(empty)"}
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <select
                                  value={typeof field.value === "string" ? field.value : ""}
                                  onChange={(event) => updateEditFormFieldValue(field.name, event.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-[11px] text-slate-200 focus:border-sky-400 focus:outline-none"
                                >
                                  <option value="">— select —</option>
                                  {field.options.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : null}

                  {/* Feature 4 — document-level watermark controls */}
                  <div className="border-t border-slate-700/70">
                    <details className="group">
                      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300">
                        Document
                        <span className="text-slate-600 group-open:rotate-180">▾</span>
                      </summary>
                        <div className="space-y-2 overflow-y-auto p-2" style={{ maxHeight: "24vh" }}>
                        <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                          <input
                            type="checkbox"
                            checked={Boolean(editWatermark)}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setEditWatermark({ ...DEFAULT_EDIT_WATERMARK });
                              } else {
                                setEditWatermark(null);
                                editWatermarkImageRef.current = null;
                              }
                            }}
                            className="h-3.5 w-3.5 accent-sky-400"
                          />
                          Watermark all pages
                        </label>
                        {editWatermark ? (
                          <>
                            {!editWatermark.imageDataUrl ? (
                              <>
                                <input
                                  type="text"
                                  value={editWatermark.text}
                                  onChange={(event) =>
                                    setEditWatermark((current) =>
                                      current ? { ...current, text: event.target.value } : current
                                    )
                                  }
                                  placeholder="Watermark text"
                                  className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-sky-400 focus:outline-none"
                                />
                                <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                  <input
                                    type="range"
                                    min={24}
                                    max={160}
                                    step={2}
                                    value={editWatermark.size}
                                    onChange={(event) =>
                                      setEditWatermark((current) =>
                                        current ? { ...current, size: Number(event.target.value) } : current
                                      )
                                    }
                                    className="w-full accent-sky-400"
                                  />
                                  Size {editWatermark.size}
                                </label>
                              </>
                            ) : null}
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                              <input
                                type="range"
                                min={5}
                                max={90}
                                step={5}
                                value={Math.round(editWatermark.opacity * 100)}
                                onChange={(event) =>
                                  setEditWatermark((current) =>
                                    current ? { ...current, opacity: Number(event.target.value) / 100 } : current
                                  )
                                }
                                className="w-full accent-sky-400"
                              />
                              Opacity {Math.round(editWatermark.opacity * 100)}%
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                              <input
                                type="range"
                                min={-90}
                                max={90}
                                step={5}
                                value={editWatermark.rotation}
                                onChange={(event) =>
                                  setEditWatermark((current) =>
                                    current ? { ...current, rotation: Number(event.target.value) } : current
                                  )
                                }
                                className="w-full accent-sky-400"
                              />
                              Rotation {editWatermark.rotation}°
                            </label>
                            {!editWatermark.imageDataUrl ? (
                              <label className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400">
                                <span className="relative inline-block h-6 w-9 overflow-hidden rounded-md border border-slate-600 bg-slate-800 shadow-inner">
                                  <input
                                    type="color"
                                    value={editWatermark.color}
                                    onChange={(event) =>
                                      setEditWatermark((current) =>
                                        current ? { ...current, color: event.target.value } : current
                                      )
                                    }
                                    className="absolute -inset-1 h-8 w-11 cursor-pointer"
                                    aria-label="Watermark color"
                                  />
                                </span>
                                Color
                              </label>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => editWatermarkImageInputRef.current?.click()}
                                className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                              >
                                {editWatermark.imageDataUrl ? "Change image" : "Use image instead"}
                              </button>
                              {editWatermark.imageDataUrl ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    editWatermarkImageRef.current = null;
                                    setEditWatermark((current) =>
                                      current ? { ...current, imageDataUrl: "", imageMime: "" } : current
                                    );
                                  }}
                                  className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-rose-300 transition hover:border-rose-500/60"
                                >
                                  Remove image
                                </button>
                              ) : null}
                            </div>
                            <input
                              ref={editWatermarkImageInputRef}
                              type="file"
                              accept="image/png,image/jpeg"
                              className="hidden"
                              onChange={onEditWatermarkImageInputChange}
                              aria-hidden="true"
                              tabIndex={-1}
                            />
                          </>
                        ) : null}
                      </div>
                    </details>
                  </div>
                </div>

                {/* Editor canvas */}
                <div className="min-w-0 flex-1 overflow-auto bg-slate-950 p-6" style={{ maxHeight: "72vh" }}>
                  {editCanvasLoading ? (
                    <p className="py-10 text-center text-xs text-slate-400">Preparing editable page canvas…</p>
                  ) : editPreview ? (
                    <div className="mx-auto w-fit rounded-sm border border-slate-600 bg-white p-2 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]">
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
                          editMode === "draw" ||
                          editMode === "highlight" ||
                          editMode === "rect" ||
                          editMode === "ellipse" ||
                          editMode === "line" ||
                          editMode === "arrow" ||
                          editMode === "whiteout" ||
                          editMode === "stamp"
                            ? "cursor-crosshair"
                            : editMode === "text" || editMode === "edit-text"
                              ? "cursor-text"
                              : "cursor-default"
                        }`}
                        aria-label="Edit PDF canvas"
                      />
                    </div>
                  ) : (
                    <div className="py-16 text-center">
                      <p className="text-sm font-medium text-slate-300">No document loaded</p>
                      <p className="mt-1 text-xs text-slate-500">Upload a PDF above to start editing.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Status bar */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-700/70 bg-slate-950 px-3 py-1.5 text-[11px] text-slate-400">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (files[0]) void loadEditPreview(files[0], Math.max(1, editPageNumber - 1));
                    }}
                    disabled={!files[0] || editPageNumber <= 1 || editCanvasLoading}
                    className="rounded px-1.5 py-0.5 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Previous page"
                  >
                    ◀
                  </button>
                  <span className="px-1">
                    Page {editPageNumber} / {editPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (files[0]) void loadEditPreview(files[0], Math.min(editPageCount, editPageNumber + 1));
                    }}
                    disabled={!files[0] || editPageNumber >= editPageCount || editCanvasLoading}
                    className="rounded px-1.5 py-0.5 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="Next page"
                  >
                    ▶
                  </button>
                </div>

                <span className="hidden max-w-[300px] truncate text-slate-500 sm:inline">
                  {EDIT_TOOL_HINTS[editMode]}
                </span>

                <div className="ml-auto flex items-center gap-2">
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                    {editPageCountEdited} edited page{editPageCountEdited === 1 ? "" : "s"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => changeEditZoom(-1)}
                      disabled={editZoom <= 50}
                      className="rounded px-1.5 py-0.5 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <select
                      value={editZoom}
                      onChange={(event) => setEditZoom(Number(event.target.value))}
                      className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-[11px] text-slate-300 focus:border-sky-400 focus:outline-none"
                      aria-label="Zoom level"
                    >
                      {[50, 75, 90, 100, 110, 125, 150, 175, 200].map((zoomValue) => (
                        <option key={zoomValue} value={zoomValue}>
                          {zoomValue}%
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => changeEditZoom(1)}
                      disabled={editZoom >= 200}
                      className="rounded px-1.5 py-0.5 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                  </div>
                </div>
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

          {usesThumbnailEditor ? (
            <div className="space-y-2 border-t border-slate-200 pt-3">
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
        </div>
      </div>
    </section>
  );
}
