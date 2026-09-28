"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, Util, type PDFDocumentProxy } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type PdfHighlight = { page: number; x: number; y: number } | null;

type Zoom = "fit-width" | "fit-page" | number;

export default function PdfPreview({
  url,
  onPageDoubleClick,
  onPageClick,
  highlight,
}: {
  url: string;
  onPageDoubleClick?: (page: number, xPt: number, yPt: number) => void;
  onPageClick?: (page: number, xPt: number, yPt: number) => void;
  highlight?: PdfHighlight;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const pageMetasRef = useRef<
    { canvas: HTMLCanvasElement; width: number; height: number; wrapper: HTMLDivElement; spans: { el: HTMLSpanElement; text: string }[] }[]
  >([]);
  const tokenRef = useRef(0);
  const lastScaleRef = useRef(0);
  const findQueryRef = useRef("");
  const findHitsRef = useRef<HTMLSpanElement[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit-width");
  const [scale, setScale] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findTotal, setFindTotal] = useState(0);
  const [findIndex, setFindIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  const computeScale = useCallback(async (pdf: PDFDocumentProxy, mode: Zoom) => {
    const container = containerRef.current;
    if (!container) return 1;
    if (mode === "fit-width" || mode === "fit-page") {
      const first = await pdf.getPage(1);
      const base = first.getViewport({ scale: 1 });
      // Use border-box dims (stable regardless of scrollbar) to avoid a
      // render -> scrollbar -> resize -> render flicker loop.
      const rect = container.getBoundingClientRect();
      if (mode === "fit-width") return Math.max(0.2, (rect.width - 28) / base.width);
      return Math.max(0.2, Math.min((rect.width - 28) / base.width, (rect.height - 28) / base.height));
    }
    return Math.max(0.2, Math.min(4, mode));
  }, []);

  // Find-in-PDF: highlight matching text-layer spans and jump between hits.
  const applyFind = useCallback((q: string) => {
    for (const el of findHitsRef.current) {
      el.classList.remove("studio-pdf-find-hit", "studio-pdf-find-active");
    }
    findHitsRef.current = [];
    const needle = q.trim().toLowerCase();
    if (!needle) {
      setFindTotal(0);
      setFindIndex(0);
      return;
    }
    const hits: HTMLSpanElement[] = [];
    for (const meta of pageMetasRef.current) {
      for (const s of meta.spans) {
        if (s.text.includes(needle)) {
          s.el.classList.add("studio-pdf-find-hit");
          hits.push(s.el);
        }
      }
    }
    findHitsRef.current = hits;
    setFindTotal(hits.length);
    if (hits.length) {
      hits[0].classList.add("studio-pdf-find-active");
      hits[0].scrollIntoView({ behavior: "smooth", block: "center" });
      setFindIndex(0);
    } else {
      setFindIndex(0);
    }
  }, []);

  const activateFind = useCallback((index: number) => {
    const hits = findHitsRef.current;
    if (!hits.length) return;
    const clamped = ((index % hits.length) + hits.length) % hits.length;
    for (const el of hits) el.classList.remove("studio-pdf-find-active");
    const el = hits[clamped];
    el.classList.add("studio-pdf-find-active");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFindIndex(clamped);
  }, []);

  const goToPage = useCallback((n: number) => {
    const meta = pageMetasRef.current[n - 1];
    if (!meta) return;
    meta.wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(n);
    setPageInput(String(n));
  }, []);

  const render = useCallback(
    async (mode: Zoom) => {
      const pdf = pdfRef.current;
      const container = containerRef.current;
      if (!pdf || !container) return;
      const token = ++tokenRef.current;
      const s = await computeScale(pdf, mode);
      lastScaleRef.current = s;
      setScale(s);
      const dpr = window.devicePixelRatio || 1;
      container.innerHTML = "";
      pageMetasRef.current = [];
      findHitsRef.current = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        if (token !== tokenRef.current) return;
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: s * dpr });
        const cssW = viewport.width / dpr;
        const cssH = viewport.height / dpr;

        const wrapper = document.createElement("div");
        wrapper.className = "studio-pdf-page";
        wrapper.style.position = "relative";
        wrapper.style.width = `${cssW}px`;
        wrapper.style.height = `${cssH}px`;
        wrapper.dataset.page = String(p);

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        const ctx = canvas.getContext("2d");
        if (ctx) await page.render({ canvas, viewport }).promise;
        wrapper.appendChild(canvas);

        // Selectable + copyable text layer (transparent, positioned over the canvas).
        const textLayer = document.createElement("div");
        textLayer.className = "textLayer";
        wrapper.appendChild(textLayer);
        const spans: { el: HTMLSpanElement; text: string }[] = [];
        try {
          const textContent = await page.getTextContent();
          const cssViewport = page.getViewport({ scale: s });
          for (const item of textContent.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
            if (!item || !item.str || !item.transform) continue;
            const tx = Util.transform(cssViewport.transform, item.transform);
            const angle = Math.atan2(tx[1], tx[0]);
            const fontHeight = Math.hypot(tx[2], tx[3]);
            if (fontHeight <= 0) continue;
            const span = document.createElement("span");
            span.textContent = item.str + (item.hasEOL ? "\n" : "");
            span.style.left = `${tx[4]}px`;
            span.style.top = `${tx[5] - fontHeight}px`;
            span.style.fontSize = `${fontHeight}px`;
            if (angle !== 0) {
              span.style.transformOrigin = "0% 0%";
              span.style.transform = `rotate(${angle}rad)`;
            }
            textLayer.appendChild(span);
            spans.push({ el: span, text: item.str.toLowerCase() });
          }
        } catch { /* text layer is best-effort */ }

        container.appendChild(wrapper);
        pageMetasRef.current.push({ canvas, width: cssW, height: cssH, wrapper, spans });
      }
      // Re-apply an active search after a re-render (zoom or recompile).
      if (findQueryRef.current.trim()) applyFind(findQueryRef.current);
    },
    [computeScale, applyFind]
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
        // Preserve the scroll position across a re-compile so the user isn't
        // yanked back to page 1 when the PDF URL changes.
        const container = containerRef.current;
        const prevScroll = container?.scrollTop ?? 0;
        await render(zoom);
        if (container) container.scrollTop = prevScroll;
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
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (zoom !== "fit-width" && zoom !== "fit-page") return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        void (async () => {
          const pdf = pdfRef.current;
          if (!pdf) return;
          const next = await computeScale(pdf, zoom);
          // Only re-render when the scale actually changes (a scrollbar
          // appearing/disappearing changes the content box but not the border
          // box we measure against, so this stops the render flicker loop).
          if (Math.abs(next - lastScaleRef.current) > 0.01) void render(zoom);
        })();
      }, 150);
    });
    ro.observe(container);
    return () => {
      if (timeout) clearTimeout(timeout);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, render, computeScale]);

  // Forward sync: double-click reports the clicked point in PDF points.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPageDoubleClick) return;
    const onDblClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("div.studio-pdf-page") as HTMLDivElement | null;
      if (!target) return;
      const page = Number(target.dataset.page || "1");
      const rect = target.getBoundingClientRect();
      const xCss = e.clientX - rect.left;
      const yCss = e.clientY - rect.top;
      // Wrapper CSS width = pdfWidth * scale, so xPt = xCss / scale.
      onPageDoubleClick(page, xCss / scale, yCss / scale);
    };
    container.addEventListener("dblclick", onDblClick);
    return () => container.removeEventListener("dblclick", onDblClick);
  }, [onPageDoubleClick, scale]);

  // Single click reports the anchor point for the <- jump button.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPageClick) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest("div.studio-pdf-page") as HTMLDivElement | null;
      if (!target) return;
      const page = Number(target.dataset.page || "1");
      const rect = target.getBoundingClientRect();
      const xCss = e.clientX - rect.left;
      const yCss = e.clientY - rect.top;
      onPageClick(page, xCss / scale, yCss / scale);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [onPageClick, scale]);

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

  // Track the visible page for the page-number input + prev/next controls.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let page = 1;
      for (const meta of pageMetasRef.current) {
        if (meta.wrapper.getBoundingClientRect().top <= containerTop + 40) {
          page = Number(meta.wrapper.dataset.page || "1");
        } else {
          break;
        }
      }
      setCurrentPage(page);
      setPageInput(String(page));
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

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
        <button type="button" className="studio-pdf-tool-btn" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page" title="Previous page">‹</button>
        <span className="studio-pdf-page-nav">
          <input
            className="studio-pdf-page-input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(pageInput, 10);
                if (Number.isFinite(n) && n >= 1 && n <= pageCount) goToPage(n);
                else setPageInput(String(currentPage));
              }
            }}
            inputMode="numeric"
            aria-label="Go to page"
          />
          <span className="studio-pdf-tool-pct">/ {pageCount}</span>
        </span>
        <button type="button" className="studio-pdf-tool-btn" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount} aria-label="Next page" title="Next page">›</button>
        <span className="studio-pdf-tool-sep" />
        <button
          type="button"
          className={findOpen ? "studio-pdf-tool-btn active" : "studio-pdf-tool-btn"}
          onClick={() => {
            if (findOpen) {
              setFindOpen(false);
              setFindQuery("");
              findQueryRef.current = "";
              applyFind("");
            } else {
              setFindOpen(true);
            }
          }}
          aria-label="Find in document"
          title="Find in document"
        >
          <svg viewBox="0 0 20 20" style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="4" />
            <path d="M12.5 12.5L16 16" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {findOpen ? (
        <div className="studio-pdf-findbar">
          <input
            autoFocus
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              findQueryRef.current = e.target.value;
              applyFind(e.target.value);
            }}
            placeholder="Find in document…"
            className="studio-pdf-find-input"
            aria-label="Find in document"
          />
          <span className="studio-pdf-find-count">{findTotal ? `${findIndex + 1}/${findTotal}` : "0/0"}</span>
          <button type="button" className="studio-pdf-tool-btn" onClick={() => activateFind(findIndex - 1)} disabled={!findTotal} aria-label="Previous match">Prev</button>
          <button type="button" className="studio-pdf-tool-btn" onClick={() => activateFind(findIndex + 1)} disabled={!findTotal} aria-label="Next match">Next</button>
          <button type="button" className="studio-pdf-tool-btn" onClick={() => { setFindOpen(false); setFindQuery(""); findQueryRef.current = ""; applyFind(""); }} aria-label="Close search">×</button>
        </div>
      ) : null}
      <div ref={containerRef} className="studio-pdf-scroll">
        {error ? <p className="studio-pdf-error">{error}</p> : null}
      </div>
    </div>
  );
}
