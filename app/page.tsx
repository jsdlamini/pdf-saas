"use client";

import Link from "next/link";
import { TOOL_ITEMS } from "@/lib/tools";

export default function Home() {
  return (
    <div className="relative isolate flex flex-1 overflow-hidden bg-[#f4f6f8]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(115deg,#f9fafb_0%,#eef2f6_45%,#f7f7f4_100%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-40 [background-image:linear-gradient(to_right,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="pointer-events-none absolute -left-24 top-12 -z-10 h-72 w-72 rounded-full bg-cyan-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-12 -z-10 h-72 w-72 rounded-full bg-amber-200/50 blur-3xl" />

      <main className="depth-stage mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
        <header className="glass-3d space-y-6 rounded-[2rem] p-5 backdrop-blur md:p-8">
          <div className="flex items-center justify-between">
            <span className="font-display text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              PaperTrail
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-50">
              Studio Edition
            </span>
          </div>

          <div className="grid gap-6 md:grid-cols-[1fr_320px] md:items-start">
            <div className="space-y-3">
              <p className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
                Professional PDF Operating Layer
              </p>
              <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight text-slate-950 md:text-6xl">
                A command center for serious document work.
              </h1>
              <p className="type-body max-w-3xl text-lg text-slate-700">
                Purpose-built for teams that need reliability, speed, and precision.
                Merge, transform, protect, and ship PDFs through one premium workspace.
              </p>
            </div>

            <aside className="card-3d-ink rounded-2xl p-4 text-slate-100">
              <p className="type-eyebrow text-cyan-200">
                Workflow Snapshot
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-2xl font-semibold">29</p>
                  <p className="text-xs text-slate-300">Tool actions</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-2xl font-semibold">100%</p>
                  <p className="text-xs text-slate-300">Frontend ready</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-300">
                Crafted for legal, finance, and operations teams handling high-volume files.
              </p>
            </aside>
          </div>

        </header>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
              Tool Directory
            </h2>
            <p className="text-sm font-medium text-slate-600">
              {TOOL_ITEMS.length} / {TOOL_ITEMS.length} visible
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_ITEMS.map((tool) => (
              <article
                key={tool.slug}
                className="card-3d group relative overflow-hidden rounded-2xl p-5"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-500 via-slate-900 to-amber-500 opacity-80" />
                <div className="mb-3 flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {tool.category}
                  </p>
                  <span
                    className={`status-chip ${
                      tool.runtime === "client"
                        ? "status-chip-live"
                        : "status-chip-server"
                    }`}
                  >
                    {tool.runtime === "client" ? "Live" : "Server"}
                  </span>
                </div>

                <h3 className="font-display text-2xl font-semibold text-slate-950">
                  {tool.name}
                </h3>
                <p className="mt-2 text-sm text-slate-700">{tool.description}</p>

                <Link
                  href={`/tools/${tool.slug}`}
                  className="mt-4 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
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
