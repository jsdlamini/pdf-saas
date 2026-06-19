"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "wiserfiles-theme";

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const resolved = resolveInitialTheme();
    applyTheme(resolved);

    const frame = window.requestAnimationFrame(() => {
      setTheme(resolved);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function onToggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
      aria-label="Toggle color mode"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`h-5 w-5 transition-transform duration-200 ${theme === "dark" ? "rotate-12" : "rotate-0"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path
          d="M20 14.2A8.6 8.6 0 1 1 9.8 4a7.2 7.2 0 1 0 10.2 10.2Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
