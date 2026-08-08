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
      className="footer-link text-left"
    >
      Share WiserFiles
    </button>
  );
}
