export type RunReport = {
  runId: string;
  toolSlug: string;
  toolName: string;
  mode: "local" | "server" | "conditional";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  confidence: "high" | "medium" | "low";
  confidenceReason: string;
  transforms: string[];
  inputFiles: Array<{ name: string; size: number; sha256: string }>;
  outputFile?: { name: string; size: number; sha256: string; mime: string };
};

export async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashFile(file: File) {
  return sha256Hex(await file.arrayBuffer());
}

export async function hashBlob(blob: Blob) {
  return sha256Hex(await blob.arrayBuffer());
}

export function summarizeRunConfidence(toolSlug: string) {
  if (["ocr-pdf", "compare-pdf", "pdf-to-word", "pdf-to-powerpoint", "pdf-to-excel"].includes(toolSlug)) {
    return {
      confidence: "medium" as const,
      reason: "Output quality depends on source scan quality and extraction fidelity.",
    };
  }

  if (["compress-pdf", "repair-pdf", "protect-pdf", "unlock-pdf"].includes(toolSlug)) {
    return {
      confidence: "medium" as const,
      reason: "Transformation quality varies with file structure and image-heavy pages.",
    };
  }

  return {
    confidence: "high" as const,
    reason: "Operation is deterministic for the selected file set and options.",
  };
}

export function formatDurationMs(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
