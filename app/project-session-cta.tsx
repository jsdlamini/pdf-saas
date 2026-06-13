"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

type ProjectSessionCtaProps = {
  compact?: boolean;
};

export default function ProjectSessionCta({ compact = false }: ProjectSessionCtaProps) {
  const { isLoaded, userId } = useAuth();

  return (
    <section
      className={`rounded-2xl border border-cyan-200 bg-cyan-50/80 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-900">Project sessions</p>
          <p className={`text-slate-700 ${compact ? "mt-1 text-xs" : "mt-1 text-sm"}`}>
            Save this session as a project so your files, drafts, and workflow context follow you across devices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isLoaded && userId ? (
            <Link
              href="/research-studio"
              className="rounded-full border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-900 transition hover:bg-cyan-100"
            >
              Open project workspace
            </Link>
          ) : null}

          {isLoaded && !userId ? (
            <>
            <SignUpButton mode="modal">
              <button
                type="button"
                className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Create account
              </button>
            </SignUpButton>
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-full border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-900 transition hover:bg-cyan-100"
              >
                Sign in to save
              </button>
            </SignInButton>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}