"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import ProjectSessionCta from "./project-session-cta";
import { rankToolsByIntent } from "@/lib/tool-intent-search";
import { TOOL_ITEMS } from "@/lib/tools";
import { WORKFLOW_RECIPES } from "@/lib/workflow-recipes";
import { stageWorkflowPipeline } from "@/lib/workflow-pipeline";

type RecentWorkflow = {
  slug: string;
  name: string;
  at: string;
};

const EMPTY_RECENT_WORKFLOWS: RecentWorkflow[] = [];
const RECENT_WORKFLOWS_CHANGED_EVENT = "papertrail-recent-workflows-change";
let recentWorkflowsCache = EMPTY_RECENT_WORKFLOWS;
let recentWorkflowsCacheLoaded = false;

function readRecentWorkflowsSnapshot() {
  if (typeof window === "undefined") return EMPTY_RECENT_WORKFLOWS;
  if (!recentWorkflowsCacheLoaded) {
    try {
      const value = JSON.parse(localStorage.getItem("papertrail-recent-workflows") || "[]") as RecentWorkflow[];
      recentWorkflowsCache = value.slice(0, 4);
    } catch {
      recentWorkflowsCache = EMPTY_RECENT_WORKFLOWS;
    }
    recentWorkflowsCacheLoaded = true;
  }

  return recentWorkflowsCache;
}

function subscribeToRecentWorkflowsChange(onStoreChange: () => void) {
  const handleChange = () => {
    recentWorkflowsCacheLoaded = false;
    onStoreChange();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(RECENT_WORKFLOWS_CHANGED_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(RECENT_WORKFLOWS_CHANGED_EVENT, handleChange);
  };
}

function getWorkflowCreatedAt() {
  return Date.now();
}

export default function Home() {
  const router = useRouter();
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingWorkflowRecipeRef = useRef<(typeof WORKFLOW_RECIPES)[number] | null>(null);
  const [intentQuery, setIntentQuery] = useState("");
  const recent = useSyncExternalStore(subscribeToRecentWorkflowsChange, readRecentWorkflowsSnapshot, () => EMPTY_RECENT_WORKFLOWS);

  const intentMatches = useMemo(() => {
    return rankToolsByIntent(TOOL_ITEMS, intentQuery)
      .filter((entry) => entry.score > 0)
      .slice(0, 4);
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
    <div className="relative isolate flex flex-1 overflow-hidden bg-[#f4f6f8]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,#f8fafc_0%,#f1f5f9_58%,#f8fafc_100%)]" />

      <main className="depth-stage mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-10 md:gap-7 md:px-10 md:py-12">
        <header className="space-y-3 rounded-3xl border border-slate-200 bg-white/85 p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            PaperTrail Workspace
          </p>
          <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-slate-950 md:text-4xl lg:text-5xl">
            Professional PDF tools in one focused workspace.
          </h1>
          <p className="type-body max-w-3xl text-base text-slate-700 md:text-lg">
            Organize, convert, secure, and sign documents with a cleaner workflow built for teams.
          </p>

          <div className="mt-4 space-y-3 rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-900">Adaptive onboarding</p>
            <label htmlFor="intent-input" className="text-sm font-medium text-cyan-900">
              Tell PaperTrail what you want to do
            </label>
            <input
              id="intent-input"
              type="text"
              value={intentQuery}
              onChange={(event) => setIntentQuery(event.target.value)}
              placeholder="Example: remove sensitive text from scanned contracts"
              className="w-full rounded-xl border border-cyan-300 bg-white px-3 py-2 text-sm text-slate-800"
            />

            {intentQuery.trim() && intentMatches.length ? (
              <div className="flex flex-wrap gap-2">
                {intentMatches.map(({ tool, score }) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    className="rounded-full border border-cyan-300 bg-white px-3 py-1 text-xs font-semibold text-cyan-900 transition hover:bg-cyan-100"
                  >
                    {tool.name} ({score})
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </header>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/90 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-950">Workflow Recipes</h2>
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
          <div className="grid gap-3 md:grid-cols-2">
            {WORKFLOW_RECIPES.slice(0, 4).map((recipe) => (
              <button
                key={recipe.slug}
                type="button"
                onClick={() => startWorkflow(recipe)}
                className="group rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-50 hover:shadow-[0_8px_24px_-12px_rgba(6,182,212,0.35)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 group-hover:text-cyan-900">{recipe.name}</p>
                  <span className="mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide text-cyan-700 opacity-0 transition-opacity group-hover:opacity-100">
                    Start ›
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{recipe.description}</p>
                <div className="mt-3 flex items-center gap-0">
                  {recipe.steps.map((step, index) => (
                    <div key={`${recipe.slug}-${step.toolSlug}`} className="flex items-center">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 group-hover:bg-cyan-200 group-hover:text-cyan-900">
                        {index + 1}
                      </span>
                      {index < recipe.steps.length - 1 ? (
                        <span className="mx-1 block h-px w-5 bg-slate-300 group-hover:bg-cyan-300" />
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

        {recent.length ? (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/90 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-950">Recent Workflows</h2>
              <p className="text-xs uppercase tracking-[0.12em] text-slate-500">One-click repeat</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map((item) => (
                <Link
                  key={`${item.slug}-${item.at}`}
                  href={`/tools/${item.slug}`}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/90 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-950">
              Scientific Research Editing
            </h2>
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-800">
              New
            </span>
          </div>

          <p className="max-w-3xl text-sm text-slate-700">
            Work in an Overleaf-style research layout with file tree, editor, and preview. Import PDFs into LaTeX source and continue writing in one focused workspace.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href="/research-studio"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
            >
              Open Research Studio
            </Link>
            <Link
              href="/tools/pdf-to-latex"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
            >
              Convert PDF to LaTeX
            </Link>
          </div>

          <ProjectSessionCta compact />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
              Tool Directory
            </h2>
            <p className="text-sm font-medium text-slate-600">
              {TOOL_ITEMS.length} / {TOOL_ITEMS.length} visible
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_ITEMS.map((tool) => (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                aria-label={`Open ${tool.name}`}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-24px_rgba(15,23,42,0.5)]"
              >
                <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-slate-300 via-cyan-300 to-slate-300 opacity-70" />
                <div className="mb-3 flex items-start gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {tool.category}
                  </p>
                </div>

                <h3 className="font-display text-2xl font-semibold text-slate-950">
                  {tool.name}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{tool.description}</p>

                <span
                  className="mt-5 inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 transition group-hover:border-slate-400 group-hover:bg-slate-100"
                  aria-hidden
                >
                  Open tool
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
