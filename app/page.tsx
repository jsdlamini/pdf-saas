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
  // Low-saturation tint behind a saturated glyph (token-driven, not ad-hoc).
  const map: Record<string, string> = {
    Organize: "bg-[var(--tool-organise-tint)] text-[var(--tool-organise)] border-[var(--tool-organise)]",
    Optimize: "bg-[var(--tool-optimise-tint)] text-[var(--tool-optimise)] border-[var(--tool-optimise)]",
    Convert: "bg-[var(--tool-convert-tint)] text-[var(--tool-convert)] border-[var(--tool-convert)]",
    Security: "bg-[var(--tool-secure-tint)] text-[var(--tool-secure)] border-[var(--tool-secure)]",
    Edit: "bg-[var(--tool-edit-tint)] text-[var(--tool-edit)] border-[var(--tool-edit)]",
    Sign: "bg-[var(--tool-secure-tint)] text-[var(--tool-secure)] border-[var(--tool-secure)]",
  };
  return map[category] ?? "bg-slate-100 text-slate-800 border-slate-300";
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
  const otherCompatibleTools = useMemo(() => {
    if (!dropFile) return [];
    const slugs = new Set(dropSuggestions);
    const isPdfFile = isPdf(dropFile);
    return ACTIVE_TOOL_ITEMS.filter((t) => {
      if (slugs.has(t.slug)) return false;
      if (t.slug === "ocr-pdf") return true; // OCR works with both
      if (isPdfFile) return t.slug.includes("pdf") || t.slug === "merge-pdf" || t.slug === "split-pdf" || t.slug === "compress-pdf" || t.slug === "sign-pdf" || t.slug === "protect-pdf" || t.slug === "unlock-pdf" || t.slug === "redact-pdf" || t.slug === "edit-pdf" || t.slug === "crop-pdf" || t.slug === "rotate-pdf" || t.slug === "organize-pdf" || t.slug === "remove-pages" || t.slug === "extract-pages" || t.slug === "repair-pdf" || t.slug === "page-numbers" || t.slug === "compare-pdf" || t.slug === "pdf-to-pdfa" || t.slug === "pdf-to-latex";
      return t.slug === "convert-to-pdf" || t.slug === "ocr-pdf" || t.slug === "scan-to-pdf";
    }).slice(0, 10);
  }, [dropFile, dropSuggestions]);

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

  function clearDrop() {
    setDropFiles([]);
    setDropFileInfo(null);
    setDragOver(false);
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
    const tools = otherCompatibleTools.length ? otherCompatibleTools : ACTIVE_TOOL_ITEMS;
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
    <div className="ai-home-bg relative isolate flex w-full flex-1 flex-col">
      <div className="pointer-events-none absolute -left-16 top-12 -z-10 h-64 w-64 rounded-full bg-[#1e40af]/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 -z-10 h-72 w-72 rounded-full bg-[#1e40af]/8 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-64 w-64 rounded-full bg-slate-300/25 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6 md:gap-5 md:px-10 md:py-8">
        {/* ── Server status banner ──────────────────────────────── */}
        {serverOnline === false ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm text-orange-800">
            <span className="font-semibold">⚡ Server tools (OCR, PDF-to-Word) are currently unavailable.</span>{" "}
            Browser tools still work. Retrying every 30 seconds…
          </div>
        ) : null}

        {/* ── Zone 1: Drop-zone Hero ─────────────────────────────── */}
        <header className="ai-hero-panel rounded-3xl px-6 py-7 md:px-10 md:py-9">
          {/* Drop-zone */}
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
                const input = document.getElementById(
                  "hero-file-input",
                ) as HTMLInputElement | null;
                input?.click();
              }
            }}
            onClick={() => {
              const input = document.getElementById(
                "hero-file-input",
              ) as HTMLInputElement | null;
              input?.click();
            }}
            className={`drop-zone-hover-ring relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 md:p-12 focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
              dragOver
                ? "border-[#1e40af] bg-gradient-to-br from-[#1e40af]/5 to-slate-50 drop-zone-active-glow"
                : "border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:border-[#1e40af]/60 hover:from-[#1e40af]/5 hover:shadow-[0_0_36px_-10px_rgba(30,64,175,0.25)]"
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
              <div className="flex flex-col items-center gap-3">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-7 w-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                {dropFiles.length > 1 ? (
                  <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
                    {dropFiles.map((f, i) => {
                      const isPdfFile = isPdf(f);
                      const isImageFile = isImage(f);
                      const accent = isPdfFile ? "border-rose-200 bg-rose-50 text-rose-700" : isImageFile ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-cyan-200 bg-cyan-50 text-cyan-700";
                      return (
                        <span key={`${f.name}-${i}`} className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${accent}`}>
                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M6 3h6l4 4v10H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
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
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-500 drop-zone-hint">
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
                <p className="text-sm text-slate-500 drop-zone-hint">Choose a quick action:</p>
                <div id="drop-suggestions" className="flex flex-wrap justify-center gap-2">
                  {suggestedTools.map((tool) => (
                    <button
                      key={tool.slug}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToTool(tool.slug);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:shadow-lg ${getCategoryColor(tool.category)}`}
                    >
                      {tool.name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openAllToolsDialog(); }}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-gradient-to-r px-4 py-2 text-sm font-semibold transition-all hover:scale-105 hover:shadow-lg from-slate-100 to-slate-200 text-slate-700 hover:from-[#1e40af]/10 hover:to-[#1e40af]/5 hover:text-[#1e40af]"
                >
                  More tools
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 7l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDrop();
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                >
                  Clear all files
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div
                  className={`drop-icon-drag-scale inline-flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300 ${
                    dragOver
                      ? "scale-125 bg-gradient-to-br from-slate-200 to-slate-300 text-slate-700 shadow-lg shadow-slate-300/50"
                      : "drop-icon-bounce bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path
                      d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="font-display text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
                  Drop your file(s) here
                </p>
                <p className="text-sm text-slate-500 drop-zone-subtitle">
                  Or click to browse — PDF, Word, PNG, JPG, WebP accepted
                </p>
                {dropFiles.length > 1 ? (
                  <p className="text-xs font-semibold text-cyan-700">{dropFiles.length} files selected</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Search bar below drop-zone */}
          <div className="mt-5 flex items-center gap-2">
            <div className="relative flex-1">
              <svg
                viewBox="0 0 20 20"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="9" cy="9" r="4.5" />
                <path d="M13 13l3 3" strokeLinecap="round" />
              </svg>
              <input
                id="intent-input"
                type="text"
                value={intentQuery}
                onChange={(event) => setIntentQuery(event.target.value)}
                placeholder={listening ? "Listening..." : "Alternatively, type or say what you want — e.g. sign my PDF"}
                aria-label="Search tools by intent"
                className="ai-search-input w-full rounded-xl py-3 pl-9 pr-20 text-base"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                    listening
                      ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-300/50"
                      : "bg-red-100 text-red-500 hover:bg-red-200 hover:text-red-700"
                  }`}
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

              {/* Inline search results: cards */}
              {intentQuery.trim() && searchResults !== null ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-96 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_16px_40px_-20px_rgba(15,23,42,0.32)] -md dark:border-slate-700/80 dark:bg-slate-950/95">
                  {searchResults.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M21 21l-4.5-4.5M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <p className="text-sm font-medium text-slate-600">No tools match your search</p>
                      <p className="text-xs text-slate-400">Try a different keyword, like “merge”, “compress”, or “sign”.</p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {searchResults.map((result) => (
                        <Link
                          key={result.slug}
                          href={`/tools/${result.slug}`}
                          onClick={() => setIntentQuery("")}
                          className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-cyan-300 hover:bg-cyan-50"
                        >
                          <div className="flex items-center gap-2">
                            <ToolIcon category={result.category} className="h-5 w-5 shrink-0 text-slate-400" />
                            <span className="text-sm font-semibold text-slate-800">
                              {result.name}
                            </span>
                            <span
                              className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getCategoryColor(result.category)}`}
                            >
                              {result.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-1">
                            {result.description}
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── Animated tool carousel ─────────────────────────────── */}
        <div className="overflow-hidden py-4">
          <div className="animate-tool-scroll flex gap-3 whitespace-nowrap">
            {(() => {
              const TOP_TOOLS = new Set([
                "merge-pdf", "split-pdf", "compress-pdf", "ocr-pdf",
                "sign-pdf", "pdf-to-word", "convert-to-pdf", "protect-pdf",
              ]);
              const topDuplicates = ACTIVE_TOOL_ITEMS.filter((t) => TOP_TOOLS.has(t.slug));
              const weighted = [...ACTIVE_TOOL_ITEMS, ...topDuplicates];
              return [...weighted, ...weighted];
            })().map((tool, i) => (
              <Link
                key={`${tool.slug}-${i}`}
                href={`/tools/${tool.slug}`}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:shadow-lg ${getCategoryColor(tool.category)}`}
              >
                <ToolIcon category={tool.category} className="h-4 w-4" />
                {tool.name}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Trust badge ──────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="trust-badge inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
            <svg viewBox="0 0 20 20" className="trust-badge-icon h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 2l6 2.5v5c0 4-2.6 6.8-6 8.5-3.4-1.7-6-4.5-6-8.5v-5L10 2z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.5 10l1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs font-medium">
              Most tools run entirely in your browser. Files sent to our servers are deleted as soon as processing finishes.
            </span>
          </div>
        </div>

        {/* ── Zone 2: Workflow Recipes (moved above tools) ────────── */}
        <section className="ai-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-950">
              Workflow Recipes
            </h2>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_RECIPES.slice(0, 4).map((recipe) => (
              <button
                key={recipe.slug}
                type="button"
                onClick={() => startWorkflow(recipe)}
                className="ai-workflow-card group rounded-xl p-4 text-left transition"
              >
                <p className="text-sm font-semibold text-slate-900 group-hover:text-slate-900">
                  {recipe.name}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {recipe.description}
                </p>
                <div className="mt-3 flex items-center gap-0">
                  {recipe.steps.map((step, index) => (
                    <div
                      key={`${recipe.slug}-${step.toolSlug}`}
                      className="flex items-center"
                    >
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 group-hover:bg-slate-300 group-hover:text-slate-900">
                        {index + 1}
                      </span>
                      {index < recipe.steps.length - 1 ? (
                        <span className="mx-1 block h-px w-3 bg-slate-300 group-hover:bg-slate-400" />
                      ) : null}
                    </div>
                  ))}
                </div>
                <span className="mt-2 inline-block text-[10px] font-bold uppercase tracking-wide text-slate-600 opacity-0 transition-opacity group-hover:opacity-100">
                  Start ›
                </span>
              </button>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
