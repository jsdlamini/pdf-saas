import type { ToolItem } from "@/lib/tools";

export type PdfTextSample = {
  sampledPages: number;
  pagesWithText: number;
  totalCharacters: number;
};

export type PreflightRecommendation = {
  toolSlug: string;
  reason: string;
  confidence: "high" | "medium";
};

export type PreflightSummary = {
  fileCount: number;
  totalBytes: number;
  estimatedInputType: "pdf" | "image" | "office" | "mixed";
  scanLikelihood: "high" | "medium" | "low" | "unknown";
  findings: string[];
  recommendations: PreflightRecommendation[];
};

function isPdfFile(file: File) {
  const lower = file.name.toLowerCase();
  return file.type === "application/pdf" || lower.endsWith(".pdf");
}

function isImageFile(file: File) {
  const lower = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp")
  );
}

function isOfficeFile(file: File) {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".doc") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".ppt") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".xlsx")
  );
}

function hasMultipleTypes(pdfCount: number, imageCount: number, officeCount: number) {
  const active = [pdfCount > 0, imageCount > 0, officeCount > 0].filter(Boolean).length;
  return active > 1;
}

function uniqueRecommendations(items: PreflightRecommendation[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.toolSlug)) return false;
    seen.add(item.toolSlug);
    return true;
  });
}

function addIfAvailable(
  recommendations: PreflightRecommendation[],
  tools: ToolItem[],
  toolSlug: string,
  reason: string,
  confidence: "high" | "medium"
) {
  if (tools.some((tool) => tool.slug === toolSlug)) {
    recommendations.push({ toolSlug, reason, confidence });
  }
}

export function analyzeDocumentSelection(
  files: File[],
  availableTools: ToolItem[],
  pdfTextSample: PdfTextSample | null
): PreflightSummary {
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const pdfCount = files.filter((file) => isPdfFile(file)).length;
  const imageCount = files.filter((file) => isImageFile(file)).length;
  const officeCount = files.filter((file) => isOfficeFile(file)).length;
  const findings: string[] = [];
  const recommendations: PreflightRecommendation[] = [];

  if (!fileCount) {
    return {
      fileCount: 0,
      totalBytes: 0,
      estimatedInputType: "mixed",
      scanLikelihood: "unknown",
      findings: ["No files selected yet."],
      recommendations: [],
    };
  }

  const largeFiles = files.filter((file) => file.size > 20 * 1024 * 1024).length;
  if (largeFiles > 0) {
    findings.push(`${largeFiles} large file(s) detected (>20 MB).`);
    addIfAvailable(
      recommendations,
      availableTools,
      "compress-pdf",
      "Compress first to reduce processing time and bandwidth.",
      "medium"
    );
  }

  if (pdfCount > 0 && imageCount > 0) {
    findings.push("Mixed PDF and image upload detected.");
  }

  if (fileCount > 1 && pdfCount === fileCount) {
    findings.push("Multiple PDFs uploaded. Possible merge workflow.");
    addIfAvailable(
      recommendations,
      availableTools,
      "merge-pdf",
      "You uploaded multiple PDFs; merge is likely the next step.",
      "high"
    );
  }

  if (imageCount > 0 && pdfCount === 0) {
    findings.push("Image-only input detected.");
    addIfAvailable(
      recommendations,
      availableTools,
      "jpg-to-pdf",
      "Convert images to a PDF before further processing.",
      "high"
    );
  }

  if (officeCount > 0 && pdfCount === 0 && fileCount === 1) {
    findings.push("Office document detected.");
    const fileName = files[0]?.name.toLowerCase() || "";
    if (fileName.endsWith(".doc") || fileName.endsWith(".docx")) {
      addIfAvailable(recommendations, availableTools, "word-to-pdf", "Convert Word to PDF first.", "high");
    } else if (fileName.endsWith(".ppt") || fileName.endsWith(".pptx")) {
      addIfAvailable(
        recommendations,
        availableTools,
        "powerpoint-to-pdf",
        "Convert PowerPoint to PDF first.",
        "high"
      );
    } else if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
      addIfAvailable(recommendations, availableTools, "excel-to-pdf", "Convert Excel to PDF first.", "high");
    }
  }

  let scanLikelihood: PreflightSummary["scanLikelihood"] = "unknown";
  if (pdfTextSample && pdfCount > 0) {
    const textCoverageRatio =
      pdfTextSample.sampledPages > 0 ? pdfTextSample.pagesWithText / pdfTextSample.sampledPages : 0;

    if (pdfTextSample.totalCharacters < 120 || textCoverageRatio < 0.35) {
      scanLikelihood = "high";
      findings.push("Low selectable text detected in sampled pages.");
      addIfAvailable(
        recommendations,
        availableTools,
        "ocr-pdf",
        "Detected scan-like PDF. OCR should improve searchability.",
        "high"
      );
    } else if (pdfTextSample.totalCharacters < 800 || textCoverageRatio < 0.65) {
      scanLikelihood = "medium";
      findings.push("Partial text layer detected in sampled pages.");
      addIfAvailable(
        recommendations,
        availableTools,
        "ocr-pdf",
        "Text layer looks incomplete. OCR may improve quality.",
        "medium"
      );
    } else {
      scanLikelihood = "low";
      findings.push("Strong text layer detected in sampled pages.");
    }
  }

  if (pdfCount === 1 && imageCount === 0 && officeCount === 0) {
    addIfAvailable(
      recommendations,
      availableTools,
      "compress-pdf",
      "Single PDF workflows often benefit from size optimization.",
      "medium"
    );
    addIfAvailable(
      recommendations,
      availableTools,
      "organize-pdf",
      "Reorder or clean up pages before exporting.",
      "medium"
    );
  }

  if (hasMultipleTypes(pdfCount, imageCount, officeCount)) {
    findings.push("Heterogeneous inputs may require a conversion step before editing.");
  }

  const estimatedInputType: PreflightSummary["estimatedInputType"] = hasMultipleTypes(
    pdfCount,
    imageCount,
    officeCount
  )
    ? "mixed"
    : pdfCount > 0
      ? "pdf"
      : imageCount > 0
        ? "image"
        : officeCount > 0
          ? "office"
          : "mixed";

  if (!findings.length) {
    findings.push("Input looks ready for processing.");
  }

  return {
    fileCount,
    totalBytes,
    estimatedInputType,
    scanLikelihood,
    findings,
    recommendations: uniqueRecommendations(recommendations),
  };
}
