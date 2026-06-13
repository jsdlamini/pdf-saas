"use client";

import { SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountControls() {
  const { isLoaded, userId } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/research-studio"
        className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
      >
        Projects
      </Link>

      {isLoaded && !userId ? (
        <>
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
          >
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button
            type="button"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Create account
          </button>
        </SignUpButton>
        </>
      ) : null}

      {isLoaded && userId ? <UserButton /> : null}
    </div>
  );
}