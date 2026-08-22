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
  Organize: "#3B82F6",
  Optimize: "#F59E0B",
  Convert: "#10B981",
  Security: "#EF4444",
  Edit: "#8B5CF6",
  Sign: "#EC4899",
};

export const CATEGORY_SOFT_BG: Record<ToolCategory, string> = {
  Organize: "#EFF6FF",
  Optimize: "#FFF7ED",
  Convert: "#ECFDF5",
  Security: "#FEF2F2",
  Edit: "#F5F3FF",
  Sign: "#FDF2F8",
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
    description: "Combine multiple PDFs into a single file.",
    category: "Organize",
    // PDF and image input stays local (pdf-lib); only office/text files
    // (.doc/.docx/.xls/.xlsx/.ppt/.pptx/.html/.htm/.txt) are uploaded to
    // /api/office-to-pdf (LibreOffice).
    processing: "conditional",
  },
  {
    slug: "convert-to-pdf",
    name: "Convert to PDF",
    description: "Convert any mix of files — PDF, Word, Excel, PowerPoint, images, HTML — into one PDF.",
    category: "Convert",
    // Same conditional upload rule as merge-pdf: office/text files go to
    // /api/office-to-pdf; PDF and image input is processed locally.
    processing: "conditional",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    description: "Extract specific pages or ranges into a new PDF.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "organize-pdf",
    name: "Organize PDF",
    description: "Reorder, delete, and clean up pages before exporting.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    description: "Rotate all pages clockwise in one click.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "remove-pages",
    name: "Remove Pages",
    description: "Delete selected pages from a PDF.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "extract-pages",
    name: "Extract Pages",
    description: "Pull pages into a separate PDF export.",
    category: "Organize",
    processing: "local",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    description: "Reduce file size while preserving readability.",
    category: "Optimize",
    processing: "local",
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "Recover damaged PDF structure and metadata.",
    category: "Optimize",
    processing: "local",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    description: "Detect text from scanned pages to make files searchable.",
    category: "Optimize",
    processing: "server",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert PDF pages into editable DOCX.",
    category: "Convert",
    processing: "server",
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    description: "Turn PDF slides into editable PPTX.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from PDF into spreadsheet format.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Extract text from PDF and generate a LaTeX source file.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Export PDF pages as high quality images.",
    category: "Convert",
    processing: "local",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    description: "Encrypt PDFs and apply access controls.",
    category: "Security",
    processing: "local",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    description: "Remove password restrictions from authorized files.",
    category: "Security",
    // Decryption happens server-side (qpdf); the password-protected file is
    // uploaded to /api/unlock-pdf.
    processing: "server",
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    description: "Permanently remove sensitive text and regions.",
    category: "Security",
    processing: "local",
  },
  {
    slug: "page-numbers",
    name: "Page Numbers",
    description: "Add footer page numbering automatically.",
    category: "Edit",
    processing: "local",
  },
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    description: "Annotate and edit PDF text, marks, and shapes.",
    category: "Edit",
    processing: "local",
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    description: "Trim margins and focus visible page area.",
    category: "Edit",
    processing: "local",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    description: "Capture signatures and complete signing workflows.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "compare-pdf",
    name: "Compare PDF",
    description: "Detect and highlight differences between revisions.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "scan-to-pdf",
    name: "Scan to PDF",
    description: "Create PDF documents from camera capture or scans.",
    category: "Sign",
    processing: "local",
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF-A",
    description: "Convert documents to archival PDF-A format.",
    category: "Optimize",
    // Runs fully client-side via pdf-lib (sets metadata + embeds fonts), even
    // though this was previously labeled "server" in the old `runtime` field.
    processing: "local",
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
