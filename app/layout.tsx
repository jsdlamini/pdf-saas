import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { TOOL_CATEGORIES, TOOL_ITEMS } from "@/lib/tools";
import AccountControls from "./account-controls";
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

const SITE_NAME = "PaperTrail";
const DEFAULT_SITE_URL = "http://localhost:3000";

function getSiteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  try {
    return new URL(raw);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "PaperTrail | Online PDF Tools for Merge, OCR, Convert, Compress, and Sign",
    template: "%s | PaperTrail",
  },
  description:
    "Use fast online PDF tools to merge, split, compress, convert, OCR, secure, edit, and sign documents in one workspace.",
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "PDF tools",
    "merge PDF",
    "split PDF",
    "compress PDF",
    "OCR PDF",
    "PDF converter",
    "sign PDF",
    "online PDF editor",
    "PaperTrail",
  ],
  category: "technology",
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "PaperTrail | Online PDF Tools",
    description:
      "Online PDF tools for merge, convert, OCR, compress, security, editing, and signing workflows.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "PaperTrail PDF tools",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PaperTrail | Online PDF Tools",
    description:
      "Merge, split, compress, convert, OCR, secure, edit, and sign PDFs online.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { userId } = await auth();

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f4f6f8] text-slate-900 depth-stage">
        <ClerkProvider>
          <MobileToolNav />

          <header className="sticky top-0 z-50 md:px-8 md:pt-3">
            <div className="neo-navbar mx-auto flex w-full max-w-7xl flex-col gap-0 px-3 md:gap-3 md:px-6">
              {/* Mobile: 3-col grid — hamburger slot | centred logo | actions */}
              {/* Desktop: plain flex row */}
              <div className="grid h-14 grid-cols-[3rem_1fr_auto] items-center md:flex md:h-auto md:justify-between md:py-3">
                {/* Col 1 — empty spacer on mobile (hamburger is fixed); hidden on desktop */}
                <div className="md:hidden" aria-hidden="true" />

                <Link href="/" className="flex items-center justify-center gap-2 md:justify-start md:gap-3">
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-500 text-sm font-bold text-slate-950 shadow-[0_10px_22px_-14px_rgba(14,165,233,0.9)] ring-1 ring-white/20 md:h-9 md:w-9 dark:from-cyan-300 dark:via-sky-400 dark:to-fuchsia-400 dark:text-slate-950 dark:ring-white/25">
                    PT
                  </span>
                  <span className="font-display text-base font-semibold tracking-tight text-slate-950 md:text-xl">
                    PaperTrail
                  </span>
                </Link>

                <div className="flex items-center justify-end gap-1.5 md:gap-2">
                  <ThemeToggle />
                  {userId ? (
                    <Link
                      href="/research-studio"
                      className="neo-pill hidden px-3 py-1.5 text-xs font-semibold text-slate-800 sm:inline-flex md:px-4 md:py-2 md:text-sm"
                    >
                      Open Workspace
                    </Link>
                  ) : null}
                  <AccountControls />
                </div>
              </div>

              <div className="neo-navbar-sub hidden w-full items-center justify-between gap-4 md:flex">
                <nav className="flex items-center gap-2">
                  {NAV_PARENTS.map((parent, index) => {
                    const subgroupTools =
                      parent === "All"
                        ? TOOL_ITEMS
                        : TOOL_ITEMS.filter((tool) => tool.category === parent);

                    return (
                      <div key={parent} className="group relative">
                        <button
                          type="button"
                          className="nav-link neo-pill animate-rise-in border border-transparent bg-transparent text-[11px] uppercase tracking-[0.12em]"
                          style={{ animationDelay: `${index * 40}ms` }}
                        >
                          {parent}
                        </button>

                        <div className="nav-dropdown-panel nav-dropdown-pop pointer-events-none invisible absolute left-0 top-[calc(100%+10px)] z-50 w-[min(82vw,760px)] origin-top-left rounded-3xl border border-slate-200/80 bg-white/90 p-4 opacity-0 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.42)] backdrop-blur-xl ring-1 ring-white/50 transition-all duration-200 ease-out will-change-transform translate-y-2 scale-[0.985] group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 dark:bg-slate-950/90 dark:border-slate-700/80 dark:ring-white/10">
                          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100/80 pb-2 dark:border-slate-800/80">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
                              {parent === "All" ? "All tool subgroups" : `${parent} subgroups`}
                            </p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {subgroupTools.length} tools
                            </span>
                          </div>

                          <div className="grid max-h-[320px] grid-cols-2 gap-2 overflow-auto pr-1 lg:grid-cols-3">
                            {subgroupTools.map((tool, idx) => (
                              <Link
                                key={`top-sub-${tool.slug}`}
                                href={`/tools/${tool.slug}`}
                                className="neo-submenu-item group/item animate-rise-in px-3 py-2.5 text-xs font-semibold"
                                style={{ animationDelay: `${idx * 28}ms` }}
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

          <div className="flex w-full flex-1 flex-col">{children}</div>

          <script
            type="application/ld+json"
            // Global schema for site-level entity understanding.
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "WebSite",
                    name: SITE_NAME,
                    url: siteUrl.toString(),
                    description:
                      "Online PDF tools for merge, split, convert, OCR, security, editing, and signing workflows.",
                    potentialAction: {
                      "@type": "SearchAction",
                      target: `${siteUrl.toString()}?q={search_term_string}`,
                      "query-input": "required name=search_term_string",
                    },
                  },
                  {
                    "@type": "Organization",
                    name: SITE_NAME,
                    url: siteUrl.toString(),
                    logo: `${siteUrl.toString()}globe.svg`,
                  },
                ],
              }),
            }}
          />

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
        </ClerkProvider>
      </body>
    </html>
  );
}
