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

      {/* User Management */}
      <UserManagement />
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
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">User Management</h2>
      <p className="text-xs text-slate-500 mt-1">Promote registered users to admin or demote them.</p>
      {!users.length ? (
        <p className="mt-4 text-sm text-slate-400 italic">No registered users yet. Users appear here after they sign in and access the app.</p>
      ) : (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Joined</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-700">{u.email}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      u.role === "admin"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-slate-500">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => toggleRole(u.user_id, u.role)}
                    className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 underline"
                  >
                    {u.role === "admin" ? "Demote to user" : "Promote to admin"}
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
