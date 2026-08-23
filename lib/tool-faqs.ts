// Real, tool-specific FAQs instead of a name-swapped template. Questions are
// driven by each tool's actual `processing` mode (where the file is handled)
// plus a per-tool description of what the output looks like.
import type { ToolItem } from "./tools";

export type ToolFaq = {
  question: string;
  answer: string;
};

const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  "merge-pdf": "a single PDF with your pages combined in the order you chose.",
  "convert-to-pdf": "one PDF containing your files, each converted page by page.",
  "split-pdf": "separate PDF files, one per range or page you selected.",
  "organize-pdf": "the same document with pages reordered or removed as you arranged them.",
  "rotate-pdf": "your PDF with the chosen pages turned to the orientation you set.",
  "remove-pages": "your PDF with the selected pages taken out.",
  "extract-pages": "a new PDF containing only the pages you picked.",
  "compress-pdf": "a smaller PDF that keeps the same pages and layout.",
  "repair-pdf": "a rebuilt PDF with a cleaned-up internal structure.",
  "ocr-pdf": "a searchable PDF with a text layer added over the scanned image.",
  "pdf-to-word": "an editable Word document that preserves headings, lists, and tables.",
  "pdf-to-powerpoint": "a PowerPoint file with your PDF's pages as editable slides.",
  "pdf-to-excel": "a spreadsheet with your PDF's tables extracted into rows and columns.",
  "pdf-to-latex": "LaTeX source you can open in Research Studio or any TeX editor.",
  "pdf-to-jpg": "JPG images, one per page, in a downloadable folder.",
  "protect-pdf": "an encrypted PDF that requires the password you set.",
  "unlock-pdf": "an unlocked PDF with the password protection removed.",
  "redact-pdf": "a PDF with the marked regions permanently blacked out.",
  "page-numbers": "your PDF with page numbers stamped where you placed them.",
  "edit-pdf": "your PDF with text, images, and fields edited in place.",
  "crop-pdf": "your PDF with the page margins trimmed to the size you set.",
  "sign-pdf": "your PDF with your signature placed on the pages you chose.",
  "compare-pdf": "a side-by-side view and a text report of the differences.",
  "scan-to-pdf": "a clean PDF built from your scanned images.",
  "pdf-to-pdfa": "a PDF/A archive file that meets long-term preservation standards.",
};

function offlineAnswer(tool: ToolItem): string {
  if (tool.processing === "local") {
    return `Yes. ${tool.name} runs entirely in your browser, so it works without an internet connection.`;
  }
  if (tool.processing === "conditional") {
    return `Yes for PDF and image files, which are handled in your browser. Office and text formats (Word, Excel, PowerPoint, HTML) need a connection.`;
  }
  return `No. ${tool.name} needs our servers to process the file, so it requires an internet connection.`;
}

function dataAnswer(tool: ToolItem): string {
  if (tool.processing === "local") {
    return `Nothing is uploaded. Your file stays on your device and is processed entirely in your browser.`;
  }
  if (tool.processing === "conditional") {
    return `PDF and image files stay on your device. Office and text files are sent to our servers, processed in isolated temporary storage, and deleted as soon as the result is returned.`;
  }
  return `Your file is sent to our servers, processed in isolated temporary storage, and deleted as soon as the result is returned.`;
}

function sizeAnswer(tool: ToolItem): string {
  if (tool.processing === "local") {
    return `There's no fixed limit — ${tool.name} never uploads the file, so the practical ceiling is your device's memory. Very large files (hundreds of pages) may take a moment longer.`;
  }
  return `Server-processed files are limited to 100 MB. Browser-only formats have no fixed limit.`;
}

function outputAnswer(tool: ToolItem): string {
  return (
    OUTPUT_DESCRIPTIONS[tool.slug] ??
    `a processed ${tool.category.toLowerCase()} document ready to download.`
  );
}

export function getToolFaqs(tool: ToolItem): ToolFaq[] {
  return [
    {
      question: `Does ${tool.name} work offline?`,
      answer: offlineAnswer(tool),
    },
    {
      question: `What happens to my file?`,
      answer: dataAnswer(tool),
    },
    {
      question: `What's the largest file I can use?`,
      answer: sizeAnswer(tool),
    },
    {
      question: `What does the output look like?`,
      answer: outputAnswer(tool),
    },
  ];
}
