export type ToolRuntime = "client" | "server";

export type ToolItem = {
  slug: string;
  name: string;
  description: string;
  category: "Organize" | "Optimize" | "Convert" | "Security" | "Edit" | "Sign";
  runtime: ToolRuntime;
};

export const TOOL_ITEMS: ToolItem[] = [
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    description: "Combine multiple PDFs into a single file.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    description: "Extract specific pages or ranges into a new PDF.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "organize-pdf",
    name: "Organize PDF",
    description: "Reorder, delete, and clean up pages before exporting.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    description: "Rotate all pages clockwise in one click.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "remove-pages",
    name: "Remove Pages",
    description: "Delete selected pages from a PDF.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "extract-pages",
    name: "Extract Pages",
    description: "Pull pages into a separate PDF export.",
    category: "Organize",
    runtime: "client",
  },
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    description: "Reduce file size while preserving readability.",
    category: "Optimize",
    runtime: "client",
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    description: "Recover damaged PDF structure and metadata.",
    category: "Optimize",
    runtime: "client",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    description: "Detect text from scanned pages to make files searchable.",
    category: "Optimize",
    runtime: "server",
  },
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert PDF pages into editable DOCX.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    description: "Turn PDF slides into editable PPTX.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from PDF into spreadsheet format.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "pdf-to-latex",
    name: "PDF to LaTeX",
    description: "Extract text from PDF and generate a LaTeX source file.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert DOC and DOCX into PDF format.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    description: "Convert PPT and PPTX to PDF.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Convert spreadsheets into printable PDF documents.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Export PDF pages as high quality images.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "jpg-to-pdf",
    name: "JPG to PDF",
    description: "Merge one or more images into a PDF document.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "images-to-pdf",
    name: "Images to PDF",
    description: "Convert one or multiple images (JPG, PNG, WEBP) into a single PDF.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "html-to-pdf",
    name: "HTML to PDF",
    description: "Render web pages into polished PDF output.",
    category: "Convert",
    runtime: "client",
  },
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    description: "Encrypt PDFs and apply access controls.",
    category: "Security",
    runtime: "client",
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    description: "Remove password restrictions from authorized files.",
    category: "Security",
    runtime: "client",
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    description: "Permanently remove sensitive text and regions.",
    category: "Security",
    runtime: "client",
  },
  {
    slug: "page-numbers",
    name: "Page Numbers",
    description: "Add footer page numbering automatically.",
    category: "Edit",
    runtime: "client",
  },
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    description: "Annotate and edit PDF text, marks, and shapes.",
    category: "Edit",
    runtime: "client",
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    description: "Trim margins and focus visible page area.",
    category: "Edit",
    runtime: "client",
  },
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    description: "Capture signatures and complete signing workflows.",
    category: "Sign",
    runtime: "client",
  },
  {
    slug: "compare-pdf",
    name: "Compare PDF",
    description: "Detect and highlight differences between revisions.",
    category: "Sign",
    runtime: "client",
  },
  {
    slug: "scan-to-pdf",
    name: "Scan to PDF",
    description: "Create PDF documents from camera capture or scans.",
    category: "Sign",
    runtime: "client",
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF-A",
    description: "Convert documents to archival PDF-A format.",
    category: "Optimize",
    runtime: "server",
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
