"use client";

import { useMemo, useState } from "react";

const MAX_SIZE_MB = 15;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

function humanFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function UploadDemo() {
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");

  const summary = useMemo(() => {
    if (!fileName) return "";
    return `Parsed ${fileName} and queued 3 smart actions: extract table, capture clauses, and summarize revisions.`;
  }, [fileName]);

  function resetState() {
    setError("");
    setStatus("idle");
  }

  function onFile(file: File | null) {
    if (!file) return;
    resetState();

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setError("Only PDF files are supported in this demo.");
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError(`File exceeds ${MAX_SIZE_MB} MB limit.`);
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setStatus("processing");

    window.setTimeout(() => {
      setStatus("done");
    }, 900);
  }

  return (
    <div className="space-y-3 rounded-3xl border border-slate-300/70 bg-white/85 p-5 shadow-[0_20px_80px_-50px_rgba(15,23,42,0.8)] backdrop-blur md:p-6">
      <label
        htmlFor="pdf-upload"
        className="group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-slate-500 hover:bg-slate-100"
      >
        <span className="font-display text-xl font-semibold text-slate-900">
          Drop a PDF here
        </span>
        <span className="mt-1 text-sm text-slate-600">
          or click to browse. Limit {MAX_SIZE_MB} MB.
        </span>
        <input
          id="pdf-upload"
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {fileName ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">File:</span> {fileName}
          </p>
          <p>
            <span className="font-semibold text-slate-900">Size:</span> {humanFileSize(fileSize)}
          </p>
        </div>
      ) : null}

      {status === "processing" ? (
        <p className="text-sm font-medium text-slate-700">Analyzing document...</p>
      ) : null}

      {status === "done" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
