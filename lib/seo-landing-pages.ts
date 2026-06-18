export type SeoLandingPage = {
  slug: string;
  title: string;
  description: string;
  toolSlug: string;
  keyword: string;
};

export const SEO_LANDING_PAGES: SeoLandingPage[] = [
  {
    slug: "merge-pdf-online",
    title: "Merge PDF Online",
    description: "Combine multiple PDF files into one document quickly in your browser.",
    toolSlug: "merge-pdf",
    keyword: "merge pdf online",
  },
  {
    slug: "split-pdf-online",
    title: "Split PDF Online",
    description: "Extract selected pages and split large PDFs into smaller files.",
    toolSlug: "split-pdf",
    keyword: "split pdf online",
  },
  {
    slug: "compress-pdf-online",
    title: "Compress PDF Online",
    description: "Reduce PDF file size while keeping good visual quality.",
    toolSlug: "compress-pdf",
    keyword: "compress pdf online",
  },
  {
    slug: "sign-pdf-online",
    title: "Sign PDF Online",
    description: "Add typed or drawn signatures to PDF files securely in your browser.",
    toolSlug: "sign-pdf",
    keyword: "sign pdf online",
  },
  {
    slug: "ocr-pdf-online",
    title: "OCR PDF Online",
    description: "Make scanned PDFs searchable with OCR text recognition.",
    toolSlug: "ocr-pdf",
    keyword: "ocr pdf online",
  },
  {
    slug: "pdf-to-word-online",
    title: "PDF to Word Online",
    description: "Convert PDF files into editable DOCX format directly in the browser.",
    toolSlug: "pdf-to-word",
    keyword: "pdf to word online",
  },
];

export function getSeoLandingBySlug(slug: string) {
  return SEO_LANDING_PAGES.find((page) => page.slug === slug);
}
