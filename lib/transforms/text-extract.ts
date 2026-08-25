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

// Semantic HTML preview for office outputs (DOCX/XLSX/PPTX). DOCX uses
// mammoth; XLSX renders as real HTML tables; PPTX renders as slide cards.
// Returns null when the mime is not a supported office type.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function buildXlsxPreviewHtml(blob: Blob): Promise<string> {
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
  const sheetNames = workbook.SheetNames.slice(0, 3);
  let html = "";
  for (const sheetName of sheetNames) {
    const rows = XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], { header: 1 });
    const tableRows = rows
      .slice(0, 20)
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`)
      .join("");
    html += `<div class="office-sheet"><h4>${escapeHtml(sheetName)}</h4><table><tbody>${tableRows}</tbody></table></div>`;
  }
  if (workbook.SheetNames.length > sheetNames.length) {
    html += `<p class="office-note">Showing ${sheetNames.length} of ${workbook.SheetNames.length} sheets</p>`;
  }
  return html || "<p>No readable XLSX content.</p>";
}

async function buildPptxPreviewHtml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const slidePaths = sortSlidePaths(
    Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
  );
  const shown = Math.min(slidePaths.length, 12);
  let html = "";
  for (let i = 0; i < shown; i += 1) {
    const xml = await zip.file(slidePaths[i])?.async("string");
    const matches = xml ? Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g)) : [];
    const lines = matches.map((m) => decodeXmlText(m[1]).trim()).filter(Boolean);
    const title = lines[0] || `Slide ${i + 1}`;
    const bullets = lines.slice(1, 8).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    html += `<div class="office-slide"><h4>${escapeHtml(title)}</h4>${bullets ? `<ul>${bullets}</ul>` : ""}</div>`;
  }
  if (slidePaths.length > shown) html += `<p class="office-note">Showing ${shown} of ${slidePaths.length} slides</p>`;
  return html || "<p>No readable PPTX content.</p>";
}

export async function buildOfficePreviewHtml(blob: Blob, mime: string): Promise<string | null> {
  const lowerMime = mime.toLowerCase();
  if (lowerMime.includes("wordprocessingml")) {
    const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    const html = result.value || "<p>No content extracted from Word file.</p>";
    return sanitizeMammothHtml(html);
  }
  if (lowerMime.includes("spreadsheetml")) return buildXlsxPreviewHtml(blob);
  if (lowerMime.includes("presentationml")) return buildPptxPreviewHtml(blob);
  return null;
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
