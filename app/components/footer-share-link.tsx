"use client";

import { showToast } from "./toast";

export default function FooterShareLink() {
  async function handleClick() {
    const url = "https://pdf.idealsoftwaresolutions.com";
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied!", "success");
    } catch {
      showToast("Could not copy link", "error");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-cyan-400/30 transition hover:scale-105 hover:shadow-lg hover:shadow-cyan-400/50"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 8h8M8 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Share WiserFiles — copy link
    </button>
  );
}
