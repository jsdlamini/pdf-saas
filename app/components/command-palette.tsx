"use client";

import { useEffect, useMemo, useRef } from "react";

type Command = {
  label: string;
  action: () => void;
};

export default function CommandPalette({
  query,
  setQuery,
  activeIndex,
  setActiveIndex,
  onClose,
  commands,
}: {
  query: string;
  setQuery: (q: string) => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onClose: () => void;
  commands: Command[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, setActiveIndex]);

  function runAt(index: number) {
    const cmd = filtered[index];
    if (cmd) {
      onClose();
      cmd.action();
    }
  }

  return (
    <div
      className="studio-palette-overlay"
      onClick={onClose}
    >
      <div
        className="studio-palette-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(Math.min(activeIndex + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(Math.max(activeIndex - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); runAt(activeIndex); }
          }}
          placeholder="Type a command…"
          className="studio-palette-input"
        />
        <div className="studio-palette-list">
          {filtered.length === 0 ? (
            <p className="studio-palette-empty">No matching commands</p>
          ) : filtered.map((cmd, i) => (
            <button
              key={cmd.label}
              type="button"
              className={`studio-palette-item ${i === activeIndex ? "studio-palette-item-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => runAt(i)}
            >
              {cmd.label}
            </button>
          ))}
        </div>
        <div className="studio-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
