"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type AnalyticsData = {
  totalPageviews: number;
  uniqueVisitors: number;
  tools: Array<{ tool: string; count: string }>;
  daily: Array<{ date: string; count: string }>;
  referrers: Array<{ referrer: string; count: string }>;
};

export default function DashboardPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSignedIn) { setLoading(false); return; }
    fetch("/api/analytics-data")
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "Access denied" : "Failed");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isSignedIn]);

  if (!isLoaded || loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><p className="text-slate-500">Loading...</p></div>;
  }

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-slate-950">Analytics Dashboard</h1>
        <p className="mt-4 text-slate-600">Sign in with an authorized account to access.</p>
        <div className="mt-6">
          <span className="inline-flex rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-2.5 text-sm font-bold text-white">
            <SignInButton mode="modal">Sign in</SignInButton>
          </span>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="font-display text-3xl font-semibold text-slate-950">Access Denied</h1>
        <p className="mt-4 text-slate-600">Your account is not authorized to view this dashboard.</p>
      </main>
    );
  }

  if (!data) return null;

  const maxDaily = Math.max(...data.daily.map((d) => parseInt(d.count)), 1);
  const maxTool = Math.max(...data.tools.map((t) => parseInt(t.count)), 1);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">Analytics Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Last 30 days</p>

      {/* KPI cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Total Pageviews</p>
          <p className="mt-1 font-display text-4xl font-bold text-slate-950">{data.totalPageviews.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Unique Visitors</p>
          <p className="mt-1 font-display text-4xl font-bold text-slate-950">{data.uniqueVisitors.toLocaleString()}</p>
        </div>
      </div>

      {/* Daily chart */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800">Daily Pageviews</h2>
        <div className="mt-4 flex items-end gap-1 h-32">
          {data.daily.slice(0, 30).reverse().map((d) => (
            <div key={d.date} className="group relative flex-1 flex flex-col justify-end">
              <div
                className="w-full rounded-t bg-gradient-to-t from-cyan-500 to-sky-400 transition hover:from-cyan-600 hover:to-sky-500"
                style={{ height: `${(parseInt(d.count) / maxDaily) * 100}%`, minHeight: 2 }}
              />
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block">
                <span className="whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white">
                  {d.date.slice(5)} — {d.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tools table */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-800">Top Tools</h2>
        <div className="mt-3 space-y-1">
          {data.tools.slice(0, 10).map((t) => (
            <div key={t.tool} className="flex items-center gap-3">
              <span className="w-40 truncate text-sm text-slate-700">{t.tool}</span>
              <div className="flex-1 h-5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-500"
                  style={{ width: `${(parseInt(t.count) / maxTool) * 100}%` }}
                />
              </div>
              <span className="w-12 text-right text-xs font-semibold text-slate-600">{t.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Referrers */}
      {data.referrers.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-800">Top Referrers</h2>
          <div className="mt-3 space-y-2">
            {data.referrers.map((r) => {
              const host = r.referrer ? new URL(r.referrer).hostname : r.referrer;
              return (
                <div key={r.referrer} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 truncate max-w-xs">{host}</span>
                  <span className="font-semibold text-slate-800">{r.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </main>
  );
}
