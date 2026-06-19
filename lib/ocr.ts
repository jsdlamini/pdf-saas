export type OcrLanguageOption = {
  value: string;
  label: string;
  hint: string;
  packageName: string;
};

export const MAX_OCR_UPLOAD_BYTES = 1024 * 1024 * 1024;

export const OCR_LANGUAGE_OPTIONS: OcrLanguageOption[] = [
  { value: "eng", label: "English", hint: "Best for English-language scans.", packageName: "tesseract-ocr-eng" },
  { value: "deu", label: "German", hint: "For German documents and mixed Latin text.", packageName: "tesseract-ocr-deu" },
  { value: "fra", label: "French", hint: "For French scans with accented Latin text.", packageName: "tesseract-ocr-fra" },
  { value: "spa", label: "Spanish", hint: "For Spanish documents and Latin-based layouts.", packageName: "tesseract-ocr-spa" },
  { value: "ita", label: "Italian", hint: "For Italian-language scans and invoices.", packageName: "tesseract-ocr-ita" },
  { value: "por", label: "Portuguese", hint: "For Portuguese forms and reports.", packageName: "tesseract-ocr-por" },
  { value: "nld", label: "Dutch", hint: "For Dutch documents and administrative scans.", packageName: "tesseract-ocr-nld" },
  { value: "pol", label: "Polish", hint: "For Polish documents with extended Latin characters.", packageName: "tesseract-ocr-pol" },
];

export const SUPPORTED_OCR_LANGUAGES = new Set(OCR_LANGUAGE_OPTIONS.map((option) => option.value));