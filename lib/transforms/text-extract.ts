// Text extraction helpers for office documents (DOCX/XLSX/PPTX previews).
import JSZip from "jszip";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import { decodeXmlText, sortSlidePaths } from "./helpers";

// Strip the handful of tags/attributes that must never reach innerHTML even
// though mammoth already escapes text runs. Defense in depth, not a parser.
function sanitizeMammothHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

// Semantic HTML preview for DOCX via mammoth (headings, lists, paragraphs).
// Returns null when the mime is not WordprocessingML.
export async function buildOfficePreviewHtml(blob: Blob, mime: string): Promise<string | null> {
  if (!mime.toLowerCase().includes("wordprocessingml")) return null;
  const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
  const html = result.value || "<p>No content extracted from Word file.</p>";
  return sanitizeMammothHtml(html);
}

function extractDocxParagraphs(xml: string): string {
  // Preserve <w:p> boundaries as paragraph breaks instead of joining every
  // text run with spaces (which destroyed all structure).
  const paragraphs = xml.split(/<\/?w:p(?:\s[^>]*)?>/gi).map((chunk) => {
    const matches = Array.from(chunk.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    return matches.map((m) => decodeXmlText(m[1])).join("").trim();
  });
  return paragraphs.filter(Boolean).join("\n\n");
}

export async function buildOfficePreviewText(blob: Blob, mime: string) {
  const lowerMime = mime.toLowerCase();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  if (lowerMime.includes("wordprocessingml")) {
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "Could not extract DOCX content preview.";
    const text = extractDocxParagraphs(xml);
    return text ? text.slice(0, 12000) : "No readable DOCX text found in preview.";
  }

  if (lowerMime.includes("spreadsheetml")) {
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const lines: string[] = [];
    const sheetNames = workbook.SheetNames.slice(0, 4);
    for (const sheetName of sheetNames) {
      lines.push(`Sheet: ${sheetName}`);
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName], {
        header: 1,
      });
      rows.slice(0, 14).forEach((row) => lines.push(row.map((cell) => String(cell ?? "")).join(" | ")));
      lines.push("");
    }
    if (workbook.SheetNames.length > sheetNames.length) {
      lines.push(`… showing ${sheetNames.length} of ${workbook.SheetNames.length} sheets`);
    }
    return lines.join("\n").trim() || "No readable XLSX rows found in preview.";
  }

  if (lowerMime.includes("presentationml")) {
    const slidePaths = sortSlidePaths(
      Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    );
    const lines: string[] = [];
    const shown = Math.min(slidePaths.length, 12);
    for (let i = 0; i < shown; i += 1) {
      const xml = await zip.file(slidePaths[i])?.async("string");
      if (!xml) continue;
      const matches = Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g));
      const text = matches.map((match) => decodeXmlText(match[1])).join(" ").replace(/\s+/g, " ").trim();
      lines.push(`Slide ${i + 1}: ${text || "(no text)"}`);
    }
    if (slidePaths.length > shown) {
      lines.push(`… showing ${shown} of ${slidePaths.length} slides`);
    }
    return lines.join("\n") || "No readable PPTX text found in preview.";
  }

  return "Preview unavailable for this file type.";
}
