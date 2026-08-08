"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rankToolsByIntent } from "@/lib/tool-intent-search";
import { TOOL_ITEMS } from "@/lib/tools";

type ToolNavSearchProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function ToolNavSearch({ className, onNavigate }: ToolNavSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function goTo(path: string) {
    router.push(path);
    onNavigate?.();
  }

  const suggestedTools = useMemo(() => {
    const normalized = query.trim();
    return rankToolsByIntent(TOOL_ITEMS, normalized).map((entry) => entry.tool);
  }, [query]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      goTo("/");
      return;
    }

    const exactSlug = TOOL_ITEMS.find((tool) => tool.slug.toLowerCase() === normalized);
    if (exactSlug) {
      goTo(`/tools/${exactSlug.slug}`);
      return;
    }

    const nameMatch = TOOL_ITEMS.find((tool) => tool.name.toLowerCase() === normalized);
    if (nameMatch) {
      goTo(`/tools/${nameMatch.slug}`);
      return;
    }

    const partialMatch = TOOL_ITEMS.find((tool) => {
      return tool.name.toLowerCase().includes(normalized);
    });

    const ranked = rankToolsByIntent(TOOL_ITEMS, normalized);
    const bestIntentMatch = ranked[0];
    if (bestIntentMatch && bestIntentMatch.score >= 18) {
      goTo(`/tools/${bestIntentMatch.tool.slug}`);
      return;
    }

    if (partialMatch) {
      goTo(`/tools/${partialMatch.slug}`);
      return;
    }

    goTo("/");
  }

  return (
    <form onSubmit={onSubmit} className={`relative min-w-0 w-full ${className ?? "max-w-[340px]"}`.trim()}>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tools..."
        aria-label="Search tools"
        className="w-full rounded-full border border-slate-300 bg-white px-4 py-2 pr-20 text-xs font-medium text-slate-800 outline-none ring-cyan-400/40 transition focus:ring-2 focus:ring-cyan-500"
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-slate-700"
      >
        Go
      </button>

      {query.trim() ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-[0_16px_32px_-20px_rgba(15,23,42,0.55)]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Suggested tools</p>
          <div className="space-y-1">
            {suggestedTools.map((tool) => (
              <button
                key={`search-${tool.slug}`}
                type="button"
                onClick={() => goTo(`/tools/${tool.slug}`)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-900"
              >
                {tool.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </form>
  );
}
