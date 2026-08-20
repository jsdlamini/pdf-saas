import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import AccountControls from "./account-controls";
import MobileToolNav from "./mobile-tool-nav";
import FooterShareLink from "./components/footer-share-link";
import OfflineIndicator from "./components/offline-indicator";
import Onboarding from "./components/onboarding";
import AnalyticsTracker from "./components/analytics-client";
import ThemeToggle from "./theme-toggle";
import SiteHeader from "./site-header";
import ToastContainer from "./components/toast";
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
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;
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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
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
      <body className="min-h-full flex flex-col bg-[#f0f4ff] text-slate-900 depth-stage">
        {/* Skip-to-content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-cyan-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none"
        >
          Skip to content
        </a>
        <ClerkProvider>
          <ToastContainer />
          <AnalyticsTracker />
          <Onboarding />
          <MobileToolNav />

          <SiteHeader userId={userId} />

          <div id="main-content" className="flex w-full flex-1 flex-col">{children}</div>

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
                <Link
                  href="/research-studio"
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-purple-300/40 transition-all hover:scale-105 hover:shadow-xl hover:shadow-purple-400/50"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h6l3 3v11H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 3v3h3M8 11h4M8 14h2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Research Studio — LaTeX Editor
                </Link>
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
                  <Link href="/faq" className="footer-link">FAQ</Link>
                  <span className="text-sm text-slate-400">—</span>
                  <FooterShareLink />
                </div>
              </div>
            </div>
          </footer>

          {/* Register service worker for PWA offline support */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').then(
                      function(registration) {
                        console.log('SW registered:', registration.scope);
                      },
                      function(err) {
                        console.log('SW registration failed:', err);
                      }
                    );
                  });
                }
              `,
            }}
          />
        </ClerkProvider>
        <OfflineIndicator />
      </body>
    </html>
  );
}
