"use client";

import Link from "next/link";
import { TOOL_ITEMS } from "@/lib/tools";

export default function Home() {
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
        </header>

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
              <article
                key={tool.slug}
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

                <Link
                  href={`/tools/${tool.slug}`}
                  className="mt-5 inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-100"
                >
                  Open tool
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
