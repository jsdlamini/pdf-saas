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
import { TOOL_CATEGORIES, TOOL_ITEMS } from "@/lib/tools";
import { WORKFLOW_RECIPES } from "@/lib/workflow-recipes";
import {
  clearWorkflowPipeline,
  stageWorkflowPipeline,
} from "@/lib/workflow-pipeline";

/* ── helpers ────────────────────────────────────────────────────── */

function getWorkflowCreatedAt() {
  return Date.now();
}

function getCategoryColor(category: string) {
  const colors: Record<string, string> = {
    Organize: "from-sky-200 to-cyan-200 text-sky-900 border-sky-300 shadow-sky-200/60",
    Optimize: "from-indigo-200 to-violet-200 text-indigo-900 border-indigo-300 shadow-indigo-200/60",
    Convert: "from-emerald-200 to-teal-200 text-emerald-900 border-emerald-300 shadow-emerald-200/60",
    Security: "from-rose-200 to-orange-200 text-rose-900 border-rose-300 shadow-rose-200/60",
    Edit: "from-amber-200 to-yellow-200 text-amber-900 border-amber-300 shadow-amber-200/60",
    Sign: "from-green-200 to-lime-200 text-green-900 border-green-300 shadow-green-200/60",
  };
  return (
    colors[category] || "from-slate-200 to-slate-100 text-slate-800 border-slate-300 shadow-slate-200/60"
  );
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.endsWith(".pdf");
}

function isImage(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

const TOP_PICK_SLUGS = [
  "merge-pdf",
  "split-pdf",
  "compress-pdf",
  "ocr-pdf",
  "sign-pdf",
  "pdf-to-word",
];

function getDropSuggestions(file: File): string[] {
  if (isPdf(file)) {
    return ["merge-pdf", "compress-pdf", "ocr-pdf"];
  }
  if (isImage(file)) {
    return ["jpg-to-pdf", "images-to-pdf", "ocr-pdf"];
  }
  return ["merge-pdf", "compress-pdf", "sign-pdf"];
}

/* ── component ──────────────────────────────────────────────────── */

export default function Home() {
  const router = useRouter();
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkflowRecipeRef = useRef<
    (typeof WORKFLOW_RECIPES)[number] | null
  >(null);
  const [intentQuery, setIntentQuery] = useState("");
  const [showAllTools, setShowAllTools] = useState(false);
  const [dropToolsOpen, setDropToolsOpen] = useState(false);

  /* ── drop-zone state ──────────────────────────────────────────── */
  const [dragOver, setDragOver] = useState(false);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [dropFileInfo, setDropFileInfo] = useState<{
    kind: "pdf" | "image";
    pageCount?: number;
    width?: number;
    height?: number;
  } | null>(null);
  const dropSuggestions = useMemo(
    () => (dropFile ? getDropSuggestions(dropFile) : []),
    [dropFile],
  );
  const suggestedTools = useMemo(
    () =>
      dropSuggestions
        .map((slug) => TOOL_ITEMS.find((t) => t.slug === slug))
        .filter(Boolean) as typeof TOOL_ITEMS,
    [dropSuggestions],
  );

  useEffect(() => {
    if (!dropFile) return;

    let cancelled = false;

    async function readFileInfo() {
      if (isPdf(dropFile!)) {
        try {
          const { PDFDocument: PDFDoc } = await import("pdf-lib");
          const buffer = await dropFile!.arrayBuffer();
          if (cancelled) return;
          const doc = await PDFDoc.load(buffer, { ignoreEncryption: true });
          if (!cancelled) setDropFileInfo({ kind: "pdf", pageCount: doc.getPageCount() });
        } catch {
          if (!cancelled) setDropFileInfo({ kind: "pdf" });
        }
      } else if (isImage(dropFile!)) {
        try {
          const img = new Image();
          const url = URL.createObjectURL(dropFile!);
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
  }, [dropFile]);

  function clearDrop() {
    setDropFile(null);
    setDropFileInfo(null);
    setDragOver(false);
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
    const f = e.dataTransfer.files?.[0];
    if (f && (isPdf(f) || isImage(f))) {
      setDropFileInfo(null);
      setDropFile(f);
    }
  }

  function handleBrowse(file: File) {
    if (isPdf(file) || isImage(file)) {
      setDropFileInfo(null);
      setDropFile(file);
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
      createdAt: getWorkflowCreatedAt(),
    });
    router.push(`/tools/${slug}?pipeline=true`);
  }

  /* ── search ───────────────────────────────────────────────────── */
  const searchResults = useMemo(() => {
    if (!intentQuery.trim()) return null;
    return rankToolsByIntent(TOOL_ITEMS, intentQuery)
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

  /* ── tool grouping ────────────────────────────────────────────── */
  const topPicks = useMemo(
    () =>
      TOP_PICK_SLUGS.map((slug) => TOOL_ITEMS.find((t) => t.slug === slug)).filter(
        Boolean,
      ) as typeof TOOL_ITEMS,
    [],
  );

  const toolsByCategory = useMemo(() => {
    const map: Record<string, typeof TOOL_ITEMS> = {};
    for (const cat of TOOL_CATEGORIES) {
      map[cat] = TOOL_ITEMS.filter((t) => t.category === cat);
    }
    return map;
  }, []);

  return (
    <div className="ai-home-bg relative isolate flex w-full flex-1 flex-col">
      <div className="pointer-events-none absolute -left-16 top-12 -z-10 h-64 w-64 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 -z-10 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-64 w-64 rounded-full bg-amber-300/20 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6 md:gap-5 md:px-10 md:py-8">
        {/* ── Zone 1: Drop-zone Hero ─────────────────────────────── */}
        <header className="ai-hero-panel rounded-3xl px-6 py-7 md:px-10 md:py-9">
          {/* Drop-zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => {
              const input = document.getElementById(
                "hero-file-input",
              ) as HTMLInputElement | null;
              input?.click();
            }}
            className={`drop-zone-hover-ring relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 md:p-12 ${
              dragOver
                ? "border-cyan-400 bg-gradient-to-br from-cyan-50 to-blue-50 drop-zone-active-glow"
                : "border-slate-200 bg-gradient-to-br from-white to-blue-50/60 hover:border-cyan-400 hover:from-cyan-50/80 hover:to-blue-50/80 hover:shadow-[0_0_36px_-10px_rgba(34,211,238,0.3)]"
            }`}
          >
            <input
              id="hero-file-input"
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBrowse(f);
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
                <p className="font-semibold text-slate-900">{dropFile.name}</p>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span>{(dropFile.size / 1024 / 1024).toFixed(1)} MB</span>
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
                <p className="text-sm text-slate-500">Choose a quick action:</p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropToolsOpen(!dropToolsOpen);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-300 bg-white px-4 py-2.5 text-sm font-semibold text-cyan-800 shadow-sm transition hover:bg-cyan-50"
                  >
                    {suggestedTools[0]?.name ?? "Select tool"}
                    <svg viewBox="0 0 20 20" className={`h-4 w-4 text-cyan-500 transition-transform ${dropToolsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 7l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {dropToolsOpen ? (
                    <>
                      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setDropToolsOpen(false); }} />
                      <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                        {suggestedTools.map((tool) => (
                          <button
                            key={tool.slug}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDropToolsOpen(false);
                              navigateToTool(tool.slug);
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-cyan-50 hover:text-cyan-900"
                          >
                            <span>{tool.name}</span>
                            <span className="ml-auto text-[10px] font-normal text-slate-400">
                              {tool.runtime === "server" ? "Server" : "Browser"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDrop();
                  }}
                  className="text-xs text-slate-400 underline hover:text-slate-600"
                >
                  Choose a different file
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div
                  className={`drop-icon-drag-scale inline-flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300 ${
                    dragOver
                      ? "scale-125 bg-gradient-to-br from-cyan-200 to-blue-200 text-cyan-600 shadow-lg shadow-cyan-200/50"
                      : "drop-icon-bounce bg-gradient-to-br from-cyan-100 to-blue-200 text-cyan-500"
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
                <p className="font-display text-2xl font-semibold tracking-tight bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent md:text-3xl">
                  Drop your file here
                </p>
                <p className="text-sm text-slate-500">
                  Or click to browse — PDF, PNG, JPG, WebP accepted
                </p>
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
                placeholder="Search tools — e.g. remove sensitive text from contracts"
                className="ai-search-input w-full rounded-xl py-3 pl-9 pr-3 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              {intentQuery ? (
                <button
                  type="button"
                  onClick={() => setIntentQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path
                      d="M5 5l10 10M15 5L5 15"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}

              {/* Inline search results: cards */}
              {intentQuery.trim() && searchResults !== null ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-96 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_16px_40px_-20px_rgba(15,23,42,0.32)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/95">
                  {searchResults.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-slate-500">
                      No tools match your search.
                    </p>
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
                          <span
                            className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              result.runtime === "client"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {result.runtime === "client"
                              ? "Works in browser"
                              : "Server processed"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── Zone 2: Workflow Recipes (moved above tools) ────────── */}
        <section className="ai-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-950">
              Workflow Recipes
            </h2>
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">
              Click to start
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_RECIPES.slice(0, 4).map((recipe) => (
              <button
                key={recipe.slug}
                type="button"
                onClick={() => startWorkflow(recipe)}
                className="ai-workflow-card group rounded-xl p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50"
              >
                <p className="text-sm font-semibold text-slate-900 group-hover:text-cyan-900">
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
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 group-hover:bg-cyan-200 group-hover:text-cyan-900">
                        {index + 1}
                      </span>
                      {index < recipe.steps.length - 1 ? (
                        <span className="mx-1 block h-px w-3 bg-slate-300 group-hover:bg-cyan-300" />
                      ) : null}
                    </div>
                  ))}
                </div>
                <span className="mt-2 inline-block text-[10px] font-bold uppercase tracking-wide text-cyan-700 opacity-0 transition-opacity group-hover:opacity-100">
                  Start ›
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Zone 3: Tool Directory (collapsed to top picks) ─────── */}
        <section className="ai-panel rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 pt-4 pb-3">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-950">
              Tools
            </h2>
            <span className="text-xs text-slate-500">
              {TOOL_ITEMS.length} tools
            </span>
          </div>

          {/* Top 6 picks */}
          <div className="px-4 py-5">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {topPicks.map((tool) => (
                <Link
                  key={tool.slug}
                  href={`/tools/${tool.slug}`}
                  title={`${tool.name}: ${tool.description}`}
                  className={`ai-tool-pill group inline-flex items-center justify-center rounded-full border bg-gradient-to-r px-5 py-2.5 text-sm font-semibold transition-all duration-200 hover:scale-105 hover:shadow-lg ${getCategoryColor(tool.category)} cursor-pointer`}
                >
                  <span className="flex items-center gap-1.5">
                    {tool.name}
                    {tool.runtime === "server" ? (
                      <span className="text-[10px] font-bold opacity-75">⚙</span>
                    ) : null}
                  </span>
                </Link>
              ))}
            </div>

            {/* Expandable "All tools" */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setShowAllTools(!showAllTools)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
              >
                {showAllTools ? "Show fewer" : `All ${TOOL_ITEMS.length} tools`}
                <svg
                  viewBox="0 0 20 20"
                  className={`h-4 w-4 transition-transform ${showAllTools ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path
                    d="M5 7l5 5 5-5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {/* Full tool grid (expandable) */}
            {showAllTools ? (
              <div className="mt-5 space-y-4">
                {TOOL_CATEGORIES.map((cat) => {
                  const catTools = toolsByCategory[cat];
                  if (!catTools.length) return null;
                  return (
                    <div key={cat}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        {cat}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {catTools.map((tool) => (
                          <Link
                            key={tool.slug}
                            href={`/tools/${tool.slug}`}
                            className={`ai-tool-pill inline-flex items-center rounded-full border bg-gradient-to-r px-4 py-2 text-sm font-semibold transition-all hover:scale-105 hover:shadow-lg ${getCategoryColor(tool.category)}`}
                          >
                            {tool.name}
                            {tool.runtime === "server" ? (
                              <span className="ml-1 text-[10px] font-bold opacity-75">
                                ⚙
                              </span>
                            ) : null}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
