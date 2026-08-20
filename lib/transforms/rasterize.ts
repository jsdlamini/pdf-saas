// Rasterization transforms: pdf.js → canvas → JPEG/jsPDF, plus PDF text extraction.
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "pdf-lib";

export type PageThumbnail = {
  pageNumber: number;
  dataUrl: string;
};

export type EditTextSpan = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  bbox: { x: number; y: number; width: number; height: number };
};

export type EditFormField = {
  name: string;
  type: "text" | "checkbox" | "radio" | "dropdown";
  options: string[];
  value: string | boolean;
};

export type CompressionOptions = {
  grayscale: boolean;
  blackWhite: boolean;
  removeImages: boolean;
  reduceResolution: boolean;
  reduceQuality: boolean;
  reduceMargins: boolean;
  stripMetadata: boolean;
};

export function configurePdfJsWorker(pdfjs: { GlobalWorkerOptions?: { workerSrc: string } }) {
  if (!pdfjs.GlobalWorkerOptions) return;
  const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
}

export async function loadPdfPagesText(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const pages: string[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    pages.push(text || `(Page ${index} has no detected text)`);
  }

  return pages;
}

export async function samplePdfTextCoverage(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const sampledPages = Math.min(pdf.numPages, 6);
  let pagesWithText = 0;
  let totalCharacters = 0;
  let previewText = "";

  for (let index = 1; index <= sampledPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length > 12) pagesWithText += 1;
    totalCharacters += text.length;
    if (previewText.length < 1600 && text) {
      previewText = `${previewText} ${text}`.trim();
    }
  }

  return {
    sampledPages,
    pagesWithText,
    totalCharacters,
    previewText: previewText.slice(0, 1600),
  };
}

export async function renderPdfToImages(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const images: Array<{ dataUrl: string; width: number; height: number }> = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering context unavailable.");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    images.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.9),
      width: viewport.width,
      height: viewport.height,
    });
  }

  return images;
}

export async function renderPdfThumbnails(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const thumbs: PageThumbnail[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 0.28 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering context unavailable.");

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    thumbs.push({ pageNumber: index, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
  }

  return thumbs;
}

export async function renderPdfFirstPagePreview(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function renderPdfPagePreview(bytes: Uint8Array, pageNumber = 1, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width: canvas.width,
    height: canvas.height,
    pageCount: pdf.numPages,
    safePage,
  };
}

export async function extractPageTextSpans(pdfPage: unknown, viewport: { transform: number[] }): Promise<EditTextSpan[]> {
  const spans: EditTextSpan[] = [];
  try {
    const page = pdfPage as {
      getTextContent: () => Promise<{
        items: Array<{ str?: string; width?: number; transform?: number[] }>;
      }>;
    };
    const textContent = await page.getTextContent();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const item of textContent.items) {
      const str = item.str;
      const transform = item.transform;
      if (!str || !str.trim() || !transform) continue;
      const composed = pdfjs.Util.transform(viewport.transform, transform);
      const [a, b, , , e, f] = composed;
      const fontSize = Math.hypot(a, b);
      if (fontSize < 2) continue;
      const userScale = Math.hypot(transform[0], transform[1]) || fontSize;
      const canvasScale = fontSize / userScale;
      const itemCanvasWidth = (item.width ?? str.length * fontSize * 0.6) * canvasScale;
      for (const match of str.matchAll(/\S+/g)) {
        const word = match[0];
        const start = match.index ?? 0;
        const startX = e + (itemCanvasWidth * start) / str.length;
        const wordWidth = (itemCanvasWidth * word.length) / str.length;
        const baselineY = f;
        const pad = fontSize * 0.15 + 1;
        spans.push({
          text: word,
          x: startX,
          y: baselineY,
          fontSize,
          width: wordWidth,
          bbox: {
            x: startX - pad,
            y: baselineY - fontSize * 0.86 - pad,
            width: wordWidth + pad * 2,
            height: fontSize * 1.12 + pad * 2,
          },
        });
      }
    }
  } catch {
    // Text extraction is best-effort; an empty span list just disables click-to-edit.
  }
  return spans;
}

export async function renderEditPagePreview(bytes: Uint8Array, pageNumber = 1, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined });
  const pdf = await task.promise;
  const safePage = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const spans = await extractPageTextSpans(page, viewport);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width: canvas.width,
    height: canvas.height,
    pageCount: pdf.numPages,
    safePage,
    spans,
  };
}

export async function extractPdfFormFields(bytes: Uint8Array): Promise<EditFormField[]> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const fields = doc.getForm().getFields();
    return fields
      .map((field): EditFormField | null => {
        const name = field.getName();
        if (field instanceof PDFTextField) {
          return { name, type: "text", options: [], value: field.getText() ?? "" };
        }
        if (field instanceof PDFCheckBox) {
          return { name, type: "checkbox", options: [], value: field.isChecked() };
        }
        if (field instanceof PDFRadioGroup) {
          return { name, type: "radio", options: field.getOptions(), value: field.getSelected() ?? "" };
        }
        if (field instanceof PDFDropdown) {
          const selections = field.getSelected();
          return { name, type: "dropdown", options: field.getOptions(), value: selections[0] ?? "" };
        }
        if (field instanceof PDFOptionList) {
          const selections = field.getSelected();
          return { name, type: "dropdown", options: field.getOptions(), value: selections[0] ?? "" };
        }
        return null;
      })
      .filter((field): field is EditFormField => field !== null);
  } catch {
    return [];
  }
}

export async function dataUrlToImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode rendered page image."));
    img.src = dataUrl;
  });
}

export async function processCompressionImage(
  dataUrl: string,
  options: CompressionOptions
): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await dataUrlToImage(dataUrl);
  const resolutionFactor = options.reduceResolution ? 0.72 : 1;
  const marginCropRatio = options.reduceMargins ? 0.04 : 0;

  const sourceCropX = Math.floor(image.width * marginCropRatio);
  const sourceCropY = Math.floor(image.height * marginCropRatio);
  const sourceCropW = Math.max(1, image.width - sourceCropX * 2);
  const sourceCropH = Math.max(1, image.height - sourceCropY * 2);

  const width = Math.max(1, Math.floor(sourceCropW * resolutionFactor));
  const height = Math.max(1, Math.floor(sourceCropH * resolutionFactor));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering context unavailable.");

  context.drawImage(
    image,
    sourceCropX,
    sourceCropY,
    sourceCropW,
    sourceCropH,
    0,
    0,
    width,
    height
  );

  if (options.grayscale || options.blackWhite) {
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = Math.round(
        0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
      );
      const value = options.blackWhite ? (luminance > 148 ? 255 : 0) : luminance;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
  }

  const quality = options.reduceQuality ? 0.54 : 0.78;
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

export async function renderComparePageWithDiffs(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  pageNumber: number,
  color: "red" | "green"
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  configurePdfJsWorker(pdfjs);
  // Use copies to prevent ArrayBuffer detachment
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const otherTask = pdfjs.getDocument({ data: new Uint8Array(otherBytes) });
  const otherPdf = await otherTask.promise;

  if (pageNumber > pdf.numPages && pageNumber > otherPdf.numPages) return null;

  const myPageNum = Math.min(pageNumber, pdf.numPages);
  const otherPageNum = Math.min(pageNumber, otherPdf.numPages);

  const page = await pdf.getPage(myPageNum);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  // Get text items with positions from this page
  const textContent = await page.getTextContent();
  const myWords = textContent.items
    .filter((item) => "str" in item && item.str!.trim())
    .map((item) => ({
      str: (item as { str: string }).str.trim(),
      transform: (item as { transform: number[] }).transform,
      width: (item as { width: number }).width,
      height: (item as { height: number }).height,
    }));

  // Get text from other PDF's corresponding page
  let otherWords: typeof myWords = [];
  if (otherPageNum <= otherPdf.numPages) {
    const otherPage = await otherPdf.getPage(otherPageNum);
    const otherTextContent = await otherPage.getTextContent();
    otherWords = otherTextContent.items
      .filter((item) => "str" in item && item.str!.trim())
      .map((item) => ({
        str: (item as { str: string }).str.trim(),
        transform: (item as { transform: number[] }).transform,
        width: (item as { width: number }).width,
        height: (item as { height: number }).height,
      }));
  }

  const otherWordSet = new Set(otherWords.map((w) => w.str.toLowerCase()));

  // Draw highlight rectangles on differing words
  ctx.globalAlpha = 0.35;
  for (const word of myWords) {
    const isUnique = !otherWordSet.has(word.str.toLowerCase());
    if (!isUnique) continue;

    const [scaleX, , , scaleY, tx, ty] = word.transform;
    const fontSize = Math.abs(scaleY) || 12;
    const x = tx;
    const y = viewport.height - ty - fontSize;
    const w = word.width || fontSize * word.str.length * 0.6;
    const h = fontSize * 1.15;

    ctx.fillStyle = color === "red" ? "rgba(239, 68, 68, 0.45)" : "rgba(34, 197, 94, 0.45)";
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.88),
    pageCount: pdf.numPages,
  };
}
