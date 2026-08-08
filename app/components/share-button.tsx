"use client";

import { useState } from "react";
import { showToast } from "./toast";

type ShareButtonProps = {
  toolSlug?: string;
  toolName?: string;
  label?: string;
  className?: string;
  variant?: "icon" | "text";
};

export default function ShareButton({
  toolSlug,
  toolName,
  label,
  className = "",
  variant = "icon",
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const baseUrl = "https://pdf.idealsoftwaresolutions.com";
  const shareUrl = toolSlug
    ? `${baseUrl}/tools/${toolSlug}`
    : baseUrl;
  const shareTitle = toolName
    ? `${toolName} — WiserFiles`
    : "WiserFiles — Free Online PDF Tools";

  async function handleShare() {
    // Try Web Share API first (mobile)
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: toolName
            ? `Try ${toolName} on WiserFiles — fast, free, private PDF tools.`
            : "WiserFiles — fast, free, private PDF tools for merge, convert, OCR, compress, and more.",
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or API failed — fall through to clipboard
      }
    }

    // Desktop: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      showToast("Link copied!", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Could not copy link", "error");
    }
  }

  const iconElement = (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        d="M15 7h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-1M5 13H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M11 7l-2 3 2 3M9 10h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (variant === "text") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className={`inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-400 ${className}`}
        aria-label={label || `Share ${toolName || "WiserFiles"}`}
      >
        {iconElement}
        {label || "Share"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-cyan-700 dark:hover:bg-cyan-950 dark:hover:text-cyan-400 ${className}`}
      aria-label={label || `Share ${toolName || "WiserFiles"}`}
      title={copied ? "Copied!" : `Share ${toolName || "WiserFiles"}`}
    >
      {copied ? (
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4 text-emerald-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M5 10l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        iconElement
      )}
    </button>
  );
}
