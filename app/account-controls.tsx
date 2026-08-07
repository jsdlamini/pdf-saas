"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountControls() {
  const { isLoaded, userId } = useAuth();
  const isSignedIn = Boolean(isLoaded && userId);

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/history"
        className="hidden rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900 md:inline-flex"
      >
        History
      </Link>
      {isSignedIn ? (
        <Link
          href="/research-studio"
          className="hidden rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900 md:inline-flex"
        >
          Projects
        </Link>
      ) : null}

      {isLoaded && !userId ? (
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
            aria-label="Sign in or create account"
            title="Sign in or create account"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </SignInButton>
      ) : null}

      {isSignedIn ? <UserButton /> : null}
    </div>
  );
}
