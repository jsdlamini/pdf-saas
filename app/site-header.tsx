"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AccountControls from "./account-controls";
import ThemeToggle from "./theme-toggle";

// The global site header, auto-hidden on the Research Studio route so the
// editor gets maximum vertical space.
export default function SiteHeader({ userId }: { userId: string | null }) {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch("/api/admin-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setIsAdmin(Boolean(d?.isAdmin)); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [userId]);

  if (pathname.startsWith("/research-studio")) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-4 md:gap-8">
          {/* Spacer for the mobile tool-nav hamburger (fixed, top-left). */}
          <div className="w-11 shrink-0 md:hidden" aria-hidden="true" />

          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-600)] text-sm font-bold text-white ring-1 ring-black/5">
              WF
            </span>
            <span className="font-display text-lg font-semibold tracking-tight text-[var(--headline)]">
              WiserFiles
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <Link href="/#tools" className="nav-link">Tools</Link>
            <Link href="/research-studio" className="nav-link">Research Studio</Link>
            <Link href="/docs" className="nav-link">Docs</Link>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {isAdmin ? (
            <Link
              href="/dashboard"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white sm:inline-flex md:px-4 md:py-2 md:text-sm"
              style={{
                backgroundImage: "linear-gradient(135deg, #6366f1, #a855f7)",
                boxShadow: "0 8px 20px -8px rgba(139, 92, 246, 0.85)",
              }}
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 3v14h14" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 13l3-4 2 2 4-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Dashboard
            </Link>
          ) : null}
          <AccountControls />
        </div>
      </div>
    </header>
  );
}
