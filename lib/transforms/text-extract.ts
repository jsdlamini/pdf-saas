// Text extraction helpers for office documents (DOCX/XLSX/PPTX previews).
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { decodeXmlText, sortSlidePaths } from "./helpers";

export async function buildOfficePreviewText(blob: Blob, mime: string) {
  const lowerMime = mime.toLowerCase();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  if (lowerMime.includes("wordprocessingml")) {
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "Could not extract DOCX content preview.";
    const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g));
    const text = matches.map((match) => decodeXmlText(match[1])).join(" ").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 12000) : "No readable DOCX text found in preview.";
  }

  if (lowerMime.includes("spreadsheetml")) {
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames.slice(0, 4)) {
      lines.push(`Sheet: ${sheetName}`);
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName], {
        header: 1,
      });
      rows.slice(0, 14).forEach((row) => lines.push(row.map((cell) => String(cell ?? "")).join(" | ")));
      lines.push("");
    }
    return lines.join("\n").trim() || "No readable XLSX rows found in preview.";
  }

  if (lowerMime.includes("presentationml")) {
    const slidePaths = sortSlidePaths(
      Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    );
    const lines: string[] = [];
    for (let i = 0; i < Math.min(slidePaths.length, 12); i += 1) {
      const xml = await zip.file(slidePaths[i])?.async("string");
      if (!xml) continue;
      const matches = Array.from(xml.matchAll(/<a:t>(.*?)<\/a:t>/g));
      const text = matches.map((match) => decodeXmlText(match[1])).join(" ").replace(/\s+/g, " ").trim();
      lines.push(`Slide ${i + 1}: ${text || "(no text)"}`);
    }
    return lines.join("\n") || "No readable PPTX text found in preview.";
  }

  return "Preview unavailable for this file type.";
}
