// Pure helpers for the LaTeX compiler: asset classification and diagnostics.

export function isBinaryAssetName(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|ico|pdf)$/i.test(path);
}

// EPS/SVG are text formats; only treat their content as base64 when it is not
// obviously XML/PostScript source.
export function looksLikeBase64(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("<") || trimmed.startsWith("%")) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);
}

// Extracts missing file paths from latexmk/pdflatex output, e.g.
//   "Missing input file 'images/ch1/foo.png'" or "File `...' not found".
export function diagnoseMissingFigures(details: string[]): string[] {
  const missing = new Set<string>();
  for (const detail of details) {
    for (const pattern of [
      /Missing input file ['"]([^'"]+)['"]/gi,
      /File [`']([^`']+)['`] not found/gi,
    ]) {
      for (const m of detail.matchAll(pattern)) {
        const p = m[1];
        if (p) missing.add(p);
      }
    }
  }
  return [...missing];
}
