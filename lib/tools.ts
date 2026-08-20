export type ToolRuntime = "client" | "server";

export type ToolProcessing = "local" | "server";

export type ToolItem = {
  slug: string;
  name: string;
  description: string;
  category: "Organize" | "Optimize" | "Convert" | "Security" | "Edit" | "Sign";
  runtime: ToolRuntime;
  // Where the file is actually processed. "server" means the file (or some of
  // the accepted inputs) is uploaded to a route handler; "local" means it never
  // leaves the browser. Source of truth for "never uploaded" badges.
  processing: ToolProcessing;
};

export const TOOL_ITEMS: ToolItem[] = [
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    description: "Combine multiple PDFs into a single file.",
    category: "Organize",
    runtime: "client",
    processing: "server",
  },
  {
    slug: "convert-to-pdf",
    name: "Convert to PDF",
    description: "Convert any mix of files — PDF, Word, Excel, PowerPoint, images, HTML — into one PDF.",
    category: "Convert",
    runtime: "client",
    processing: "server",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    description: "Extract specific pages or ranges into a new PDF.",
    category: "Organize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "organize-pdf",
    name: "Organize PDF",
    description: "Reorder, delete, and clean up pages before exporting.",
    category: "Organize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    description: "Rotate all pages clockwise in one click.",
    category: "Organize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "remove-pages",
    name: "Remove Pages",
    description: "Delete selected pages from a PDF.",
    category: "Organize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "extract-pages",
    name: "Extract Pages",
    description: "Pull pages into a separate PDF export.",
    category: "Organize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    description: "Reduce file size while preserving readability.",
    category: "Optimize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "Recover damaged PDF structure and metadata.",
    category: "Optimize",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    description: "Detect text from scanned pages to make files searchable.",
    category: "Optimize",
    runtime: "server",
    processing: "server",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert PDF pages into editable DOCX.",
    category: "Convert",
    runtime: "server",
    processing: "server",
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    description: "Turn PDF slides into editable PPTX.",
    category: "Convert",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from PDF into spreadsheet format.",
    category: "Convert",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Extract text from PDF and generate a LaTeX source file.",
    category: "Convert",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Export PDF pages as high quality images.",
    category: "Convert",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    description: "Encrypt PDFs and apply access controls.",
    category: "Security",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    description: "Remove password restrictions from authorized files.",
    category: "Security",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    description: "Permanently remove sensitive text and regions.",
    category: "Security",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "page-numbers",
    name: "Page Numbers",
    description: "Add footer page numbering automatically.",
    category: "Edit",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    description: "Annotate and edit PDF text, marks, and shapes.",
    category: "Edit",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    description: "Trim margins and focus visible page area.",
    category: "Edit",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    description: "Capture signatures and complete signing workflows.",
    category: "Sign",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "compare-pdf",
    name: "Compare PDF",
    description: "Detect and highlight differences between revisions.",
    category: "Sign",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "scan-to-pdf",
    name: "Scan to PDF",
    description: "Create PDF documents from camera capture or scans.",
    category: "Sign",
    runtime: "client",
    processing: "local",
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF-A",
    description: "Convert documents to archival PDF-A format.",
    category: "Optimize",
    runtime: "server",
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

export function getToolBySlug(slug: string) {
  return TOOL_ITEMS.find((tool) => tool.slug === slug);
}
