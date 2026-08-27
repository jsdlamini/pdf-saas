"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import FooterShareLink from "./footer-share-link";

// Marketing footer. Hidden on workspace routes (Research Studio, dashboard)
// where a compact app bar is the right chrome, not a marketing footer.
export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/research-studio") || pathname.startsWith("/dashboard")) {
    return null;
  }

  return (
    <footer className="glass-3d mt-8">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-10 md:grid-cols-4 md:px-10">
        <div className="space-y-3">
          <p className="font-display text-2xl font-semibold tracking-tight text-slate-950">
            WiserFiles
          </p>
          <p className="text-sm text-slate-600">
            by <Link href="/about" className="font-semibold text-slate-800 underline decoration-slate-300 hover:decoration-slate-600">Ideal Software Solutions</Link>
          </p>
          <p className="max-w-sm text-sm text-slate-600">
            Every PDF tool you need, free. Built in Eswatini.
          </p>
          <Link
            href="/research-studio"
            className="inline-flex items-center gap-2 rounded-full bg-[#1e40af] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#1e3a8a]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 3h6l3 3v11H6V3z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 3v3h3M8 11h4M8 14h2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Research Studio — LaTeX Editor
          </Link>
        </div>

        <div>
          <p className="type-eyebrow text-slate-500">Core Tools</p>
          <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
            <Link href="/tools/merge-pdf" className="footer-link">Merge PDF</Link>
            <Link href="/tools/split-pdf" className="footer-link">Split PDF</Link>
            <Link href="/tools/compress-pdf" className="footer-link">Compress PDF</Link>
            <Link href="/tools/pdf-to-word" className="footer-link">PDF to Word</Link>
            <Link href="/tools/sign-pdf" className="footer-link">Sign PDF</Link>
          </div>
        </div>

        <div>
          <p className="type-eyebrow text-slate-500">Product</p>
          <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
            <Link href="/research-studio" className="footer-link">Research Studio</Link>
            <Link href="/docs" className="footer-link">Docs</Link>
            <Link href="/history" className="footer-link">Activity history</Link>
            <FooterShareLink />
          </div>
        </div>

        <div>
          <p className="type-eyebrow text-slate-500">Company</p>
          <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
            <Link href="/about" className="footer-link">About</Link>
            <Link href="/faq" className="footer-link">FAQ</Link>
            <Link href="/privacy" className="footer-link">Privacy</Link>
            <Link href="/terms" className="footer-link">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
