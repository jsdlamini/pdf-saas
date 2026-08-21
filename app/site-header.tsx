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
    <header className="sticky top-0 z-50 md:px-8 md:pt-3">
      <div className="neo-navbar mx-auto flex w-full max-w-7xl items-center px-4 py-0 md:px-6">
        <div className="grid h-14 w-full grid-cols-[3rem_1fr_auto] items-center md:flex md:h-14 md:justify-between">
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
      </div>
    </header>
  );
}
