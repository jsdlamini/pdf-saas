import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { TOOL_CATEGORIES, TOOL_ITEMS } from "@/lib/tools";
import MobileToolNav from "./mobile-tool-nav";
import ToolNavSearch from "./tool-nav-search";
import ThemeToggle from "./theme-toggle";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const NAV_PARENTS = ["All", ...TOOL_CATEGORIES] as const;
const QUICK_ACTION_SLUGS = [
  "merge-pdf",
  "split-pdf",
  "compress-pdf",
  "pdf-to-word",
  "word-to-pdf",
  "jpg-to-pdf",
  "protect-pdf",
  "sign-pdf",
] as const;

export const metadata: Metadata = {
  title: "PaperTrail | PDF SaaS",
  description:
    "Upload, annotate, and automate your PDF workflows in one modern SaaS workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const quickActions = QUICK_ACTION_SLUGS.map((slug) => TOOL_ITEMS.find((tool) => tool.slug === slug)).filter(
    (tool) => tool !== undefined
  );

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f4f6f8] text-slate-900 depth-stage">
        <MobileToolNav />

        <header className="glass-3d sticky top-0 z-50 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between py-4 pl-16 pr-6 md:px-10">
            <Link href="/" className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
                PT
              </span>
              <span className="font-display text-xl font-semibold tracking-tight text-slate-950">
                PaperTrail
              </span>
            </Link>

            <div className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 md:flex">
              <span>Hover a category</span>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link
                href="/tools/sign-pdf"
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Open Workspace
              </Link>
            </div>
          </div>

          <div className="hidden border-t border-slate-200/80 px-6 py-2 md:block md:px-10">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
              <nav className="flex items-center gap-2">
                {NAV_PARENTS.map((parent) => {
                  const subgroupTools =
                    parent === "All"
                      ? TOOL_ITEMS
                      : TOOL_ITEMS.filter((tool) => tool.category === parent);

                  return (
                    <div key={parent} className="group relative">
                      <button
                        type="button"
                        className="nav-link border border-transparent bg-transparent text-[11px] uppercase tracking-[0.12em] hover:border-slate-300 hover:bg-slate-100"
                      >
                        {parent}
                      </button>

                      <div className="pointer-events-none invisible absolute left-0 top-[calc(100%+8px)] z-50 w-[min(82vw,700px)] rounded-2xl border border-slate-200 bg-white/95 p-3 opacity-0 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.65)] backdrop-blur transition duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {parent === "All" ? "All tool subgroups" : `${parent} subgroups`}
                          </p>
                          <span className="text-xs text-slate-500">{subgroupTools.length} tools</span>
                        </div>

                        <div className="grid max-h-[320px] grid-cols-2 gap-2 overflow-auto lg:grid-cols-3">
                          {subgroupTools.map((tool) => (
                            <Link
                              key={`top-sub-${tool.slug}`}
                              href={`/tools/${tool.slug}`}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
                            >
                              {tool.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </nav>

              <ToolNavSearch />
            </div>
          </div>
        </header>

        <section className="mx-auto mt-3 w-full max-w-7xl px-6 md:px-10">
          <div className="glass-3d rounded-2xl border border-slate-200/90 p-3 mb-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold tracking-tight text-slate-900">Quick Actions</h2>
              {/* <span className="type-eyebrow text-slate-500">Most used</span> */}
            </div>

            <div className="flex flex-wrap gap-2 ">
              {quickActions.map((tool) => (
                <Link
                  key={`top-quick-${tool.slug}`}
                  href={`/tools/${tool.slug}`}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
                >
                  {tool.name}
                </Link>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-1 flex-col">{children}</div>

        <footer className="glass-3d mt-8">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-10 md:grid-cols-3 md:px-10">
            <div className="space-y-3">
              <p className="font-display text-2xl font-semibold tracking-tight text-slate-950">
                PaperTrail
              </p>
              <p className="max-w-sm text-sm text-slate-600">
                Professional PDF operations suite for conversion, editing, security,
                and team-ready document workflows.
              </p>
            </div>

            <div>
              <p className="type-eyebrow text-slate-500">
                Core Tools
              </p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                <Link href="/tools/merge-pdf" className="footer-link">Merge PDF</Link>
                <Link href="/tools/split-pdf" className="footer-link">Split PDF</Link>
                <Link href="/tools/compress-pdf" className="footer-link">Compress PDF</Link>
                <Link href="/tools/pdf-to-word" className="footer-link">PDF to Word</Link>
              </div>
            </div>

            <div>
              <p className="type-eyebrow text-slate-500">
                Trust and Access
              </p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                <Link href="/tools/protect-pdf" className="footer-link">Protect PDF</Link>
                <Link href="/tools/unlock-pdf" className="footer-link">Unlock PDF</Link>
                <Link href="/tools/sign-pdf" className="footer-link">Sign PDF</Link>
                <Link href="/tools/compare-pdf" className="footer-link">Compare PDF</Link>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
