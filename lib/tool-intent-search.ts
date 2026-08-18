import type { ToolItem } from "@/lib/tools";

const TOOL_INTENT_KEYWORDS: Record<string, string[]> = {
  "merge-pdf": ["combine", "join", "append", "single pdf", "bundle"],
  "split-pdf": ["split", "separate", "divide", "extract pages"],
  "organize-pdf": ["reorder", "arrange", "organize", "sequence"],
  "remove-pages": ["remove page", "delete page", "drop page"],
  "extract-pages": ["extract", "pick pages", "keep selected pages"],
  "compress-pdf": ["shrink", "smaller", "reduce size", "optimize"],
  "ocr-pdf": ["scan", "scanned", "searchable", "text layer", "recognize text"],
  "pdf-to-word": ["editable doc", "docx", "word"],
  "pdf-to-powerpoint": ["slides", "ppt", "powerpoint"],
  "pdf-to-excel": ["table", "spreadsheet", "xlsx", "excel"],
  "pdf-to-latex": ["latex", "tex", "scientific paper", "academic manuscript"],
  "convert-to-pdf": ["docx to pdf", "word to pdf", "ppt to pdf", "slides to pdf", "sheet to pdf", "xlsx to pdf", "images to pdf", "photo to pdf", "camera to pdf", "html to pdf", "convert to pdf"],
  "pdf-to-jpg": ["images", "jpg", "export pages as image"],
  "protect-pdf": ["password", "secure", "encrypt", "lock"],
  "unlock-pdf": ["remove password", "unlock", "decrypt"],
  "redact-pdf": ["hide", "remove sensitive", "pii", "redact"],
  "sign-pdf": ["signature", "esign", "sign"],
  "compare-pdf": ["compare", "diff", "difference", "revision"],
  "scan-to-pdf": ["scan", "camera", "capture"],
};

export function rankToolsByIntent(tools: ToolItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tools.slice(0, 8).map((tool) => ({ tool, score: 0 }));

  const ranked = tools.map((tool) => {
    let score = 0;

    if (tool.name.toLowerCase() === normalized) score += 100;
    if (tool.slug.toLowerCase() === normalized) score += 95;

    if (tool.name.toLowerCase().includes(normalized)) score += 30;
    if (tool.slug.toLowerCase().includes(normalized)) score += 25;
    if (tool.description.toLowerCase().includes(normalized)) score += 18;

    const keywords = TOOL_INTENT_KEYWORDS[tool.slug] || [];
    for (const keyword of keywords) {
      if (normalized.includes(keyword) || keyword.includes(normalized)) {
        score += 14;
      }
    }

    return { tool, score };
  });

  return ranked
    .sort((a, b) => {
      if (b.score === a.score) return a.tool.name.localeCompare(b.tool.name);
      return b.score - a.score;
    })
    .slice(0, 8);
}
