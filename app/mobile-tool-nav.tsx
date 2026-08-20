"use client";

import Link from "next/link";
import { useState } from "react";
import { ACTIVE_TOOL_ITEMS, TOOL_CATEGORIES } from "@/lib/tools";
import ToolNavSearch from "./tool-nav-search";

const MOBILE_NAV_PARENTS = ["All", ...TOOL_CATEGORIES] as const;

export default function MobileToolNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed left-0 top-0 z-[80] md:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-14 w-12 items-center justify-center border-r border-slate-200/60 bg-transparent text-slate-700 transition active:scale-95 dark:border-slate-700/60"
        aria-expanded={open}
        aria-controls="mobile-tool-navbar"
        aria-label={open ? "Close tools menu" : "Open tools menu"}
      >
        {open ? (
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-slate-700" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open ? (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 top-14 z-[78] bg-slate-900/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            id="mobile-tool-navbar"
            className="fixed left-0 top-14 z-[79] flex max-h-[calc(100dvh-3.5rem)] w-screen flex-col overflow-hidden border-t border-slate-200/80 bg-white/95 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:bg-slate-950/95 dark:border-slate-700/80"
          >
            <div className="overflow-y-auto overscroll-contain p-3 pb-safe space-y-2">
              <ToolNavSearch className="max-w-none" onNavigate={() => setOpen(false)} />

              {MOBILE_NAV_PARENTS.map((parent) => {
                const subgroupTools =
                  parent === "All"
                    ? ACTIVE_TOOL_ITEMS
                    : ACTIVE_TOOL_ITEMS.filter((tool) => tool.category === parent);

                return (
                  <details key={parent} className="group rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700/80 dark:bg-slate-900/80">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-300">
                      <span>{parent}</span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                          {subgroupTools.length}
                        </span>
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </summary>

                    <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                      {subgroupTools.map((tool) => (
                        <Link
                          key={`mobile-sub-${tool.slug}`}
                          href={`/tools/${tool.slug}`}
                          className="rounded-xl border border-slate-200/80 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition active:scale-95 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300"
                          onClick={() => setOpen(false)}
                        >
                          {tool.name}
                        </Link>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
