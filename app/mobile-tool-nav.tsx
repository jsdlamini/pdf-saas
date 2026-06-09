"use client";

import Link from "next/link";
import { useState } from "react";
import { TOOL_CATEGORIES, TOOL_ITEMS } from "@/lib/tools";
import ToolNavSearch from "./tool-nav-search";

const MOBILE_NAV_PARENTS = ["All", ...TOOL_CATEGORIES] as const;

export default function MobileToolNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed left-2 top-2 z-[80] md:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.75)]"
        aria-expanded={open}
        aria-controls="mobile-tool-navbar"
        aria-label={open ? "Close tools menu" : "Open tools menu"}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-50">
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-slate-700" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          id="mobile-tool-navbar"
          className="fixed left-0 top-14 z-[79] w-screen space-y-2 border-y border-slate-200 bg-white p-3 shadow-[0_16px_32px_-22px_rgba(15,23,42,0.55)]"
        >
          <ToolNavSearch className="max-w-none" onNavigate={() => setOpen(false)} />

          {MOBILE_NAV_PARENTS.map((parent) => {
            const subgroupTools =
              parent === "All"
                ? TOOL_ITEMS
                : TOOL_ITEMS.filter((tool) => tool.category === parent);

            return (
              <details key={parent} className="group rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
                  <span className="inline-flex items-center justify-between w-full">
                    <span>{parent}</span>
                    <span className="text-[10px] font-medium text-slate-500">{subgroupTools.length}</span>
                  </span>
                </summary>

                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  {subgroupTools.map((tool) => (
                    <Link
                      key={`mobile-sub-${tool.slug}`}
                      href={`/tools/${tool.slug}`}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
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
      ) : null}
    </div>
  );
}
