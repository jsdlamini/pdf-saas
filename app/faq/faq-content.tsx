"use client";

import { useState } from "react";

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is my file safe? What happens to my documents?",
    answer:
      "Your files are encrypted during transfer (TLS) and are processed either entirely in your browser or temporarily on our server for server-side tools like OCR. Files are automatically deleted immediately after processing. We never store, share, sell, or inspect your document contents. For browser-based tools, your files never leave your device at all.",
  },
  {
    question: "What's the maximum file size I can upload?",
    answer:
      "For browser-based tools, there is no hard limit beyond what your device memory can handle — typically up to several hundred megabytes works well. For server-side tools like OCR, the maximum upload size is 1 GB. We recommend splitting very large documents into smaller parts for the smoothest experience.",
  },
  {
    question: "Which tools work offline in my browser?",
    answer:
      "The vast majority of our tools run entirely in your browser using WebAssembly and JavaScript: Merge, Split, Compress, Rotate, Organize, Remove Pages, Extract Pages, Sign, Edit, Crop, Protect, Unlock, Redact, Page Numbers, Repair, Word to PDF, PowerPoint to PDF, Excel to PDF, JPG to PDF, Images to PDF, PDF to JPG, HTML to PDF, Compare PDF, and Scan to PDF. Once the page is loaded, these tools work without an internet connection.",
  },
  {
    question: "Which tools require the server?",
    answer:
      "Only OCR PDF and PDF to Word require server-side processing because they depend on OCRmyPDF and specialized conversion libraries that can't run in the browser. When the server is unreachable, browser tools continue to work normally, and server tools show a helpful offline message.",
  },
  {
    question: "What file formats are supported?",
    answer:
      "WiserFiles supports PDF, PNG, JPG, WebP, GIF, DOCX, PPTX, XLSX, and HTML as input formats. Most tools produce PDF output. Conversion tools can generate Word (DOCX), PowerPoint (PPTX), Excel (XLSX), JPG, and LaTeX (.tex) files. The drop zone and file picker will automatically accept compatible file types for each tool.",
  },
  {
    question: "Do I need to create an account?",
    answer:
      "No account is required. All tools can be used immediately without signing up. We offer optional authentication via Clerk for features like the Research Studio (LaTeX editor) and activity history, but the core PDF tools are fully accessible to everyone, always free.",
  },
  {
    question: "How do I use the Research Studio (LaTeX editor)?",
    answer:
      "The Research Studio is a collaborative LaTeX editor accessible from the header when signed in. It provides syntax highlighting, autocompletion, and live preview for academic and technical writing. Sign in via the account button in the top navigation bar, then click 'Research Studio' to open the LaTeX workspace. You can compose, edit, and export LaTeX documents directly in your browser.",
  },
  {
    question: "Can I use WiserFiles on my phone?",
    answer:
      "Yes! WiserFiles is fully responsive and works on iOS and Android devices. You can drop files, pick tools, and download results from any modern mobile browser. On supported devices, you can even install WiserFiles as a Progressive Web App (PWA) for a native-like experience with offline support for browser-based tools.",
  },
  {
    question: "What's the difference between Open Source and Proprietary software?",
    answer:
      "WiserFiles is built on a foundation of open-source libraries including pdf-lib, jsPDF, Mammoth, SheetJS, and OCRmyPDF — these are community-maintained tools anyone can inspect and contribute to. WiserFiles itself is proprietary software that combines these libraries into a polished, hosted workspace. This hybrid approach gives you the transparency and reliability of open-source processing with the convenience of a managed service.",
  },
  {
    question: "How do I report a problem or suggest a feature?",
    answer:
      "We welcome feedback! If you encounter a bug, have a feature idea, or want to suggest a new PDF tool, please reach out via our contact channels or open an issue on our repository. We actively maintain WiserFiles and aim to respond to reports within 48 hours. For urgent issues affecting server-side tools, check the status banner on the home page for real-time availability information.",
  },
];

export default function FaqContent() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function toggle(index: number) {
    setOpenIndex((current) => (current === index ? null : index));
  }

  return (
    <div className="space-y-3">
      {FAQ_ITEMS.map((faq, index) => {
        const isOpen = openIndex === index;
        return (
          <div
            key={index}
            className="rounded-2xl border border-slate-200 bg-white/85 transition hover:border-cyan-200 dark:border-slate-700 dark:bg-slate-900/85"
          >
            <button
              type="button"
              onClick={() => toggle(index)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              aria-expanded={isOpen}
            >
              <span className="pr-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {faq.question}
              </span>
              <svg
                viewBox="0 0 20 20"
                className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform duration-200 ${
                  isOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M5 8l5 5 5-5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isOpen ? (
              <div className="px-5 pb-4">
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {faq.answer}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
