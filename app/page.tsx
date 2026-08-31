"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { rankToolsByIntent } from "@/lib/tool-intent-search";
import { ACTIVE_TOOL_ITEMS, TOOL_ITEMS } from "@/lib/tools";
import Swal from "sweetalert2";
import { ToolIcon } from "@/app/components/tool-icon";
import { WORKFLOW_RECIPES } from "@/lib/workflow-recipes";
import {
  clearWorkflowPipeline,
  stageWorkflowPipeline,
} from "@/lib/workflow-pipeline";
import { loadSharedFiles, persistSharedFiles, clearSharedFiles } from "@/lib/file-persistence";

/* ── helpers ────────────────────────────────────────────────────── */

function getWorkflowCreatedAt() {
  return Date.now();
}

function getCategoryColor(category: string) {
  // Solid, saturated category chip (white text on the 600 step) — bright, not tinted.
  const hue = CATEGORY_HUE[category] ?? "organise";
  return `bg-[var(--tool-${hue}-600)] text-white border-transparent`;
}

// Category → token hue prefix (Sign shares the Secure amber hue).
const CATEGORY_HUE: Record<string, string> = {
  Organize: "organise",
  Optimize: "optimise",
  Convert: "convert",
  Security: "secure",
  Edit: "edit",
  Sign: "secure",
};

const CATEGORY_GROUPS: Array<{ label: string; hue: string; categories: string[] }> = [
  { label: "Organize", hue: "organise", categories: ["Organize"] },
  { label: "Optimize", hue: "optimise", categories: ["Optimize"] },
  { label: "Convert", hue: "convert", categories: ["Convert"] },
  { label: "Security & Sign", hue: "secure", categories: ["Security", "Sign"] },
  { label: "Edit", hue: "edit", categories: ["Edit"] },
];

// Render the first few pages of a dropped PDF as real thumbnails (< 1s for small docs).
async function renderHeroThumbnails(file: File, maxPages = 4): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { configurePdfJsWorker } = await import("@/lib/transforms/rasterize");
    configurePdfJsWorker(pdfjs);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({ data: bytes });
    const pdf = await task.promise;
    const count = Math.min(pdf.numPages, maxPages);
    const thumbs: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 0.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) break;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      thumbs.push(canvas.toDataURL("image/jpeg", 0.85));
    }
    return thumbs;
  } catch {
    return [];
  }
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc",
  ".docx",
];

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.endsWith(".pdf");
}

function isImage(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function isWord(file: File) {
  return file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.(doc|docx)$/i.test(file.name);
}

function getDropSuggestions(files: File[]): string[] {
  if (!files.length) return [];
  const types = new Set(files.map((f) => (isPdf(f) ? "pdf" : isImage(f) ? "image" : isWord(f) ? "word" : "other")));
  // Mixed file types → the unified Convert to PDF handles them all.
  if (types.size > 1) {
    return ["convert-to-pdf", "ocr-pdf"];
  }
  const first = files[0];
  if (isPdf(first)) {
    return ["convert-to-pdf", "merge-pdf", "compress-pdf", "ocr-pdf"];
  }
  if (isImage(first)) {
    return ["convert-to-pdf", "ocr-pdf"];
  }
  if (isWord(first)) {
    return ["convert-to-pdf"];
  }
  return ["convert-to-pdf", "compress-pdf", "sign-pdf"];
}

/* ── component ──────────────────────────────────────────────────── */

export default function Home() {
  const router = useRouter();
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkflowRecipeRef = useRef<
    (typeof WORKFLOW_RECIPES)[number] | null
  >(null);
  const [intentQuery, setIntentQuery] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  /* ── clear "previous tool" marker while on home ──────────────── */
  useEffect(() => {
    try {
      localStorage.removeItem("wiserfiles-last-tool");
    } catch {
      // ignore
    }
  }, []);

  /* ── restore previously uploaded files when returning home ───── */
  useEffect(() => {
    let cancelled = false;
    void loadSharedFiles().then((restored) => {
      if (cancelled || !restored.length) return;
      setDropFiles(restored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── server status check ──────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      try {
        const resp = await fetch("/api/ocr-pdf", { method: "HEAD" });
        if (!cancelled) setServerOnline(resp.ok || resp.status === 405);
      } catch {
        if (!cancelled) setServerOnline(false);
      }
      if (!cancelled) {
        timer = setTimeout(check, 30_000);
      }
    }

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  function toggleListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setIntentQuery(transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  /* ── drop-zone state ──────────────────────────────────────────── */
  const [dragOver, setDragOver] = useState(false);
  const [dropFiles, setDropFiles] = useState<File[]>([]);
  const dropFile = dropFiles[0] ?? null;
  const [dropFileInfo, setDropFileInfo] = useState<{
    kind: "pdf" | "image";
    pageCount?: number;
    width?: number;
    height?: number;
  } | null>(null);
  const [heroThumbs, setHeroThumbs] = useState<string[]>([]);
  const dropSuggestions = useMemo(
    () => (dropFiles.length ? getDropSuggestions(dropFiles) : []),
    [dropFiles],
  );
  const suggestedTools = useMemo(
    () =>
      dropSuggestions
        .map((slug) => TOOL_ITEMS.find((t) => t.slug === slug))
        .filter(Boolean) as typeof TOOL_ITEMS,
    [dropSuggestions],
  );
  useEffect(() => {
    if (!dropFiles.length) return;

    let cancelled = false;

    async function readFileInfo() {
      const pdfFiles = dropFiles.filter((f) => isPdf(f));
      if (pdfFiles.length) {
        try {
          const { PDFDocument: PDFDoc } = await import("pdf-lib");
          let totalPages = 0;
          for (const file of pdfFiles) {
            if (cancelled) return;
            try {
              const buffer = await file.arrayBuffer();
              const doc = await PDFDoc.load(buffer, { ignoreEncryption: true });
              totalPages += doc.getPageCount();
            } catch {
              // skip files that can't be read
            }
          }
          if (!cancelled) setDropFileInfo({ kind: "pdf", pageCount: totalPages || undefined });
        } catch {
          if (!cancelled) setDropFileInfo({ kind: "pdf" });
        }
        return;
      }

      const imageFile = dropFiles.find((f) => isImage(f));
      if (imageFile) {
        try {
          const img = new Image();
          const url = URL.createObjectURL(imageFile);
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = url;
          });
          URL.revokeObjectURL(url);
          if (!cancelled) {
            setDropFileInfo({ kind: "image", width: img.naturalWidth, height: img.naturalHeight });
          }
        } catch {
          if (!cancelled) setDropFileInfo({ kind: "image" });
        }
      }
    }

    readFileInfo();
    return () => { cancelled = true; };
  }, [dropFiles]);

  /* ── render real page thumbnails the moment a PDF lands ───────── */
  useEffect(() => {
    if (!dropFile || !isPdf(dropFile)) {
      setHeroThumbs([]);
      return;
    }
    let cancelled = false;
    setHeroThumbs([]);
    void renderHeroThumbnails(dropFile).then((thumbs) => {
      if (!cancelled) setHeroThumbs(thumbs);
    });
    return () => { cancelled = true; };
  }, [dropFile]);

  function clearDrop() {
    setDropFiles([]);
    setDropFileInfo(null);
    setDragOver(false);
    setHeroThumbs([]);
    void clearSharedFiles();
  }

  function removeDropFile(index: number) {
    setDropFiles((current) => {
      if (index < 0 || index >= current.length) return current;
      const next = current.filter((_, i) => i !== index);
      void persistSharedFiles(next);
      return next;
    });
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    const compatible = files.filter((f) => isPdf(f) || isImage(f) || isWord(f));
    if (compatible.length) {
      setDropFileInfo(null);
      setDropFiles(compatible);
      void persistSharedFiles(compatible);
    }
  }

  function handleBrowse(file: File) {
    if (isPdf(file) || isImage(file)) {
      setDropFileInfo(null);
      setDropFiles([file]);
      void persistSharedFiles([file]);
    }
  }

  function handleBrowseMultiple(files: File[]) {
    const compatible = files.filter((f) => isPdf(f) || isImage(f) || isWord(f));
    if (compatible.length) {
      setDropFileInfo(null);
      setDropFiles(compatible);
      void persistSharedFiles(compatible);
    }
  }

  function navigateToTool(slug: string) {
    if (!dropFile) return;
    stageWorkflowPipeline({
      fromToolSlug: "home-dropzone",
      toToolSlug: slug,
      fileName: dropFile.name,
      mime: dropFile.type || "application/octet-stream",
      blob: dropFile,
      files: dropFiles.map((f) => ({ name: f.name, type: f.type || "application/octet-stream", blob: f })),
      createdAt: getWorkflowCreatedAt(),
    });
    router.push(`/tools/${slug}?pipeline=true`);
  }

  // Searchable grid dialog for the full tool list — replaces the long
  // vertical dropdown that overflowed the viewport.
  function openAllToolsDialog() {
    // Always show the full catalogue so every tool (e.g. Sign PDF) is reachable.
    const tools = ACTIVE_TOOL_ITEMS;
    const cards = tools
      .map(
        (t) => `
          <button type="button" data-tool-slug="${t.slug}" data-tool-name="${t.name}" class="swal-tool-card" title="${t.description || t.name}">
            <span class="swal-tool-card-name">${t.name}</span>
          </button>`
      )
      .join("");

    void Swal.fire({
      title: "All tools",
      html: `
        <div style="text-align:left">
          <input id="swal-tool-search" class="swal-tool-search" placeholder="Search tools…">
          <div id="swal-tool-grid" class="swal-tool-grid">${cards}</div>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: "Close",
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
            const slug = (card as HTMLElement).getAttribute("data-tool-slug") || "";
            Swal.close();
            if (slug) navigateToTool(slug);
          });
        });
      },
    });
  }

  /* ── search ───────────────────────────────────────────────────── */
  const searchResults = useMemo(() => {
    if (!intentQuery.trim()) return null;
    return rankToolsByIntent(ACTIVE_TOOL_ITEMS, intentQuery)
      .filter((entry) => entry.score > 0)
      .slice(0, 12)
      .map((entry) => entry.tool);
  }, [intentQuery]);

  /* ── workflow recipes ─────────────────────────────────────────── */
  function startWorkflow(recipe: (typeof WORKFLOW_RECIPES)[number]) {
    pendingWorkflowRecipeRef.current = recipe;
    workflowFileInputRef.current?.click();
  }
  function handleWorkflowFileSelect(file: File | null) {
    const recipe = pendingWorkflowRecipeRef.current;
    pendingWorkflowRecipeRef.current = null;
    if (!recipe || !file) return;
    const firstStep = recipe.steps[0];
    recipe.steps.slice(1).forEach((step) =>
      clearWorkflowPipeline(step.toolSlug),
    );
    stageWorkflowPipeline({
      fromToolSlug: "workflow-home",
      toToolSlug: firstStep.toolSlug,
      recipeSlug: recipe.slug,
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      blob: file,
      createdAt: getWorkflowCreatedAt(),
    });
    router.push(
      `/tools/${firstStep.toolSlug}?recipe=${encodeURIComponent(recipe.slug)}`,
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col">
      <main className="w-full">
        {/* ── Server status banner ──────────────────────────────── */}
        {serverOnline === false ? (
          <div className="border-b border-orange-200 bg-orange-50 px-4 py-2.5 text-center text-sm text-orange-800">
            <span className="font-semibold">⚡ Server tools (OCR, PDF-to-Word) are currently unavailable.</span>{" "}
            Browser tools still work. Retrying every 30 seconds…
          </div>
        ) : null}

        {/* ── Hero — coloured band with a dominant drop zone ────── */}
        <section className="relative overflow-hidden bg-[var(--accent-700)] text-white">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:px-10 md:py-16">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="font-display text-3xl font-bold leading-tight tracking-tight md:text-5xl">
                Every PDF tool you need. Free.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-base text-blue-100 md:text-lg">
                Most tools run in your browser, so your file never leaves it. The few that need
                our servers are deleted the moment they're done.
              </p>
            </div>

            {/* Drop zone (white card on the colour band) */}
            <div className="mx-auto mt-8 max-w-3xl">
              <div
                role="button"
                tabIndex={0}
                aria-label="Drop file here or click to browse — PDF, PNG, JPG, WebP accepted"
                id="hero-drop-zone"
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    const input = document.getElementById("hero-file-input") as HTMLInputElement | null;
                    input?.click();
                  }
                }}
                onClick={() => {
                  const input = document.getElementById("hero-file-input") as HTMLInputElement | null;
                  input?.click();
                }}
                className={`relative cursor-pointer rounded-2xl border-2 border-dashed bg-white p-6 text-center shadow-2xl transition-all duration-200 md:p-9 ${
                  dragOver
                    ? "border-[var(--accent-500)] ring-4 ring-[var(--accent-300)]"
                    : "border-[var(--accent-300)] hover:border-[var(--accent-500)]"
                }`}
              >
                <input
                  id="hero-file-input"
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) handleBrowseMultiple(files);
                    e.currentTarget.value = "";
                  }}
                />

                {dropFile ? (
                  <div className="flex flex-col items-center gap-3 text-slate-900">
                    {dropFiles.length > 1 ? (
                      <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
                        {dropFiles.map((f, i) => {
                          const isPdfFile = isPdf(f);
                          const isImageFile = isImage(f);
                          const accent = isPdfFile ? "border-rose-200 bg-rose-50 text-rose-700" : isImageFile ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-cyan-200 bg-cyan-50 text-cyan-700";
                          return (
                            <span key={`${f.name}-${i}`} className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${accent}`}>
                              <span className="truncate">{f.name}</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeDropFile(i); }}
                                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-slate-200 hover:opacity-100"
                                aria-label={`Remove ${f.name}`}
                                title="Remove file"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <p className="font-semibold text-slate-900">{dropFile.name}</p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeDropFile(0); }}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                          aria-label={`Remove ${dropFile.name}`}
                          title="Remove file"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-500">
                      <span>{(dropFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(1)} MB</span>
                      {dropFiles.length > 1 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {dropFiles.length} files
                        </span>
                      ) : null}
                      {dropFileInfo?.kind === "pdf" && dropFileInfo.pageCount ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {dropFileInfo.pageCount} page{dropFileInfo.pageCount !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                      {dropFileInfo?.kind === "image" && dropFileInfo.width && dropFileInfo.height ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {dropFileInfo.width}&times;{dropFileInfo.height} px
                        </span>
                      ) : null}
                    </div>

                    {/* Real page thumbnails, rendered the moment a PDF lands */}
                    {isPdf(dropFile) && heroThumbs.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto py-1">
                        {heroThumbs.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt={`Page ${i + 1} of ${dropFile.name}`}
                            className="h-28 w-20 shrink-0 rounded-md border border-slate-200 bg-white object-cover shadow-md"
                          />
                        ))}
                      </div>
                    ) : isPdf(dropFile) ? (
                      <p className="text-xs text-slate-400">Rendering page previews…</p>
                    ) : null}

                    <p className="text-sm text-slate-500">Choose a quick action:</p>
                    <div id="drop-suggestions" className="flex flex-wrap justify-center gap-2">
                      {suggestedTools.map((tool) => (
                        <button
                          key={tool.slug}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigateToTool(tool.slug); }}
                          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
                          style={{ background: `var(--tool-${CATEGORY_HUE[tool.category] ?? "organise"}-600)` }}
                        >
                          {tool.name}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openAllToolsDialog(); }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      More tools
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M5 7l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); clearDrop(); }}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                    >
                      Clear all files
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-900">
                    <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-100)] text-[var(--accent-700)]">
                      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <p className="font-display text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                      Drop your file(s) here
                    </p>
                    <p className="text-sm text-slate-500">
                      Or click to browse — PDF, Word, PNG, JPG, WebP accepted
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Intent search (kept inside the band) */}
            <div className="mx-auto mt-5 max-w-3xl">
              <div className="relative">
                <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="9" cy="9" r="4.5" />
                  <path d="M13 13l3 3" strokeLinecap="round" />
                </svg>
                <input
                  id="intent-input"
                  type="text"
                  value={intentQuery}
                  onChange={(event) => setIntentQuery(event.target.value)}
                  placeholder={listening ? "Listening..." : "Or type what you want — e.g. sign my PDF"}
                  aria-label="Search tools by intent"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-20 text-base text-slate-900 shadow-lg outline-none placeholder:text-slate-400"
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-all ${listening ? "bg-red-500 text-white" : "bg-red-100 text-red-500 hover:bg-red-200"}`}
                    aria-label={listening ? "Stop listening" : "Search by voice"}
                    title={listening ? "Stop listening" : "Search by voice"}
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M10 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M18 10a8 8 0 1 1-16 0" strokeLinecap="round" />
                    </svg>
                  </button>
                  {intentQuery ? (
                    <button
                      type="button"
                      onClick={() => setIntentQuery("")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                      aria-label="Clear search"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {intentQuery.trim() && searchResults !== null ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-96 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_-20px_rgba(15,23,42,0.32)]">
                    {searchResults.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                        <p className="text-sm font-medium text-slate-600">No tools match your search</p>
                        <p className="text-xs text-slate-400">Try “merge”, “compress”, or “sign”.</p>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {searchResults.map((result) => (
                          <Link
                            key={result.slug}
                            href={`/tools/${result.slug}`}
                            onClick={() => setIntentQuery("")}
                            className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-[var(--accent-300)] hover:bg-[var(--accent-50)]"
                          >
                            <div className="flex items-center gap-2">
                              <ToolIcon category={result.category} className="h-5 w-5 shrink-0" />
                              <span className="text-sm font-semibold text-slate-800">{result.name}</span>
                              <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getCategoryColor(result.category)}`}>
                                {result.category}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 line-clamp-1">{result.description}</p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ── Tools — five coloured category sections ───────────── */}
        <section id="tools" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:px-10">
          {CATEGORY_GROUPS.map((group) => {
            const tools = ACTIVE_TOOL_ITEMS.filter((t) => group.categories.includes(t.category));
            return (
              <div
                key={group.hue}
                className="mb-6 rounded-3xl p-4 md:p-7"
                style={{ background: `color-mix(in srgb, var(--tool-${group.hue}-600) 10%, var(--background))` }}
              >
                <div className="mb-4">
                  <h2
                    className="font-display text-xl font-bold tracking-tight md:text-2xl"
                    style={{ color: `var(--tool-${group.hue}-600)` }}
                  >
                    {group.label}
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {tools.map((tool) => (
                    <Link
                      key={tool.slug}
                      href={`/tools/${tool.slug}`}
                      className="group flex items-start gap-3 rounded-xl p-4 text-white transition hover:brightness-110"
                      style={{ background: `var(--tool-${group.hue}-600)` }}
                    >
                      <ToolIcon category={tool.category} mono className="mt-0.5 h-6 w-6 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-bold leading-snug">{tool.name}</span>
                        <span className="mt-0.5 text-xs leading-snug text-white/85">{tool.description}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── Research Studio band ──────────────────────────────── */}
        <section className="bg-slate-950 text-white">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 md:px-10 md:py-16">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent-500)]/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-300)]">
                Research Studio
              </p>
              <h2 className="font-display text-2xl font-bold tracking-tight md:text-4xl">
                A real LaTeX editor, with your PDF beside it.
              </h2>
              <p className="mt-4 text-base text-slate-300">
                Write in LaTeX, Python, or C++. Compile and watch the PDF update beside your
                source. Push the whole project to GitHub when it's ready.
              </p>
              <Link
                href="/research-studio"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent-500)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--accent-400)]"
              >
                Open Research Studio
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
              <p className="text-sm font-semibold text-slate-200">What's in it:</p>
              <ul className="mt-3 space-y-2.5 text-sm text-slate-400">
                <li className="flex gap-2"><span className="text-slate-600">—</span> LaTeX, Python and C++ in one editor</li>
                <li className="flex gap-2"><span className="text-slate-600">—</span> The PDF updates as you compile</li>
                <li className="flex gap-2"><span className="text-slate-600">—</span> Push the whole project to GitHub</li>
                <li className="flex gap-2"><span className="text-slate-600">—</span> AI help with writing when you're stuck</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── Workflow Recipes showcase ─────────────────────────── */}
        <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:px-10">
          <div className="mb-5">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
              Workflow Recipes
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Chain tools into one named workflow — start with a file, walk out with the finished result.
            </p>
          </div>
          <input
            ref={workflowFileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(event) => {
              handleWorkflowFileSelect(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_RECIPES.map((recipe, ri) => {
              const hue = ["organise", "convert", "secure", "optimise"][ri % 4];
              return (
                <button
                  key={recipe.slug}
                  type="button"
                  onClick={() => startWorkflow(recipe)}
                  className="group flex flex-col rounded-2xl p-5 text-left text-white transition hover:brightness-110"
                  style={{ background: `var(--tool-${hue}-600)` }}
                >
                  <p className="text-base font-bold">{recipe.name}</p>
                  <p className="mt-1 text-xs leading-snug text-white/85">{recipe.description}</p>
                  <div className="mt-4 flex flex-col gap-2">
                    {recipe.steps.map((step, i) => (
                      <div key={step.toolSlug} className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">
                          {i + 1}
                        </span>
                        <span className="text-xs font-semibold text-white">{step.label}</span>
                      </div>
                    ))}
                  </div>
                  <span className="mt-4 text-xs font-bold uppercase tracking-wide text-white/90 group-hover:underline">
                    Start with a file ›
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Trust ─────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 md:px-10">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-center sm:flex-row sm:text-left">
            <svg viewBox="0 0 20 20" className="h-8 w-8 shrink-0 text-[var(--accent-600)]" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 2l6 2.5v5c0 4-2.6 6.8-6 8.5-3.4-1.7-6-4.5-6-8.5v-5L10 2z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.5 10l1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="max-w-xl text-sm text-slate-600">
              Most tools run entirely in your browser. Files sent to our servers are deleted as soon as
              processing finishes.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
