import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { TOOL_ITEMS } from "@/lib/tools";
import AccountControls from "./account-controls";
import MobileToolNav from "./mobile-tool-nav";
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

const SITE_NAME = "WiserFiles";
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
    default: "WiserFiles | Online PDF Tools for Merge, OCR, Convert, Compress, and Sign",
    template: "%s | WiserFiles",
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
    "WiserFiles",
  ],
  category: "technology",
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: "WiserFiles | Online PDF Tools",
    description:
      "Online PDF tools for merge, convert, OCR, compress, security, editing, and signing workflows.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "WiserFiles PDF tools",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "WiserFiles | Online PDF Tools",
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
            <div className="neo-navbar mx-auto flex w-full max-w-7xl items-center px-4 py-0 md:px-6">
              {/* Mobile: 3-col grid — hamburger slot | centred logo | actions */}
              {/* Desktop: plain flex row */}
              <div className="grid h-14 w-full grid-cols-[3rem_1fr_auto] items-center md:flex md:h-14 md:justify-between">
                {/* Col 1 — empty spacer on mobile (hamburger is fixed); hidden on desktop */}
                <div className="md:hidden" aria-hidden="true" />

                <div className="flex items-center justify-center gap-2 md:justify-start md:gap-3">
                  <Link href="/" className="flex items-center gap-2 md:gap-3">
                    <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-500 text-sm font-bold text-slate-950 shadow-[0_10px_22px_-14px_rgba(14,165,233,0.9)] ring-1 ring-white/20 dark:from-cyan-300 dark:via-sky-400 dark:to-fuchsia-400 dark:text-slate-950 dark:ring-white/25">
                      WF
                    </span>
                    <span className="font-display text-base font-semibold tracking-tight text-slate-950 md:text-lg">
                      WiserFiles
                    </span>
                  </Link>

                  {/* Simple flat Tools dropdown */}
                  <div className="group relative ml-1 hidden md:block">
                    <button
                      type="button"
                      className="neo-pill inline-flex items-center gap-1 border border-transparent bg-transparent px-3 py-1.5 text-sm font-semibold text-slate-700"
                    >
                      Tools
                      <svg
                        viewBox="0 0 20 20"
                        className="h-3.5 w-3.5 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M5 7l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <div className="nav-dropdown-panel nav-dropdown-pop pointer-events-none invisible absolute left-0 top-[calc(100%+8px)] z-50 w-[280px] origin-top-left rounded-2xl border border-slate-200/80 bg-white/95 p-3 opacity-0 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.4)] backdrop-blur-xl ring-1 ring-white/50 transition-all duration-200 ease-out translate-y-2 scale-[0.985] group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 dark:bg-slate-950/95 dark:border-slate-700/80 dark:ring-white/10">
                      <div className="max-h-[360px] overflow-auto">
                        {TOOL_ITEMS.map((tool) => (
                          <Link
                            key={`nav-tool-${tool.slug}`}
                            href={`/tools/${tool.slug}`}
                            className="neo-submenu-item block px-3 py-2 text-xs font-semibold"
                          >
                            <span className="flex items-center justify-between">
                              <span>{tool.name}</span>
                              <span className="text-[10px] font-normal text-slate-400">
                                {tool.runtime === "server" ? "⚙ Server" : "Browser"}
                              </span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 md:gap-2">
                  <ThemeToggle />
                  {userId ? (
                    <Link
                      href="/research-studio"
                      className="neo-pill hidden px-3 py-1.5 text-xs font-semibold text-slate-800 sm:inline-flex md:px-4 md:py-2 md:text-sm"
                    >
                      Research Studio
                    </Link>
                  ) : null}
                  <AccountControls />
                </div>
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
                  WiserFiles
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
                  <Link href="/history" className="footer-link">Activity history</Link>
                </div>
              </div>
            </div>
          </footer>
        </ClerkProvider>
      </body>
    </html>
  );
}
