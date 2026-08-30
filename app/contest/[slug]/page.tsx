"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";

type ContestData = {
  contest: {
    id: number;
    name: string;
    slug: string;
    description: string;
    startsAt: string | null;
    endsAt: string | null;
    scoringMode: string;
    isPublic: boolean;
    freezeAt: string | null;
    frozen: boolean;
    prizes: Array<{ place: number; label: string }>;
    memberCount: number;
    isHost: boolean;
    isMember: boolean;
    canJoin: boolean;
  };
  challenges: Array<{ id: number; slug: string; language: string; difficulty: string; points: number; statement_md: string }>;
  leaderboard: Array<{ rank: number; userId: string; displayName: string; points: number; solved: number; penalty?: number; isWinner: boolean; prize: string | null }>;
};

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function medal(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
}

export default function ContestPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug || "";
  const searchParams = useSearchParams();
  const code = searchParams?.get("code") || "";
  const { isSignedIn, isLoaded } = useAuth();
  const [data, setData] = useState<ContestData | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/contest/${slug}${code ? `?code=${encodeURIComponent(code)}` : ""}`);
      const json = await res.json();
      if (!res.ok) setError(json?.error || "Contest not found.");
      else setData(json);
    } catch {
      setError("Could not load this contest.");
    }
  }

  useEffect(() => {
    if (!slug) return;
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [slug]);

  async function join() {
    setJoining(true);
    try {
      const res = await fetch(`/api/contest/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) setError(json?.error || "Could not join.");
      else await load();
    } catch {
      setError("Could not join.");
    } finally {
      setJoining(false);
    }
  }

  const live = useMemo(() => {
    if (!data) return false;
    const now = Date.now();
    const start = data.contest.startsAt ? new Date(data.contest.startsAt).getTime() : 0;
    const end = data.contest.endsAt ? new Date(data.contest.endsAt).getTime() : 0;
    return (!start || now >= start) && (!end || now <= end);
  }, [data]);

  // Arriving via a QR deep link (?code=...) should join straight away.
  useEffect(() => {
    if (!code || !isLoaded || !isSignedIn || !data || joining) return;
    if (data.contest.isMember) return;
    if (!(data.contest.isPublic || data.contest.canJoin)) return;
    const now = Date.now();
    const start = data.contest.startsAt ? new Date(data.contest.startsAt).getTime() : 0;
    const end = data.contest.endsAt ? new Date(data.contest.endsAt).getTime() : 0;
    if ((!start || now >= start) && (!end || now <= end)) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isLoaded, isSignedIn, data]);

  if (error) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-rose-500">{error}</div>;
  }
  if (!data) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">Loading…</div>;
  }

  const { contest } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{contest.name}</h1>
          {contest.isHost ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">Host</span>
          ) : null}
          {contest.isMember ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500">You're in</span>
          ) : null}
        </div>
        {contest.description ? <p className="mt-2 text-muted-foreground">{contest.description}</p> : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>Starts: {fmt(contest.startsAt)}</span>
          <span>Ends: {fmt(contest.endsAt)}</span>
          <span>Scoring: {contest.scoringMode === "icpc" ? "ICPC (penalty)" : "Most points"}</span>
          <span>{contest.memberCount} competitor{contest.memberCount === 1 ? "" : "s"}</span>
          {live ? <span className="text-emerald-500">● Live</span> : <span className="text-muted-foreground">Closed</span>}
        </div>
        {contest.prizes?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {contest.prizes.map((p) => (
              <span key={p.place} className="rounded-full border border-amber-500/40 px-3 py-1 text-sm text-amber-500">🏆 {p.label}</span>
            ))}
          </div>
        ) : null}
        {isLoaded && isSignedIn && !contest.isMember && (contest.isPublic || contest.canJoin) && live ? (
          <div className="mt-4">
            <Button onClick={join} disabled={joining}>{joining ? "Joining…" : "Join this contest"}</Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Problems</h2>
          <div className="space-y-2">
            {data.challenges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No problems listed yet.</p>
            ) : (
              data.challenges.map((ch) => (
                <details key={ch.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {ch.slug} <span className="ml-2 text-xs font-normal text-muted-foreground">{ch.language} · {ch.difficulty} · {ch.points} pts</span>
                  </summary>
                  <div className="mt-2 text-sm challenge-markdown">
                    <ReactMarkdown>{ch.statement_md}</ReactMarkdown>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Leaderboard</h2>
          {data.contest.frozen ? (
            <p className="mb-2 text-sm text-amber-500">⏸️ Frozen — results hidden until the contest ends.</p>
          ) : null}
          {data.leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scores yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Competitor</th>
                  <th className="py-1 pr-2 text-right">Solved</th>
                  <th className="py-1 text-right">{data.contest.scoringMode === "icpc" ? "Penalty" : "Points"}</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((e) => (
                  <tr key={e.userId} className={`border-b ${e.isWinner ? "bg-amber-500/10" : ""}`}>
                    <td className="py-1 pr-2">{medal(e.rank) || e.rank}</td>
                    <td className="py-1 pr-2">{e.displayName}{e.prize ? <span className="ml-1.5 text-xs text-amber-500">🏆 {e.prize}</span> : null}</td>
                    <td className="py-1 pr-2 text-right">{e.solved}</td>
                    <td className="py-1 text-right font-semibold">{data.contest.scoringMode === "icpc" ? e.penalty : e.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
