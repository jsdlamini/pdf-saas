export type ToolProcessing =
  | "local" // the file never leaves the browser
  | "server" // the file is always uploaded to a route handler
  | "conditional"; // uploads only for specific input types (see the tool's comment)

export type ToolCategory =
  | "Organize"
  | "Optimize"
  | "Convert"
  | "Security"
  | "Edit"
  | "Sign";

// Distinct-but-professional colour per tool category (the iLovePDF/Overleaf
// look: colourful tool icons over a clean neutral surface).
export const CATEGORY_COLORS: Record<ToolCategory, string> = {
  Organize: "var(--tool-organise)",
  Optimize: "var(--tool-optimise)",
  Convert: "var(--tool-convert)",
  Security: "var(--tool-secure)",
  Edit: "var(--tool-edit)",
  Sign: "var(--tool-secure)", // sign lives under the Secure amber hue
};

export const CATEGORY_SOFT_BG: Record<ToolCategory, string> = {
  Organize: "var(--tool-organise-tint)",
  Optimize: "var(--tool-optimise-tint)",
  Convert: "var(--tool-convert-tint)",
  Security: "var(--tool-secure-tint)",
  Edit: "var(--tool-edit-tint)",
  Sign: "var(--tool-secure-tint)",
};

export type ToolItem = {
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  // Where the file is actually processed. "server" means the file is uploaded to
  // a route handler; "local" means it never leaves the browser; "conditional"
  // means only some accepted input types are uploaded. Source of truth for
  // "never uploaded" badges.
  processing: ToolProcessing;
  // When true the tool is hidden from grids/search/sitemap and its page shows a
  // "temporarily unavailable" notice instead of the workbench.
  disabled?: boolean;
};

export const TOOL_ITEMS: ToolItem[] = [
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    description: "Combine several PDFs into one.",
    category: "Organize",
    // PDF and image input stays local (pdf-lib); only office/text files
    // (.doc/.docx/.xls/.xlsx/.ppt/.pptx/.html/.htm/.txt) are uploaded to
    // /api/office-to-pdf (LibreOffice).
    processing: "conditional",
  },
  {
    slug: "convert-to-pdf",
    name: "Convert to PDF",
    description: "Word, Excel, PowerPoint, images, HTML — anything into a PDF.",
    category: "Convert",
    // Same conditional upload rule as merge-pdf: office/text files go to
    // /api/office-to-pdf; PDF and image input is processed locally.
    processing: "conditional",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    description: "Pull out pages or ranges as a new PDF.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "organize-pdf",
    name: "Organize PDF",
    description: "Drag pages into order, drop the ones you don't want.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    description: "Turn pages 90°, 180°, or 270°. Per-page if you need it.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "remove-pages",
    name: "Remove Pages",
    description: "Cut out pages you don't need.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "extract-pages",
    name: "Extract Pages",
    description: "Keep just a few pages, saved as their own file.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    description: "Make it smaller. Screen, eBook, or print quality.",
    category: "Optimize",
    processing: "local",
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "A PDF that won't open or renders wrong — this rebuilds it.",
    category: "Optimize",
    processing: "server",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    description: "Scanned pages aren't searchable until they're OCR'd. This adds a text layer so you can find and copy the words.",
    category: "Optimize",
    processing: "server",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    description: "Editable Word, with headings, lists and tables kept where they belong.",
    category: "Convert",
    processing: "server",
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    description: "Turns each page into a slide, title and bullets included.",
    category: "Convert",
    processing: "server",
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Real tables, not one giant text cell. Each table becomes its own sheet.",
    category: "Convert",
    processing: "server",
  },
  {
    slug: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Generate .tex source from a PDF.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Pages as JPGs. Pick the DPI, pick the pages.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    description: "Password-lock a PDF before you send it.",
    category: "Security",
    processing: "local",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    description: "Remove the password — for files you're allowed to open.",
    category: "Security",
    // Decryption happens server-side (qpdf); the password-protected file is
    // uploaded to /api/unlock-pdf.
    processing: "server",
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    description: "Black out text so it can't be recovered.",
    category: "Security",
    processing: "local",
  },
  {
    slug: "page-numbers",
    name: "Page Numbers",
    description: "Stamp page numbers on every page.",
    category: "Edit",
    processing: "local",
  },
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    description: "Click text to fix it. Add notes, shapes, images, a watermark.",
    category: "Edit",
    processing: "local",
    // Temporarily disabled while the in-browser editor is reworked. The tool
    // stays in the codebase; remove this flag to re-enable it.
    disabled: true,
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    description: "Trim margins, or drag a rectangle to keep just part of a page.",
    category: "Edit",
    processing: "local",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    description: "Draw or type your signature, then drop it where it goes.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "compare-pdf",
    name: "Compare PDF",
    description: "Two versions side by side, differences highlighted.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "scan-to-pdf",
    name: "Scan to PDF",
    description: "Phone photos or scans, into a clean PDF.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF-A",
    description: "The archival format, for documents that need to last.",
    category: "Optimize",
    // Runs server-side via Ghostscript -dPDFA=2 (real PDF/A-2b), with a
    // client-side pdf-lib conformance fallback.
    processing: "server",
  },
];

export const TOOL_CATEGORIES = [
  "Organize",
  "Optimize",
  "Convert",
  "Security",
  "Edit",
  "Sign",
] as const;

// Tools that are safe to surface in grids, search, and the sitemap (excludes
// temporarily disabled tools).
export const ACTIVE_TOOL_ITEMS = TOOL_ITEMS.filter((tool) => !tool.disabled);

export function getToolBySlug(slug: string) {
  return TOOL_ITEMS.find((tool) => tool.slug === slug);
}
