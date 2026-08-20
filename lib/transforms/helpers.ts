// General-purpose helpers shared by the tool transforms.
import { rgb } from "pdf-lib";

export const LEGACY_PDF_WATERMARK_MARKERS: number[][] = [
  [80, 65, 80, 69, 82, 84, 82, 65, 73, 76, 32, 80, 68, 70, 32, 87, 79, 82, 75, 83, 80, 65, 67, 69],
  [80, 65, 80, 69, 82, 84, 82, 65, 73, 76],
];

export function toUpperAsciiByte(value: number) {
  if (value >= 97 && value <= 122) return value - 32;
  return value;
}

export function replaceAsciiMarker(bytes: Uint8Array, markerBytes: number[]) {
  if (!markerBytes.length) return false;

  let replaced = false;
  for (let index = 0; index <= bytes.length - markerBytes.length; index += 1) {
    if (toUpperAsciiByte(bytes[index]) !== markerBytes[0]) continue;

    let matches = true;
    for (let cursor = 1; cursor < markerBytes.length; cursor += 1) {
      if (toUpperAsciiByte(bytes[index + cursor]) !== markerBytes[cursor]) {
        matches = false;
        break;
      }
    }

    if (!matches) continue;
    bytes.fill(0x20, index, index + markerBytes.length);
    replaced = true;
    index += markerBytes.length - 1;
  }

  return replaced;
}

export function isFileCompatibleForTool(toolSlug: string, file: File) {
  const lower = file.name.toLowerCase();
  if (toolSlug === "convert-to-pdf" || toolSlug === "merge-pdf") {
    return (
      file.type === "application/pdf" || lower.endsWith(".pdf") ||
      file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(lower) ||
      /\.(docx?|xlsx?|pptx?|html?|txt)$/.test(lower)
    );
  }
  if (toolSlug === "images-to-pdf" || toolSlug === "images-to-pdf" || toolSlug === "scan-to-pdf") {
    return file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/.test(lower);
  }
  if (toolSlug === "word-to-pdf") {
    return /\.(doc|docx)$/.test(lower);
  }
  if (toolSlug === "powerpoint-to-pdf") {
    return /\.(ppt|pptx)$/.test(lower);
  }
  if (toolSlug === "excel-to-pdf") {
    return /\.(xls|xlsx)$/.test(lower);
  }
  if (toolSlug === "html-to-pdf") {
    return /\.(html?|txt)$/.test(lower);
  }
  return file.type === "application/pdf" || lower.endsWith(".pdf");
}

export function dataUrlToUint8Array(dataUrl: string) {
  return fetch(dataUrl)
    .then((response) => response.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer));
}

export function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

export async function readAsArrayBuffer(file: File) {
  const buffer = await file.arrayBuffer();
  // Return a copy to prevent ArrayBuffer detachment issues
  // when the buffer is shared across multiple pdfjs-dist calls
  return buffer.slice(0);
}

export function readAsText(file: File) {
  return file.text();
}

export function asPdfBlob(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

export function normalizeFileName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

export function getFileNameFromDisposition(header: string | null) {
  if (!header) return null;

  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function splitLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseRanges(value: string, maxPage: number) {
  const picks = new Set<number>();
  const chunks = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    if (chunk.includes("-")) {
      const [startRaw, endRaw] = chunk.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        throw new Error(`Invalid range: ${chunk}`);
      }
      for (let page = start; page <= end; page += 1) {
        if (page <= maxPage) picks.add(page);
      }
    } else {
      const page = Number(chunk);
      if (!Number.isInteger(page) || page <= 0) {
        throw new Error(`Invalid page index: ${chunk}`);
      }
      if (page <= maxPage) picks.add(page);
    }
  }

  return Array.from(picks).sort((a, b) => a - b);
}

export function compactPageSequence(pages: number[]) {
  if (!pages.length) return "";

  const chunks: string[] = [];
  let index = 0;

  while (index < pages.length) {
    const start = pages[index];
    let end = start;
    let cursor = index;

    while (cursor + 1 < pages.length && pages[cursor + 1] === end + 1) {
      end = pages[cursor + 1];
      cursor += 1;
    }

    if (end >= start + 2) {
      chunks.push(`${start}-${end}`);
    } else if (end === start + 1) {
      chunks.push(String(start));
      chunks.push(String(end));
    } else {
      chunks.push(String(start));
    }

    index = cursor + 1;
  }

  return chunks.join(",");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return rgb(0.06, 0.07, 0.09);
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export function decodeXmlText(value: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<root>${value}</root>`, "application/xml");
  return doc.documentElement.textContent ?? value;
}

export function escapeLatex(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([{}$&#_%])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

export function pagesToLatex(pages: string[], sourceFileName: string) {
  const body = pages
    .map((page, index) => {
      const text = escapeLatex(page.replace(/\s+/g, " ").trim() || `(No text detected on page ${index + 1})`);
      return `\\section*{Page ${index + 1}}\n${text}`;
    })
    .join("\n\n");

  const safeSource = escapeLatex(sourceFileName);
  return [
    "\\documentclass[11pt]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{lmodern}",
    "\\usepackage{microtype}",
    "\\title{Converted PDF Source}",
    `\\author{Generated from ${safeSource}}`,
    "\\date{\\today}",
    "\\begin{document}",
    "\\maketitle",
    "\\tableofcontents",
    "\\clearpage",
    body,
    "\\end{document}",
    "",
  ].join("\n");
}

export function sortSlidePaths(paths: string[]) {
  return paths.sort((a, b) => {
    const first = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    const second = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? "0");
    return first - second;
  });
}
