"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type AnalyticsData = {
  totalPageviews: number;
  uniqueVisitors: number;
  tools: Array<{ tool: string; count: string }>;
  daily: Array<{ date: string; count: string }>;
  referrers: Array<{ referrer: string; count: string }>;
  countries: Array<{ country: string; count: string }>;
  cities: Array<{ city: string; country: string; count: string }>;
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
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 p-12 shadow-2xl">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="mt-6 font-display text-3xl font-bold text-white">Analytics Dashboard</h1>
          <p className="mt-3 text-slate-300">Sign in with an authorized account to access.</p>
          <div className="mt-8">
            <span className="inline-flex rounded-full bg-gradient-to-r from-cyan-400 to-sky-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/30 transition hover:shadow-xl hover:shadow-cyan-500/40">
              <SignInButton mode="modal">Sign in to dashboard</SignInButton>
            </span>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-12">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-rose-500" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold text-slate-950">Access Denied</h1>
          <p className="mt-2 text-slate-600">Your account is not authorized to view this dashboard.</p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const maxDaily = Math.max(...data.daily.map((d) => parseInt(d.count)), 1);
  const maxTool = Math.max(...data.tools.map((t) => parseInt(t.count)), 1);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 pb-16 pt-10">
        <div className="mx-auto max-w-5xl px-6 md:px-10">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-white">WiserFiles Analytics</h1>
              <p className="text-sm text-slate-400">Last 30 days</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards — overlap the header */}
      <div className="mx-auto max-w-5xl px-6 md:px-10 -mt-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="group rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur p-5 shadow-lg shadow-slate-200/50 transition hover:shadow-xl hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-100 to-sky-100">
                <svg viewBox="0 0 20 20" className="h-5 w-5 text-cyan-600" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 6v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Pageviews</p>
                <p className="font-display text-2xl font-bold text-slate-950">{data.totalPageviews.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="group rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur p-5 shadow-lg shadow-slate-200/50 transition hover:shadow-xl hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-100 to-pink-100">
                <svg viewBox="0 0 20 20" className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
                  <path d="M2 18c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Visitors</p>
                <p className="font-display text-2xl font-bold text-slate-950">{data.uniqueVisitors.toLocaleString()}</p>
              </div>
            </div>
          </div>
          <div className="group rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur p-5 shadow-lg shadow-slate-200/50 transition hover:shadow-xl hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-teal-100">
                <svg viewBox="0 0 20 20" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6l-4-4z" />
                  <path d="M14 2v4h4M8 13h4M8 9h2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Tools</p>
                <p className="font-display text-2xl font-bold text-slate-950">{data.tools.length}</p>
              </div>
            </div>
          </div>
          <div className="group rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur p-5 shadow-lg shadow-slate-200/50 transition hover:shadow-xl hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-100">
                <svg viewBox="0 0 20 20" className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M9 5H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="2" width="4" height="4" rx="1" />
                  <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Referrers</p>
                <p className="font-display text-2xl font-bold text-slate-950">{data.referrers.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts section */}
      <div className="mx-auto max-w-5xl px-6 md:px-10 py-6 space-y-6">
        {/* Daily chart */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Daily Pageviews</h2>
              <p className="text-xs text-slate-500 mt-0.5">Last 30 days</p>
            </div>
            <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-[10px] font-bold text-cyan-800">
              {data.daily.reduce((sum, d) => sum + parseInt(d.count), 0).toLocaleString()} total
            </span>
          </div>
          <div className="flex items-end gap-1 h-40">
            {data.daily.length === 0 ? (
              <div className="flex w-full items-center justify-center h-full text-sm text-slate-400">
                No data yet — activity will appear here as visitors arrive
              </div>
            ) : (
              data.daily.slice(0, 30).reverse().map((d, i) => {
              const count = parseInt(d.count) || 0;
              const pct = maxDaily > 0 ? Math.round((count / maxDaily) * 100) : 0;
              return (
                <div key={d.date || i} className="group relative flex-1 flex flex-col justify-end">
                  <div
                    className="w-full rounded-t transition-all duration-300"
                    style={{
                      height: `${Math.max(pct, 2)}%`,
                      minHeight: count > 0 ? "4px" : "2px",
                      background: "linear-gradient(to top, #06b6d4, #0ea5e9)",
                    }}
                  />
                  <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10px] font-semibold text-white shadow">
                      {(d.date || "").toString().slice(0, 10)} — {count} views
                    </span>
                  </div>
                </div>
              );
            })
            )}
          </div>
          <div className="mt-8 flex justify-between text-[10px] text-slate-400">
            <span>{(data.daily[data.daily.length - 1]?.date || "").toString().slice(0, 10)}</span>
            <span>{(data.daily[0]?.date || "").toString().slice(0, 10)}</span>
          </div>
        </div>

        {/* Tools + Referrers grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top tools */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Top Tools</h2>
            <div className="space-y-3">
              {data.tools.slice(0, 10).map((t, i) => (
                <div key={t.tool} className="flex items-center gap-3 group">
                  <span className="w-5 text-right text-[11px] font-bold text-slate-400">#{i + 1}</span>
                  <span className="w-36 truncate text-sm font-medium text-slate-700 group-hover:text-cyan-700">{t.tool}</span>
                  <div className="flex-1 h-6 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(parseInt(t.count) / maxTool) * 100}%`,
                        background: `linear-gradient(to right, rgb(6 182 212 / 0.7), rgb(14 165 233 / 0.9))`,
                      }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs font-semibold text-slate-600">{t.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top referrers */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Top Referrers</h2>
            {data.referrers.length > 0 ? (
              <div className="space-y-2">
                {data.referrers.map((r, i) => {
                  const host = (() => {
                    try { return new URL(r.referrer).hostname; } catch { return r.referrer; }
                  })();
                  const maxRef = Math.max(...data.referrers.map((x) => parseInt(x.count)), 1);
                  return (
                    <div key={r.referrer} className="flex items-center gap-3 group">
                      <span className="w-5 text-right text-[11px] font-bold text-slate-400">#{i + 1}</span>
                      <span className="flex-1 truncate text-sm text-slate-600 group-hover:text-cyan-700">{host}</span>
                      <span className="text-xs font-semibold text-slate-500">{r.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <svg viewBox="0 0 24 24" className="h-8 w-8 mb-2 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <p className="text-sm">No external referrers yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Geo distribution */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Visitors by Country</h2>
          {data.countries && data.countries.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {data.countries.slice(0, 15).map((c, i) => (
                <div key={c.country} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="text-lg">{
                    { 'South Africa': '🇿🇦', 'Eswatini': '🇸🇿', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Germany': '🇩🇪', 'France': '🇫🇷', 'India': '🇮🇳', 'Canada': '🇨🇦', 'Australia': '🇦🇺', 'Nigeria': '🇳🇬', 'Kenya': '🇰🇪', 'Botswana': '🇧🇼', 'Zimbabwe': '🇿🇼', 'Namibia': '🇳🇦', 'Mozambique': '🇲🇿', 'Lesotho': '🇱🇸', 'Malawi': '🇲🇼', 'Zambia': '🇿🇲', 'Tanzania': '🇹🇿', 'Ghana': '🇬🇭' }[c.country] || '🌍'
                  }</span>
                  <span className="flex-1 font-medium text-slate-700">{c.country}</span>
                  <span className="text-xs font-semibold text-slate-500">{c.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <p className="text-sm">No geo data collected yet</p>
            </div>
          )}
        </div>

        {/* User Management */}
        <UserManagement />

        {/* Marketing Snippets */}
        <MarketingSection />
      </div>
    </main>
  );
}

function UserManagement() {
  const [users, setUsers] = useState<Array<{ user_id: string; email: string; role: string; created_at: string }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin-users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === "admin" ? "user" : "admin";
    const r = await fetch("/api/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: newRole }),
    });
    if (r.ok) {
      setUsers((prev) =>
        prev.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u))
      );
    }
  }

  if (!loaded) return null;

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-base font-semibold text-slate-900">User Management</h2>
          <p className="text-xs text-slate-500 mt-0.5">Promote registered users to admin or demote them.</p>
        </div>
        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-800">
          {users.length} user{users.length !== 1 ? "s" : ""}
        </span>
      </div>
      {!users.length ? (
        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-8 w-8 mb-2 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
          </svg>
          <p className="text-sm">No registered users yet</p>
          <p className="text-xs mt-1">Users appear here after signing in and accessing the app.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                <th className="py-2 pr-4 font-semibold">Email</th>
                <th className="py-2 pr-4 font-semibold">Role</th>
                <th className="py-2 pr-4 font-semibold">Joined</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 pr-4 text-slate-700">{u.email}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        u.role === "admin"
                          ? "bg-purple-100 text-purple-800 border border-purple-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-slate-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleRole(u.user_id, u.role)}
                      className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 underline underline-offset-2 transition"
                    >
                      {u.role === "admin" ? "Demote" : "Promote"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MarketingSection() {
  const [snippets, setSnippets] = useState<Array<{ platform: string; text: string; id: number }>>([]);
  const [platform, setPlatform] = useState("twitter");
  const [copied, setCopied] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchSnippets(p: string, rotate = false) {
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing-snippets?platform=${p}${rotate ? "&rotate=1" : ""}`);
      if (!r.ok) throw new Error("Failed");
      const d = await r.json();
      if (d.snippets) setSnippets(d.snippets.map((s: any) => ({ ...s, platform: p })));
    } catch {
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }

  function loadPlatform(p: string) {
    setPlatform(p);
    setSnippets([]);
    fetchSnippets(p);
  }

  async function copyToClipboard(text: string, id: number) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Marketing Snippets</h2>
          <p className="text-xs text-slate-500 mt-0.5">Ready-to-post content — click any card to copy.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { key: "twitter", label: "Twitter/X", color: "bg-sky-100 text-sky-800 border-sky-200" },
          { key: "linkedin", label: "LinkedIn", color: "bg-blue-100 text-blue-800 border-blue-200" },
          { key: "tiktok", label: "TikTok Captions", color: "bg-pink-100 text-pink-800 border-pink-200" },
        ].map(({ key, label, color }) => (
          <button
            key={key}
            type="button"
            onClick={() => loadPlatform(key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition border ${
              platform === key
                ? `${color} shadow-sm`
                : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-600" />
        </div>
      ) : snippets.length > 0 ? (
        <div className="mt-4 space-y-3">
          {snippets.map((s) => (
            <div
              key={s.id}
              className="group relative rounded-xl border border-slate-200 bg-slate-50 p-4 pr-16 cursor-pointer hover:border-cyan-300 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all duration-200"
              onClick={() => copyToClipboard(s.text, s.id)}
            >
              <p className="text-sm text-slate-700 leading-relaxed">{s.text}</p>
              <span className={`absolute right-3 top-3 text-[10px] font-bold transition ${
                copied === s.id
                  ? "text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"
                  : "text-slate-400 group-hover:text-cyan-600"
              }`}>
                {copied === s.id ? "✓ Copied!" : "Click to copy"}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fetchSnippets(platform, true)}
            className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-cyan-700 hover:text-cyan-900 transition"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6c0 1.1 1.2 1.8 2.2 1.2L5 10h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2z" />
              <path d="M3 14c0 1.1 1.2 1.8 2.2 1.2L7 14h5a2 2 0 0 0 2-2V8" />
            </svg>
            Regenerate snippets
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-8 w-8 mb-2 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          <p className="text-sm">Select a platform to load marketing snippets</p>
        </div>
      )}
    </div>
  );
}
