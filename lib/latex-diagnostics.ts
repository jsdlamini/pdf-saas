// Pure helpers for the LaTeX compiler: asset classification and diagnostics.

export function stripDataUrlPrefix(content: string): string {
  return content.includes(",") && content.startsWith("data:")
    ? content.slice(content.indexOf(",") + 1)
    : content;
}

export function validMagicBytes(path: string, bytes: Buffer): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === "jpg" || ext === "jpeg") {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === "gif") {
    return bytes.length > 6 && bytes.subarray(0, 3).toString() === "GIF";
  }
  if (ext === "pdf") {
    return bytes.length > 5 && bytes.subarray(0, 5).toString() === "%PDF-";
  }
  // bmp, webp, ico, and others: no strict signature check.
  return true;
}

// Decodes an asset's base64 content back to binary, stripping any data: URL
// prefix and validating the magic bytes. Throws on a corrupt/invalid image so
// callers can surface a useful 400 instead of a late pdflatex failure.
export function decodeAssetContent(path: string, content: string): Buffer {
  const bytes = Buffer.from(stripDataUrlPrefix(content), "base64");
  if (!validMagicBytes(path, bytes)) {
    throw new Error(`Corrupt image: ${path} (unrecognised file signature).`);
  }
  return bytes;
}

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

// Extracts actionable LaTeX errors from a compiler log (e.g. the beamer
// "Environment timeline undefined" or a fontawesome missing-icon error) so the
// user sees the real problem instead of a raw log dump or latexmk's misleading
// "Missing input file .nav" noise. Handles both "! LaTeX Error: …" and
// "-file-line-error"'s "./file.tex:123: …" forms, deduped and capped.
export function diagnoseLatexErrors(logText: string): string[] {
  const errors = new Set<string>();
  for (const raw of logText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // ./CH1.tex:389: LaTeX Error: Environment timeline undefined.
    const fileLine = line.match(/^\.?\/?[^\s:]+:\d+:\s*(.+Error:.*)$/);
    if (fileLine) {
      errors.add(fileLine[1].trim());
      continue;
    }
    // ! LaTeX Error: …  /  ! Package fontawesome5 Error: …
    const bang = line.match(/^!\s*(.+Error:.*)$/);
    if (bang) {
      errors.add(bang[1].trim());
    }
  }
  return [...errors].slice(0, 10);
}

// Extracts missing *figure* paths from latexmk/pdflatex output, e.g.
//   "Missing input file 'images/ch1/foo.png'" or "File `...' not found".
// Only image/PDF extensions are reported — generated aux files (.nav, .aux,
// .toc, .out, .snm, .bbl) are never figures, and Beamer writes them on the
// first pass then reads them on the second.
export function diagnoseMissingFigures(details: string[]): string[] {
  const IMAGE_EXT = /\.(png|jpe?g|gif|pdf|eps|svg|bmp|webp|ico|tif?f)$/i;
  const missing = new Set<string>();
  for (const detail of details) {
    for (const pattern of [
      /Missing input file ['"]([^'"]+)['"]/gi,
      /File [`']([^`']+)['`] not found/gi,
    ]) {
      for (const m of detail.matchAll(pattern)) {
        const p = m[1];
        if (p && IMAGE_EXT.test(p)) missing.add(p);
      }
    }
  }
  return [...missing];
}
