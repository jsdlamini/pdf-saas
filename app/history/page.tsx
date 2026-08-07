"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TOOL_ITEMS } from "@/lib/tools";

type LocalStoredFileEntry = {
  id: string;
  fileName: string;
  size: number;
  toolSlug: string;
  message: string;
  createdAt: number;
};

const LOCAL_FILE_HISTORY_KEY = "wiserfiles-local-file-history";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<LocalStoredFileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_FILE_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LocalStoredFileEntry[];
        setEntries(parsed);
      }
    } catch {
      // ignore parse errors
    }
    setLoaded(true);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8 md:px-10 md:py-10">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950">
          Activity History
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Recent file processing activity in this browser.
        </p>
      </div>

      {!loaded ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white/85 py-20">
          <svg
            viewBox="0 0 24 24"
            className="h-10 w-10 text-slate-300"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm text-slate-500">No activity yet.</p>
          <Link
            href="/"
            className="rounded-full border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100"
          >
            Go to tools
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const tool = TOOL_ITEMS.find((t) => t.slug === entry.toolSlug);
            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/85 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {entry.fileName}
                  </p>
                  <p className="text-xs text-slate-500">{entry.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <span>{formatBytes(entry.size)}</span>
                  {tool ? (
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800"
                    >
                      {tool.name}
                    </Link>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
                      {entry.toolSlug}
                    </span>
                  )}
                  <span className="hidden sm:inline">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
