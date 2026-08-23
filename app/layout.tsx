import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
// Self-hosted fonts (no build-time Google Fonts fetch). Families are
// referenced via CSS variables set in globals.css.
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import AccountControls from "./account-controls";
import MobileToolNav from "./mobile-tool-nav";
import SiteFooter from "./components/site-footer";
import OfflineIndicator from "./components/offline-indicator";
import Onboarding from "./components/onboarding";
import AnalyticsTracker from "./components/analytics-client";
import ThemeToggle from "./theme-toggle";
import SiteHeader from "./site-header";
import ToastContainer from "./components/toast";
import "./globals.css";

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
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col text-slate-900">
        {/* Skip-to-content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-[#1e40af] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none"
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
                    logo: `${siteUrl.toString()}icon-512.png`,
                  },
                ],
              }),
            }}
          />

          <SiteFooter />

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
