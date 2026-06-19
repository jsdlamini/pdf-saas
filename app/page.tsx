"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import ProjectSessionCta from "./project-session-cta";
import { rankToolsByIntent } from "@/lib/tool-intent-search";
import { TOOL_ITEMS } from "@/lib/tools";
import { WORKFLOW_RECIPES } from "@/lib/workflow-recipes";
import { clearWorkflowPipeline, stageWorkflowPipeline } from "@/lib/workflow-pipeline";

function getWorkflowCreatedAt() {
  return Date.now();
}

const HERO_QUICK_ACTIONS = [
  {
    label: "Merge PDF",
    href: "/tools/merge-pdf",
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h5l7 4-7 4H4l7-4-7-4z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "OCR PDF",
    href: "/tools/ocr-pdf",
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="5" width="14" height="10" rx="1.5" />
        <path d="M7 9h6M7 12h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: "Sign PDF",
    href: "/tools/sign-pdf",
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 14.5V16h1.5L15 6.5 13.5 5 4 14.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "Research Studio",
    href: "/research-studio",
    badge: "New",
    icon: (
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 3h6l3 3v11H6V3z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3v3h3M8 11h4M8 14h2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

const DASHBOARD_METRICS = [
  { label: "Tools Available", value: `${TOOL_ITEMS.length}`, trend: "Updated daily" },
  { label: "Workflow Recipes", value: `${WORKFLOW_RECIPES.length}`, trend: "Ready to launch" },
  { label: "AI Search", value: "Instant", trend: "Intent ranked" },
] as const;

function getCategoryColor(category: string) {
  const colors: Record<string, string> = {
    Organize: "from-sky-100 to-cyan-100 text-sky-800 border-sky-200",
    Optimize: "from-indigo-100 to-fuchsia-100 text-indigo-800 border-indigo-200",
    Convert: "from-emerald-100 to-teal-100 text-emerald-800 border-emerald-200",
    Security: "from-rose-100 to-orange-100 text-rose-800 border-rose-200",
    Edit: "from-amber-100 to-yellow-100 text-amber-800 border-amber-200",
    Sign: "from-green-100 to-lime-100 text-green-800 border-green-200",
  };
  return colors[category] || "from-slate-100 to-slate-50 text-slate-700 border-slate-200";
}

export default function Home() {
  const router = useRouter();
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkflowRecipeRef = useRef<(typeof WORKFLOW_RECIPES)[number] | null>(null);
  const [intentQuery, setIntentQuery] = useState("");

  const searchResults = useMemo(() => {
    if (!intentQuery.trim()) return null;
    return rankToolsByIntent(TOOL_ITEMS, intentQuery)
      .filter((entry) => entry.score > 0)
      .slice(0, 12)
      .map((entry) => entry.tool);
  }, [intentQuery]);

  function startWorkflow(recipe: (typeof WORKFLOW_RECIPES)[number]) {
    pendingWorkflowRecipeRef.current = recipe;
    workflowFileInputRef.current?.click();
  }

  function handleWorkflowFileSelect(file: File | null) {
    const recipe = pendingWorkflowRecipeRef.current;
    pendingWorkflowRecipeRef.current = null;
    if (!recipe || !file) return;
    const firstStep = recipe.steps[0];
    // Clear stale pipeline payloads from any previous run of this recipe so
    // continuing from a mid-workflow step is never possible after a fresh start.
    recipe.steps.slice(1).forEach((step) => clearWorkflowPipeline(step.toolSlug));
    stageWorkflowPipeline({
      fromToolSlug: "workflow-home",
      toToolSlug: firstStep.toolSlug,
      recipeSlug: recipe.slug,
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      blob: file,
      createdAt: getWorkflowCreatedAt(),
    });
    router.push(`/tools/${firstStep.toolSlug}?recipe=${encodeURIComponent(recipe.slug)}`);
  }

  return (
    <div className="ai-home-bg relative isolate flex w-full flex-1 flex-col">
      <div className="pointer-events-none absolute -left-16 top-12 -z-10 h-64 w-64 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 -z-10 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-64 w-64 rounded-full bg-amber-300/20 blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6 md:gap-5 md:px-10 md:py-8">

        {/* ── Zone 1: Hero ─────────────────────────────────────────── */}
        <header className="ai-hero-panel rounded-3xl px-6 py-7 md:px-10 md:py-9">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            WiserFiles Workspace
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight text-slate-950 lg:text-5xl">
            Professional PDF tools,<br className="hidden sm:block" /> one focused workspace.
          </h1>
          <p className="mt-2 max-w-2xl text-base text-slate-600">
            Organize, convert, secure, and sign documents — or open the Research Studio for LaTeX editing.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {DASHBOARD_METRICS.map((metric) => (
              <div
                key={metric.label}
                className="invoice-kpi-card rounded-2xl px-4 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold leading-none text-slate-950">{metric.value}</p>
                <p className="mt-1 text-xs text-cyan-700">{metric.trend}</p>
              </div>
            ))}
          </div>

          {/* Quick-action chips */}
          <div className="mt-5 flex flex-wrap gap-2">
            {HERO_QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="ai-pill group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-800"
              >
                <span className="text-slate-500 transition group-hover:text-cyan-700">{action.icon}</span>
                {action.label}
                {"badge" in action && action.badge ? (
                  <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-800">
                    {action.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>

          {/* Search bar */}
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
                className="ai-search-input w-full rounded-xl py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              {intentQuery ? (
                <button
                  type="button"
                  onClick={() => setIntentQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null}

              {/* Inline search results — appear immediately below the input */}
              {intentQuery.trim() && searchResults !== null ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_16px_40px_-20px_rgba(15,23,42,0.32)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/95">
                  {searchResults.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-slate-500">No tools match your search.</p>
                  ) : (
                    <>
                      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {searchResults.map((result) => (
                          <Link
                            key={result.slug}
                            href={`/tools/${result.slug}`}
                            onClick={() => setIntentQuery("")}
                            className={`inline-flex items-center gap-1.5 rounded-full border bg-gradient-to-r px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 hover:shadow-md ${getCategoryColor(result.category)}`}
                          >
                            {result.name}
                            {result.runtime === "server" ? (
                              <span className="text-[10px] font-bold opacity-60">⚙</span>
                            ) : null}
                          </Link>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── Zone 2: Tool Directory ────────────────────────────────── */}
        <section className="ai-panel rounded-2xl">
          {/* Header row: title + count */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 pt-4 pb-3">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-950">
              Tools
            </h2>
            <span className="text-xs text-slate-500">
              {TOOL_ITEMS.length} tool{TOOL_ITEMS.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Tool balls clusters by category */}
          <div className="px-4 py-6">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {TOOL_ITEMS.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    title={`${tool.name}: ${tool.description}`}
                    className={`ai-tool-pill group inline-flex items-center justify-center rounded-full border bg-gradient-to-r px-4 py-2 text-sm font-semibold transition-all duration-200 hover:scale-105 hover:shadow-lg ${getCategoryColor(tool.category)} cursor-pointer`}
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
          </div>

          {/* Research Studio CTA at foot of tools section */}
          <div className="border-t border-slate-100 px-4 py-3">
            <ProjectSessionCta compact />
          </div>
        </section>

        {/* ── Zone 3: Workflow Recipes ──────────────────────────────── */}
        <section className="ai-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-950">Workflow Recipes</h2>
            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Click to start</p>
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
          <div className="grid gap-2 md:grid-cols-2">
            {WORKFLOW_RECIPES.slice(0, 4).map((recipe) => (
              <button
                key={recipe.slug}
                type="button"
                onClick={() => startWorkflow(recipe)}
                className="ai-workflow-card group rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 group-hover:text-cyan-900">{recipe.name}</p>
                  <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide text-cyan-700 opacity-0 transition-opacity group-hover:opacity-100">
                    Start ›
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{recipe.description}</p>
                <div className="mt-2 flex items-center gap-0">
                  {recipe.steps.map((step, index) => (
                    <div key={`${recipe.slug}-${step.toolSlug}`} className="flex items-center">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 group-hover:bg-cyan-200 group-hover:text-cyan-900">
                        {index + 1}
                      </span>
                      {index < recipe.steps.length - 1 ? (
                        <span className="mx-1 block h-px w-4 bg-slate-300 group-hover:bg-cyan-300" />
                      ) : null}
                    </div>
                  ))}
                  <span className="ml-2 text-[11px] text-slate-500 group-hover:text-cyan-700">
                    {recipe.steps[0].label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
