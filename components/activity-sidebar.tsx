"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOL_ITEMS } from "@/lib/tools";

type ActivityEntry = {
  id: string;
  toolSlug: string;
  toolName?: string;
  fileName?: string;
  fileSize?: number;
  durationMs?: number;
  success: boolean;
  createdAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ActivitySidebar() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchActivity() {
      try {
        const res = await fetch("/api/activity-log");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEntries(data.entries || []);
      } catch {
        // Silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchActivity();

    // Refresh when workflows change
    const onWorkflowChange = () => fetchActivity();
    window.addEventListener("wiserfiles-recent-workflows-change", onWorkflowChange);
    return () => {
      cancelled = true;
      window.removeEventListener("wiserfiles-recent-workflows-change", onWorkflowChange);
    };
  }, []);

  const toolNameBySlug = (slug: string) => TOOL_ITEMS.find((t) => t.slug === slug)?.name || slug;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
        Recent Activity
      </h3>

      {loading ? (
        <p className="mt-2 text-xs text-slate-400">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No activity yet. Run a tool to see it here.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.slice(0, 12).map((entry) => (
            <li key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/tools/${entry.toolSlug}`}
                  className="font-semibold text-cyan-800 hover:underline"
                >
                  {entry.toolName || toolNameBySlug(entry.toolSlug)}
                </Link>
                <span className="text-slate-400">{formatTimeAgo(entry.createdAt)}</span>
              </div>
              {entry.fileName ? (
                <p className="mt-0.5 truncate text-slate-500">
                  {entry.fileName}
                  {entry.fileSize ? ` (${formatBytes(entry.fileSize)})` : ""}
                </p>
              ) : null}
              {entry.durationMs ? (
                <p className="mt-0.5 text-slate-400">
                  {entry.success ? "✓" : "✗"} Completed in {formatDuration(entry.durationMs)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
