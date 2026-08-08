"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "info";

export type ToastEntry = {
  id: string;
  message: string;
  variant: ToastVariant;
  exiting: boolean;
};

type ToastEventDetail = {
  message: string;
  variant: ToastVariant;
};

const TOAST_EVENT = "wiserfiles-toast";

export function showToast(message: string, variant: ToastVariant = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastEventDetail>(TOAST_EVENT, {
      detail: { message, variant },
    })
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) =>
      current.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 320);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastEventDetail>).detail;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setToasts((current) => [
        ...current,
        { id, message: detail.message, variant: detail.variant, exiting: false },
      ]);

      const timer = setTimeout(() => {
        dismissToast(id);
      }, 4000);
      timersRef.current.set(id, timer);
    };

    window.addEventListener(TOAST_EVENT, handler);
    return () => {
      window.removeEventListener(TOAST_EVENT, handler);
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, [dismissToast]);

  if (!toasts.length) return null;

  const variantStyles: Record<ToastVariant, string> = {
    success:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700",
    error:
      "border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-700",
    info: "border-cyan-300 bg-cyan-50 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200 dark:border-cyan-700",
  };

  const variantIcons: Record<ToastVariant, string> = {
    success:
      '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 10l3 3 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>',
    error:
      '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round"/></svg>',
    info: '<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="6"/><path d="M10 7v5M10 13v1" strokeLinecap="round"/></svg>',
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 right-4 z-[100] flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-sm ${toast.exiting ? "toast-exit" : "toast-enter"} ${variantStyles[toast.variant]}`}
        >
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
            dangerouslySetInnerHTML={{ __html: variantIcons[toast.variant] }}
          />
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="ml-1 shrink-0 rounded-full p-0.5 opacity-60 transition hover:opacity-100"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
