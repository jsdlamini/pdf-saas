"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type JoinData = {
  course: { id: number; code: string; title: string; institution: string };
  cohort: { id: number; name: string; member_count: number };
  alreadyMember: boolean;
};

type JoinState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: JoinData }
  | { kind: "joined"; data: JoinData };

export default function JoinPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = (searchParams?.get("code") || "").trim().toUpperCase();
  const { isLoaded, isSignedIn } = useAuth();

  const [state, setState] = useState<JoinState>({ kind: "loading" });
  const [loadedCode, setLoadedCode] = useState("");
  const [codeInput, setCodeInput] = useState(code);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/join?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: "error", message: json?.error || "This join link is not valid." });
        } else {
          setState({ kind: "ready", data: json as JoinData });
        }
        setLoadedCode(code);
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Could not load this join link." });
      });
    return () => { cancelled = true; };
  }, [code, isSignedIn]);

  async function join() {
    if (state.kind !== "ready" || !state.data) return;
    setJoining(true);
    try {
      const res = await fetch("/api/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", joinCode: code }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setState({ kind: "error", message: json?.error || "Could not join this course." });
        return;
      }
      setState({ kind: "joined", data: state.data });
    } catch {
      setState({ kind: "error", message: "Could not join this course." });
    } finally {
      setJoining(false);
    }
  }

  if (!code) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4 py-12">
        <div className="w-full rounded-2xl border border-border bg-popover p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-bold">Join a course</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste the join link or code your teacher shared with you.
          </p>
          <form
            className="mx-auto mt-5 flex max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = codeInput.trim().toUpperCase();
              if (!value) return;
              router.replace(`/join?code=${encodeURIComponent(value)}`);
            }}
          >
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="e.g. A1B2C3D4"
              className="uppercase"
              aria-label="Join code"
            />
            <Button type="submit">Continue</Button>
          </form>
        </div>
      </main>
    );
  }

  if (loadedCode !== code || state.kind === "loading") {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4 py-12">
        <p className="text-center text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4 py-12">
        <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-2xl">⚠️</div>
          <h1 className="mt-4 font-display text-xl font-bold text-rose-700">Link not available</h1>
          <p className="mt-2 text-sm text-rose-600">{state.message}</p>
          <p className="mt-4 text-xs text-rose-500">Ask your teacher to share a fresh link.</p>
        </div>
      </main>
    );
  }

  const { course, cohort, alreadyMember } = state.data;

  if (state.kind === "joined" || (isLoaded && isSignedIn && alreadyMember)) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4 py-12">
        <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
          <h1 className="mt-4 font-display text-xl font-bold text-emerald-700">
            {state.kind === "joined" ? "You're in!" : "You're already in this course"}
          </h1>
          <p className="mt-2 text-sm text-emerald-700">
            {course.code} · {course.title}
          </p>
          <div className="mt-6">
            <Button onClick={() => router.push("/research-studio")}>Open Research Studio</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center px-4 py-12">
      <div className="w-full rounded-2xl border border-border bg-popover p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl">🎓</div>
        <h1 className="mt-4 font-display text-2xl font-bold">{course.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {course.code}
          {course.institution ? ` · ${course.institution}` : ""}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {cohort.member_count} member{cohort.member_count === 1 ? "" : "s"} enrolled
        </p>

        {isLoaded && !isSignedIn ? (
          <div className="mt-6">
            <p className="mb-3 text-sm text-muted-foreground">Sign in to join this course.</p>
            <SignInButton mode="modal">
              <Button>Sign in to join</Button>
            </SignInButton>
          </div>
        ) : isLoaded && isSignedIn ? (
          <div className="mt-6">
            <Button onClick={join} disabled={joining}>
              {joining ? "Joining…" : "Join this course"}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
