// Pure helpers for building project entry paths and classifying uploaded files.
// Extracted so the upload path-joining logic is unit-testable without a browser.

export function sanitizeUploadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Join a target folder (may be "", "/", or "images/ch1/" — folders are stored
// with a trailing slash) and a file name into one project-relative path. The
// root case ("") must yield just the file name.
export function joinUploadPath(folder: string, name: string): string {
  const safe = sanitizeUploadName(name);
  const norm = folder.replace(/\/+$/, "");
  return norm ? `${norm}/${safe}` : safe;
}

export function isRasterImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|ico)$/i.test(name);
}

export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

// Raster images and PDFs must travel as base64; everything else is read as text.
export function classifyUpload(name: string): "image" | "pdf" | "text" {
  if (isRasterImageName(name)) return "image";
  if (isPdfName(name)) return "pdf";
  return "text";
}
