"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type PdfHighlight = { page: number; x: number; y: number } | null;

type Zoom = "fit-width" | "fit-page" | number;

export default function PdfPreview({
  url,
  onPageDoubleClick,
  highlight,
}: {
  url: string;
  onPageDoubleClick?: (page: number, xPt: number, yPt: number) => void;
  highlight?: PdfHighlight;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const pageMetasRef = useRef<{ canvas: HTMLCanvasElement; width: number; height: number }[]>([]);
  const tokenRef = useRef(0);
  const [zoom, setZoom] = useState<Zoom>("fit-width");
  const [scale, setScale] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState("");

  const computeScale = useCallback(async (pdf: PDFDocumentProxy, mode: Zoom) => {
    const container = containerRef.current;
    if (!container) return 1;
    if (mode === "fit-width" || mode === "fit-page") {
      const first = await pdf.getPage(1);
      const base = first.getViewport({ scale: 1 });
      if (mode === "fit-width") return Math.max(0.2, (container.clientWidth - 28) / base.width);
      return Math.max(0.2, Math.min((container.clientWidth - 28) / base.width, (container.clientHeight - 28) / base.height));
    }
    return Math.max(0.2, Math.min(4, mode));
  }, []);

  const render = useCallback(
    async (mode: Zoom) => {
      const pdf = pdfRef.current;
      const container = containerRef.current;
      if (!pdf || !container) return;
      const token = ++tokenRef.current;
      const s = await computeScale(pdf, mode);
      setScale(s);
      const dpr = window.devicePixelRatio || 1;
      container.innerHTML = "";
      pageMetasRef.current = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (token !== tokenRef.current) return;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: s * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        canvas.className = "studio-pdf-page";
        canvas.dataset.page = String(p);
        const ctx = canvas.getContext("2d");
        if (ctx) await page.render({ canvas, viewport }).promise;
        container.appendChild(canvas);
        pageMetasRef.current.push({ canvas, width: viewport.width / dpr, height: viewport.height / dpr });
      }
    },
    [computeScale]
  );

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const task = getDocument({ url });
        taskRef.current = task;
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setError("");
        await render(zoom);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load PDF.");
      }
    })();
    return () => {
      cancelled = true;
      tokenRef.current++;
      void taskRef.current?.destroy();
      taskRef.current = null;
      pdfRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (pdfRef.current) void render(zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (zoom === "fit-width" || zoom === "fit-page") void render(zoom);
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, render]);

  // Forward sync: double-click reports the clicked point in PDF points.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPageDoubleClick) return;
    const onDblClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("canvas.studio-pdf-page") as HTMLCanvasElement | null;
      if (!target) return;
      const page = Number(target.dataset.page || "1");
      const rect = target.getBoundingClientRect();
      const xCss = e.clientX - rect.left;
      const yCss = e.clientY - rect.top;
      const meta = pageMetasRef.current.find((m) => m.canvas === target);
      if (!meta) return;
      // meta.width is CSS px = pdfWidth * scale, so xPt = xCss / scale.
      onPageDoubleClick(page, xCss / scale, yCss / scale);
    };
    container.addEventListener("dblclick", onDblClick);
    return () => container.removeEventListener("dblclick", onDblClick);
  }, [onPageDoubleClick, scale]);

  // Inverse sync: scroll to the highlighted page/point and flash a marker.
  useEffect(() => {
    if (!highlight) return;
    const meta = pageMetasRef.current[highlight.page - 1];
    const container = containerRef.current;
    if (!meta || !container) return;
    meta.canvas.scrollIntoView({ behavior: "smooth", block: "start" });
    const x = highlight.x * scale;
    const y = highlight.y * scale;
    const marker = document.createElement("div");
    marker.className = "studio-pdf-marker";
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    // Position relative to the canvas's offset parent (the container).
    const canvasStyle = getComputedStyle(meta.canvas);
    meta.canvas.style.position = "relative";
    meta.canvas.appendChild(marker);
    window.setTimeout(() => marker.remove(), 1800);
    void canvasStyle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#3b3f46" }}>
      <div className="studio-pdf-toolbar">
        <button type="button" className={zoom === "fit-width" ? "studio-pdf-tool-btn active" : "studio-pdf-tool-btn"} onClick={() => setZoom("fit-width")}>Fit width</button>
        <button type="button" className={zoom === "fit-page" ? "studio-pdf-tool-btn active" : "studio-pdf-tool-btn"} onClick={() => setZoom("fit-page")}>Fit page</button>
        <span className="studio-pdf-tool-sep" />
        <button type="button" className="studio-pdf-tool-btn" onClick={() => setZoom(Math.max(0.2, scale - 0.1))}>−</button>
        <span className="studio-pdf-tool-pct">{Math.round(scale * 100)}%</span>
        <button type="button" className="studio-pdf-tool-btn" onClick={() => setZoom(Math.min(4, scale + 0.1))}>+</button>
        <span className="studio-pdf-tool-sep" />
        <span className="studio-pdf-tool-pct">{pageCount} page{pageCount === 1 ? "" : "s"}</span>
      </div>
      <div ref={containerRef} className="studio-pdf-scroll">
        {error ? <p className="studio-pdf-error">{error}</p> : null}
      </div>
    </div>
  );
}
