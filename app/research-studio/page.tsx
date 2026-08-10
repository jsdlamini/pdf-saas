"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import JSZip from "jszip";
import katex from "katex";
import "katex/dist/katex.min.css";
import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { getTemplateBySlug, RESEARCH_TEMPLATES, type ResearchTemplate } from "@/lib/research-templates";

type ProjectEntry = {
  path: string;
  kind: "file" | "folder";
  content: string;
};

type SavedProjectMeta = {
  id: string;
  name: string;
  updatedAt: string;
};

type SavedProjectData = {
  id: string;
  name: string;
  entries: ProjectEntry[];
  selectedPath: string;
  lastCompileAt: string;
  updatedAt: string;
};

type InitialResearchStudioState = {
  savedProjects: SavedProjectMeta[];
  activeProjectId: string;
  projectName: string;
  projectEntries: ProjectEntry[];
  selectedPath: string;
  lastCompileAt: string;
  workspaceScreen: "projects" | "editor";
};

type AiFixSuggestion = {
  title: string;
  why: string;
  steps: string[];
  patch?: string;
  files?: string[];
};

type CitationItem = {
  key: string;
  author: string;
  year: string;
  title: string;
};

type LabelItem = {
  name: string;
  file: string;
};

type SynctexRecord = {
  page: number;
  x: number;
  y: number;
  file: string;
  line: number;
};

function normalizeAiPatchSnippet(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function isValidAiPatchSnippet(raw: string) {
  const snippet = normalizeAiPatchSnippet(raw);
  if (!snippet) return false;
  if (snippet.length < 3) return false;
  return /\\[a-zA-Z]+|\\begin\{|\\end\{|\$\$|\$[^$]/.test(snippet) || snippet.length > 24;
}

const GUEST_PROJECT_LIMIT = 5;

const DEFAULT_LATEX = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}
\usepackage{siunitx}
\usepackage{hyperref}
\title{WiserFiles Research Draft}
\author{Research Team}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Replace this abstract with your hypothesis, method, and key findings.
\end{abstract}

\input{sections/introduction}
\input{sections/methods}
\input{sections/results}
\input{sections/discussion}

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;

const DEFAULT_INTRO = String.raw`\section{Introduction}
Write context and motivation.
`;

const DEFAULT_METHODS = String.raw`\section{Methods}
Describe experiment design and protocol.
`;

const DEFAULT_RESULTS = String.raw`\section{Results}
Summarize findings and include figures/tables.
`;

const DEFAULT_DISCUSSION = String.raw`\section{Discussion}
Interpret implications and limitations.
`;

const DEFAULT_BIB = String.raw`@article{wiserfiles2026,
  title={WiserFiles Research Patterns},
  author={Doe, Alex},
  journal={Journal of Practical Workflows},
  year={2026}
}
`;

const STARTER_PROJECT: ProjectEntry[] = [
  { path: "main.tex", kind: "file", content: DEFAULT_LATEX },
  { path: "sections/introduction.tex", kind: "file", content: DEFAULT_INTRO },
  { path: "sections/methods.tex", kind: "file", content: DEFAULT_METHODS },
  { path: "sections/results.tex", kind: "file", content: DEFAULT_RESULTS },
  { path: "sections/discussion.tex", kind: "file", content: DEFAULT_DISCUSSION },
  { path: "refs.bib", kind: "file", content: DEFAULT_BIB },
  { path: "figures/", kind: "folder", content: "" },
];

function createFreshProjectEntries(projectName: string): ProjectEntry[] {
  return [
    {
      path: "main.tex",
      kind: "file",
      content: String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\title{${projectName || "Untitled Project"}}
\author{Research Team}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Write your abstract.
\end{abstract}

\section{Introduction}
Start writing your paper.

\end{document}
`,
    },
    { path: "sections/", kind: "folder", content: "" },
    { path: "figures/", kind: "folder", content: "" },
    { path: "refs.bib", kind: "file", content: "" },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function scanCitationKeys(entries: ProjectEntry[]): CitationItem[] {
  const bibFiles = entries.filter((e) => e.kind === "file" && e.path.endsWith(".bib"));
  const keys = new Map<string, CitationItem>();
  for (const bib of bibFiles) {
    const content = bib.content;
    const entryRegex = /@\w+\{\s*([^,]+),/g;
    let match = entryRegex.exec(content);
    while (match) {
      const key = match[1].trim();
      if (!keys.has(key)) {
        const authorMatch = content.slice(match.index).match(/author\s*=\s*\{([^}]+)\}/);
        const yearMatch = content.slice(match.index).match(/year\s*=\s*\{?(\d{4})\}?/);
        const titleMatch = content.slice(match.index).match(/title\s*=\s*\{([^}]+)\}/);
        keys.set(key, {
          key,
          author: authorMatch?.[1]?.trim() || "",
          year: yearMatch?.[1]?.trim() || "",
          title: titleMatch?.[1]?.trim() || "",
        });
      }
      match = entryRegex.exec(content);
    }
  }
  return Array.from(keys.values());
}

function scanLabels(entries: ProjectEntry[]): LabelItem[] {
  const texFiles = entries.filter((e) => e.kind === "file" && e.path.endsWith(".tex"));
  const labels: LabelItem[] = [];
  const seen = new Set<string>();
  for (const tex of texFiles) {
    const content = tex.content;
    const labelRegex = /\\label\{([^}]+)\}/g;
    let match = labelRegex.exec(content);
    while (match) {
      const name = match[1].trim();
      if (!seen.has(name)) {
        seen.add(name);
        labels.push({ name, file: tex.path });
      }
      match = labelRegex.exec(content);
    }
  }
  return labels;
}

function parseAbstractContent(source: string): string {
  const absStart = source.indexOf("\\begin{abstract}");
  const absEnd = source.indexOf("\\end{abstract}");
  if (absStart < 0 || absEnd <= absStart) return "";
  return source.slice(absStart + "\\begin{abstract}".length, absEnd).trim();
}

function countWords(text: string): number {
  const cleaned = text.replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ");
  const words = cleaned.match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function parseEquationAtLine(line: string): string | null {
  const trimmed = line.trim();
  const displayMatch = trimmed.match(/^\$\$([\s\S]*?)\$\$/);
  if (displayMatch) return displayMatch[1].trim();
  const beginMatch = trimmed.match(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/);
  if (beginMatch) return beginMatch[1].replace(/\\label\{[^}]*\}/g, "").trim();
  return null;
}

function findEquationAtPosition(source: string, cursorPos: number): string | null {
  const lines = source.split("\n");
  let offset = 0;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    if (cursorPos >= offset && cursorPos <= lineEnd) {
      return parseEquationAtLine(line);
    }
    offset = lineEnd + 1;
  }
  return null;
}

async function parseSynctexGzBuffer(buffer: ArrayBuffer): Promise<SynctexRecord[]> {
  try {
    const bytes = new Uint8Array(buffer);
    let text: string;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        const ds = new DecompressionStream("gzip");
        const readable = new Blob([buffer]).stream().pipeThrough(ds);
        const decompressed = await new Response(readable).arrayBuffer();
        text = new TextDecoder("utf-8").decode(decompressed);
      } catch {
        return [];
      }
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }

    if (!text.includes("SyncTeX")) return [];

    const records: SynctexRecord[] = [];
    const lines = text.split("\n");
    let currentFile = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("Input:")) {
        const parts = line.split(":");
        if (parts.length >= 3) {
          currentFile = parts.slice(1).join(":").trim();
        }
      } else if (line.startsWith("{")) {
        const record: SynctexRecord = { page: 0, x: 0, y: 0, file: currentFile, line: 0 };
        i++;
        while (i < lines.length && lines[i] !== "}") {
          const rl = lines[i];
          if (rl.startsWith("Page:")) record.page = parseInt(rl.split(":")[1]) || 0;
          else if (rl.startsWith("h:")) record.x = parseInt(rl.slice(2)) || 0;
          else if (rl.startsWith("v:")) record.y = parseInt(rl.slice(2)) || 0;
          else if (rl.startsWith("Line:")) record.line = parseInt(rl.split(":")[1]) || 0;
          i++;
        }
        if (record.page > 0 && record.file) {
          records.push(record);
        }
      }
    }
    return records;
  } catch {
    return [];
  }
}

function buildPreview(source: string) {
  const lines = source.split(/\r?\n/);
  const titleLine = lines.find((line) => line.trim().startsWith("\\title{"));
  const title = titleLine ? titleLine.trim().replace(/^\\title\{/, "").replace(/\}$/, "") : "Untitled Draft";

  const sectionHeads = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => /^\\section\*?\{/.test(entry.line))
    .map((entry) => ({
      title: entry.line.replace(/^\\section\*?\{/, "").replace(/\}$/, ""),
      index: entry.index,
    }));

  const sections = sectionHeads.map((section, index) => {
    const next = sectionHeads[index + 1];
    const endIndex = next ? next.index : lines.length;
    const body = lines
      .slice(section.index + 1, endIndex)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");

    return {
      title: section.title,
      body: body || "No paragraph content detected under this section.",
    };
  });

  const abstractStart = lines.findIndex((line) => line.trim() === "\\begin{abstract}");
  const abstractEnd = lines.findIndex((line) => line.trim() === "\\end{abstract}");
  const abstract =
    abstractStart >= 0 && abstractEnd > abstractStart
      ? lines.slice(abstractStart + 1, abstractEnd).join(" ").trim()
      : "No abstract found in this file.";

  return { title, sections, abstract };
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

function getFileNameFromDisposition(header: string | null) {
  if (!header) return null;
  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const plainMatch = header.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function nextTemplateFor(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tex")) {
    return "\\section{New Section}\nWrite your content here.\n";
  }
  if (lower.endsWith(".bib")) {
    return "@article{newref,\n  title={Title},\n  author={Author},\n  year={2026}\n}\n";
  }
  return "";
}

async function confirmModal(title: string, text: string, confirmButtonText: string, danger = false) {
  const result = await Swal.fire({
    title,
    text,
    icon: danger ? "warning" : "question",
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: "Cancel",
    reverseButtons: true,
    focusCancel: true,
    confirmButtonColor: danger ? "#dc2626" : "#0f766e",
    cancelButtonColor: "#e2e8f0",
    background: "#ffffff",
  });

  return result.isConfirmed;
}

async function promptModal(title: string, inputLabel: string, inputValue: string, confirmButtonText: string) {
  const result = await Swal.fire({
    title,
    input: "text",
    inputLabel,
    inputValue,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: "Cancel",
    reverseButtons: true,
    focusCancel: true,
    confirmButtonColor: "#0f766e",
    cancelButtonColor: "#e2e8f0",
    background: "#ffffff",
    inputValidator: (value) => {
      if (!value || !value.trim()) {
        return "Enter a value.";
      }
      return undefined;
    },
  });

  if (!result.isConfirmed) return null;
  return String(result.value || "").trim();
}

async function projectEntryActionSheet(entry: ProjectEntry) {
  const result = await Swal.fire({
    title: entry.path,
    text: "Choose an action",
    icon: "question",
    showConfirmButton: true,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: "Open",
    denyButtonText: "Rename",
    cancelButtonText: "Delete",
    reverseButtons: true,
    focusCancel: false,
    confirmButtonColor: "#0f766e",
    denyButtonColor: "#2563eb",
    cancelButtonColor: "#dc2626",
    background: "#ffffff",
  });

  return result;
}

type EditorSnippet = {
  before: string;
  after: string;
  placeholder?: string;
  block?: string;
  cursorOffset?: number;
};

type LatexIntellisenseItem = {
  label: string;
  insert: string;
  detail: string;
  aliases?: string[];
};

type ProjectTreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  implicit?: boolean;
  children?: ProjectTreeNode[];
};

type TreeContextMenuState = {
  x: number;
  y: number;
  nodePath: string;
  nodeKind: "file" | "folder";
  implicitFolder: boolean;
};

type TreeContextAction = "open" | "new-file" | "new-folder" | "rename" | "delete";

type TreeContextActionItem = {
  action: TreeContextAction;
  label: string;
  tone?: "default" | "danger";
};

const LATEX_INTELLISENSE_ITEMS: LatexIntellisenseItem[] = [
  { label: "section", insert: "section{|}", detail: "Section heading", aliases: ["sec"] },
  { label: "subsection", insert: "subsection{|}", detail: "Subsection heading", aliases: ["subsec"] },
  { label: "subsubsection", insert: "subsubsection{|}", detail: "Subsubsection heading", aliases: ["subsub"] },
  { label: "paragraph", insert: "paragraph{|}", detail: "Paragraph heading" },
  { label: "textbf", insert: "textbf{|}", detail: "Bold text", aliases: ["bold"] },
  { label: "textit", insert: "textit{|}", detail: "Italic text", aliases: ["italic"] },
  { label: "underline", insert: "underline{|}", detail: "Underlined text" },
  { label: "footnote", insert: "footnote{|}", detail: "Footnote" },
  { label: "cite", insert: "cite{|}", detail: "Citation" },
  { label: "ref", insert: "ref{|}", detail: "Cross-reference" },
  { label: "label", insert: "label{|}", detail: "Reference label" },
  { label: "href", insert: "href{|}{link text}", detail: "Hyperlink" },
  { label: "includegraphics", insert: "includegraphics[width=0.8\\linewidth]{|}", detail: "Insert image" },
  { label: "begin figure", insert: "begin{figure}[htbp}\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{|}\n  \\caption{Figure caption}\n  \\label{fig:key}\n\\end{figure}", detail: "Figure environment", aliases: ["figure"] },
  { label: "begin table", insert: "begin{table}[htbp}\n  \\centering\n  \\caption{Table caption}\n  \\label{tab:key}\n  \\begin{tabular}{lcc}\n    \\toprule\n    Item & A & B \\\\n    \\midrule\n    X & 1 & 2 \\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}", detail: "Table environment", aliases: ["table"] },
  { label: "begin itemize", insert: "begin{itemize}\n  \\item |\n\\end{itemize}", detail: "Bullet list", aliases: ["itemize"] },
  { label: "begin enumerate", insert: "begin{enumerate}\n  \\item |\n\\end{enumerate}", detail: "Numbered list", aliases: ["enumerate"] },
  { label: "begin equation", insert: "begin{equation}\n  |\n\\end{equation}", detail: "Equation block", aliases: ["equation"] },
  { label: "begin align", insert: "begin{align}\n  |\n\\end{align}", detail: "Aligned equations", aliases: ["align"] },
  { label: "frac", insert: "frac{|}{denominator}", detail: "Fraction" },
  { label: "sqrt", insert: "sqrt{|}", detail: "Square root" },
  { label: "alpha", insert: "alpha", detail: "Greek letter α" },
  { label: "beta", insert: "beta", detail: "Greek letter β" },
  { label: "gamma", insert: "gamma", detail: "Greek letter γ" },
];

function buildProjectTree(entries: ProjectEntry[]): ProjectTreeNode[] {
  const root: ProjectTreeNode = { name: "", path: "", kind: "folder", children: [] };
  const folderMap = new Map<string, ProjectTreeNode>();
  folderMap.set("", root);

  const ensureFolder = (folderPathRaw: string, implicit = true): ProjectTreeNode => {
    const folderPath = folderPathRaw ? (folderPathRaw.endsWith("/") ? folderPathRaw : `${folderPathRaw}/`) : "";
    const existing = folderMap.get(folderPath);
    if (existing) {
      if (!implicit) existing.implicit = false;
      return existing;
    }

    const trimmed = folderPath.replace(/\/$/, "");
    const parentPath = trimmed.includes("/") ? `${trimmed.slice(0, trimmed.lastIndexOf("/") + 1)}` : "";
    const parent = ensureFolder(parentPath, true);
    const name = trimmed.slice(parentPath.length);
    const node: ProjectTreeNode = {
      name,
      path: folderPath,
      kind: "folder",
      implicit,
      children: [],
    };
    parent.children?.push(node);
    folderMap.set(folderPath, node);
    return node;
  };

  for (const entry of entries) {
    if (entry.kind === "folder") {
      ensureFolder(entry.path, false);
      continue;
    }

    const slashIndex = entry.path.lastIndexOf("/");
    const parentPath = slashIndex === -1 ? "" : `${entry.path.slice(0, slashIndex + 1)}`;
    const fileName = slashIndex === -1 ? entry.path : entry.path.slice(slashIndex + 1);
    const parent = ensureFolder(parentPath, true);
    parent.children?.push({
      name: fileName,
      path: entry.path,
      kind: "file",
    });
  }

  const sortTree = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortTree(node.children);
    }
  };

  sortTree(root.children || []);
  return root.children || [];
}

function getCaretViewportPosition(textarea: HTMLTextAreaElement, cursor: number) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const copyProps = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontFamily",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textIndent",
    "tabSize",
  ];

  mirror.style.position = "fixed";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";

  for (const prop of copyProps) {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  }

  mirror.textContent = textarea.value.slice(0, cursor);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(cursor) || " ";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const areaRect = textarea.getBoundingClientRect();
  const lineHeight = Number.parseFloat(computed.lineHeight);
  const offsetY = Number.isFinite(lineHeight) ? lineHeight : 18;

  const top = areaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop + offsetY;
  const left = areaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft;

  document.body.removeChild(mirror);

  return {
    top: Math.min(top, window.innerHeight - 32),
    left: Math.min(left, window.innerWidth - 320),
  };
}

function collectFolderPaths(entries: ProjectEntry[]) {
  const folders = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === "folder") {
      folders.add(entry.path.endsWith("/") ? entry.path : `${entry.path}/`);
      continue;
    }

    const parts = entry.path.split("/").filter(Boolean);
    let cursor = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor += `${parts[index]}/`;
      folders.add(cursor);
    }
  }

  return folders;
}

function buildActiveAncestorExpansion(selectedFilePath: string, entries: ProjectEntry[]) {
  const expansion: Record<string, boolean> = {};
  const allFolders = collectFolderPaths(entries);
  for (const folderPath of allFolders) {
    expansion[folderPath] = false;
  }

  const parts = selectedFilePath.split("/").filter(Boolean);
  let cursor = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor += `${parts[index]}/`;
    expansion[cursor] = true;
  }

  return expansion;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightLatexSource(source: string) {
  const escaped = escapeHtml(source);

  return escaped
    .replace(/(%[^\n]*)/g, '<span class="latex-token-comment">$1</span>')
    .replace(/(\\(?:begin|end|section|subsection|subsubsection|paragraph|textbf|textit|underline|footnote|cite|ref|label|includegraphics|caption|author|title|date|maketitle|input|bibliography|bibliographystyle|documentclass|usepackage|item|frac|sqrt|alpha|beta|gamma|today|[a-zA-Z@]+))/g, '<span class="latex-token-command">$1</span>')
    .replace(/(\$\$[^$\n]*\$\$|\$[^$\n]*\$)/g, '<span class="latex-token-math">$1</span>')
    .replace(/([{}])/g, '<span class="latex-token-brace">$1</span>')
    .replace(/(\[[^\]\n]*\])/g, '<span class="latex-token-option">$1</span>');
}

function getTreeContextMenuItems(menu: TreeContextMenuState): TreeContextActionItem[] {
  const items: TreeContextActionItem[] = [
    {
      action: "open",
      label: menu.nodeKind === "file" ? "Open file" : "Toggle folder",
    },
  ];

  if (menu.nodeKind === "folder") {
    items.push({ action: "new-file", label: "New file" });
    items.push({ action: "new-folder", label: "New subfolder" });
  }

  if (!menu.implicitFolder) {
    items.push({ action: "rename", label: "Rename" });
    items.push({ action: "delete", label: "Delete", tone: "danger" });
  }

  return items;
}

function renderTreeContextIcon(action: TreeContextAction) {
  if (action === "open") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 4l9 6-9 6V4z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (action === "new-file") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (action === "new-folder") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 6h5l1.2 1.5H17v7.5H3V6z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (action === "rename") {
    return (
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 14.5V16h1.5L15 6.5 13.5 5 4 14.5z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 6h10M8 6V4h4v2m-5 0l.5 10h5L13 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function loadInitialResearchStudioState(): InitialResearchStudioState {
  // Start with no projects — users create their own via "New From Scratch" or "New from Template"
  // The "starter-project" ID is a sentinel that means "no project selected"
  return {
    savedProjects: [],
    activeProjectId: "starter-project",
    projectName: "WiserFiles Research Draft",
    projectEntries: STARTER_PROJECT,
    selectedPath: "main.tex",
    lastCompileAt: "Not compiled yet",
    workspaceScreen: "projects",
  };
}

function makeProjectId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `project-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ResearchStudioPage() {
  const initialState = useMemo(() => loadInitialResearchStudioState(), []);
  const { isLoaded: authLoaded, userId } = useAuth();
  const hasHydratedServerProjectsRef = useRef(false);

  const [workspaceScreen, setWorkspaceScreen] = useState<"projects" | "editor">(initialState.workspaceScreen);
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>(initialState.savedProjects);
  const [savedProjectSnapshots, setSavedProjectSnapshots] = useState<SavedProjectData[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(initialState.activeProjectId);
  const [projectName, setProjectName] = useState(initialState.projectName);
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>(initialState.projectEntries);
  const [selectedPath, setSelectedPath] = useState(initialState.selectedPath);
  const [newPath, setNewPath] = useState("");
  const [addFileError, setAddFileError] = useState("");
  const [compileNotice, setCompileNotice] = useState("Ready.");
  const [compileBusy, setCompileBusy] = useState(false);
  const [compiledPdfBlob, setCompiledPdfBlob] = useState<Blob | null>(null);
  const [compiledPdfUrl, setCompiledPdfUrl] = useState("");
  const [compiledPdfFileName, setCompiledPdfFileName] = useState("compiled-main.pdf");
  const [compileMainLog, setCompileMainLog] = useState("");
  const [compileMainLogFileName, setCompileMainLogFileName] = useState("main.log");
  const [accountSyncUnavailable, setAccountSyncUnavailable] = useState(false);
  const [aiFixBusy, setAiFixBusy] = useState(false);
  const [aiFixError, setAiFixError] = useState("");
  const [aiFixSummary, setAiFixSummary] = useState("");
  const [aiFixSuggestions, setAiFixSuggestions] = useState<AiFixSuggestion[]>([]);
  const [lastCompileAt, setLastCompileAt] = useState<string>(initialState.lastCompileAt);
  const [leftPaneWidth, setLeftPaneWidth] = useState(220);
  const [rightPaneWidth, setRightPaneWidth] = useState(300);
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [activeResizer, setActiveResizer] = useState<"left" | "right" | null>(null);
  const [collapsedOutlineSections, setCollapsedOutlineSections] = useState<Record<string, boolean>>({});
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findUseRegex, setFindUseRegex] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [previewErrorLogs, setPreviewErrorLogs] = useState<string[]>([]);
  const [intellisenseOptions, setIntellisenseOptions] = useState<LatexIntellisenseItem[]>([]);
  const [intellisenseIndex, setIntellisenseIndex] = useState(0);
  const [intellisenseStart, setIntellisenseStart] = useState<number | null>(null);
  const [intellisensePosition, setIntellisensePosition] = useState<{ top: number; left: number } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [treeContextActiveIndex, setTreeContextActiveIndex] = useState(0);
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 });
  const [autoSaveStatus, setAutoSaveStatus] = useState<"saved" | "unsaved" | "saving">("saved");
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<string | null>(null);
  const [equationTooltip, setEquationTooltip] = useState<{ top: number; left: number; latex: string } | null>(null);
  const [wordCount, setWordCount] = useState<{ words: number; chars: number; abstractWords: number }>({ words: 0, chars: 0, abstractWords: 0 });
  const [loadingProject, setLoadingProject] = useState(false);
  const [synctexRecords, setSynctexRecords] = useState<SynctexRecord[]>([]);
  const [synctexNotice, setSynctexNotice] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equationHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panesRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);

  const isSignedIn = authLoaded && Boolean(userId);
  const usesAccountStorage = isSignedIn && !accountSyncUnavailable;

  const editableFiles = useMemo(
    () => projectEntries.filter((entry) => entry.kind === "file"),
    [projectEntries]
  );

  const activeEntry = useMemo(
    () => editableFiles.find((entry) => entry.path === selectedPath) ?? editableFiles[0] ?? null,
    [editableFiles, selectedPath]
  );

  const activeSource = activeEntry?.content ?? "";

  const preview = useMemo(() => buildPreview(activeSource), [activeSource]);
  const projectTree = useMemo(() => buildProjectTree(projectEntries), [projectEntries]);
  const highlightedSource = useMemo(() => highlightLatexSource(activeSource), [activeSource]);
  const citationKeys = useMemo(() => scanCitationKeys(projectEntries), [projectEntries]);
  const labelItems = useMemo(() => scanLabels(projectEntries), [projectEntries]);
  const autoExpandedFolders = useMemo(
    () => buildActiveAncestorExpansion(activeEntry?.path ?? "", projectEntries),
    [activeEntry?.path, projectEntries]
  );
  const treeContextItems = useMemo(
    () => (treeContextMenu ? getTreeContextMenuItems(treeContextMenu) : []),
    [treeContextMenu]
  );
  const boundedTreeContextActiveIndex = treeContextItems.length
    ? Math.min(treeContextActiveIndex, treeContextItems.length - 1)
    : 0;

  const findRegex = useMemo(() => {
    if (!findQuery) return null;
    const source = findUseRegex ? findQuery : findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrapped = findWholeWord ? `\\b(?:${source})\\b` : source;
    const flags = findCaseSensitive ? "g" : "gi";
    try {
      return new RegExp(wrapped, flags);
    } catch {
      return null;
    }
  }, [findQuery, findUseRegex, findWholeWord, findCaseSensitive]);

  const findRegexError = useMemo(() => {
    if (!findUseRegex || !findQuery) return "";
    try {
      const wrapped = findWholeWord ? `\\b(?:${findQuery})\\b` : findQuery;
      // Validate only.
      void new RegExp(wrapped, findCaseSensitive ? "g" : "gi");
      return "";
    } catch {
      return "Invalid regular expression.";
    }
  }, [findUseRegex, findQuery, findWholeWord, findCaseSensitive]);

  const findMatches = useMemo(() => {
    if (!findQuery || !findRegex) return [] as Array<{ start: number; end: number }>;
    const matches: Array<{ start: number; end: number }> = [];
    let result = findRegex.exec(activeSource);
    while (result) {
      const start = result.index;
      const end = start + result[0].length;
      matches.push({ start, end });
      result = findRegex.exec(activeSource);
    }
    return matches;
  }, [activeSource, findQuery, findRegex]);

  const matchLines = useMemo(() => {
    if (!findMatches.length) return [] as Array<{ lineNumber: number; count: number; firstMatchIndex: number; preview: string }>;

    const lines = activeSource.split("\n");
    const lineOffsets: number[] = [];
    let cursor = 0;
    for (const line of lines) {
      lineOffsets.push(cursor);
      cursor += line.length + 1;
    }

    const getLineIndex = (position: number) => {
      let low = 0;
      let high = lineOffsets.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lineOffsets[mid] <= position) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return Math.max(0, high);
    };

    const byLine = new Map<number, { count: number; firstMatchIndex: number }>();
    findMatches.forEach((match, index) => {
      const lineIndex = getLineIndex(match.start);
      const current = byLine.get(lineIndex);
      if (!current) {
        byLine.set(lineIndex, { count: 1, firstMatchIndex: index });
      } else {
        current.count += 1;
      }
    });

    return Array.from(byLine.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([lineIndex, detail]) => ({
        lineNumber: lineIndex + 1,
        count: detail.count,
        firstMatchIndex: detail.firstMatchIndex,
        preview: lines[lineIndex]?.trim() || "(blank line)",
      }));
  }, [activeSource, findMatches]);

  useEffect(() => {
    if (!findPanelOpen) return;
    window.requestAnimationFrame(() => findInputRef.current?.focus());
  }, [findPanelOpen]);

  // Word count debounce
  useEffect(() => {
    if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current);
    wordCountTimerRef.current = setTimeout(() => {
      const absContent = parseAbstractContent(activeSource);
      setWordCount({
        words: countWords(activeSource),
        chars: activeSource.length,
        abstractWords: countWords(absContent),
      });
    }, 300);
    return () => {
      if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current);
    };
  }, [activeSource]);

  // Auto-save debounce
  const triggerAutoSave = useCallback(() => {
    setAutoSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        const snapshot = buildCurrentProjectSnapshot();
        persistProjectSnapshot(snapshot);
        if (userId && !accountSyncUnavailable) {
          void upsertProjectSnapshotToServer(snapshot).catch(() => {});
        }
        setAutoSaveTimestamp(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        setAutoSaveStatus("saved");
      } catch {
        // silent fail
      }
    }, 2000);
  }, [projectEntries, activeProjectId, projectName, selectedPath, lastCompileAt, userId, accountSyncUnavailable]);

  useEffect(() => {
    triggerAutoSave();
  }, [triggerAutoSave]);

  useEffect(() => {
    if (!findPanelOpen && !replacePanelOpen) return;

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFindPanelOpen(false);
      setReplacePanelOpen(false);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [findPanelOpen, replacePanelOpen]);

  const boundedActiveMatchIndex = findMatches.length
    ? Math.min(activeMatchIndex, findMatches.length - 1)
    : 0;

  const showMatchGutter = findPanelOpen && Boolean(findQuery.trim());

  useEffect(() => {
    if (!treeContextMenu) return;
    window.requestAnimationFrame(() => treeContextMenuRef.current?.focus());

    const close = () => setTreeContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [treeContextMenu]);

  function appendPreviewError(message: string) {
    const stamped = `[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ${message}`;
    setPreviewErrorLogs((current) => [stamped, ...current].slice(0, 8));
  }

  function isAccountSyncUnavailableMessage(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("database_url is not configured") ||
      normalized.includes("account sync storage is not available")
    );
  }

  function closeIntellisense() {
    setIntellisenseOptions([]);
    setIntellisenseIndex(0);
    setIntellisenseStart(null);
    setIntellisensePosition(null);
  }

  function updateIntellisenseFromInput(source: string, cursor: number, textarea?: HTMLTextAreaElement) {
    // Check for \cite{ context
    const citePrefix = source.slice(0, Math.max(0, cursor)).match(/\\cite\{([^}]*)$/);
    if (citePrefix) {
      const query = citePrefix[1].toLowerCase();
      const matches = citationKeys
        .filter((c) => !query || c.key.toLowerCase().includes(query))
        .slice(0, 8);
      if (matches.length) {
        setIntellisenseOptions(
          matches.map((c) => ({
            label: c.key,
            insert: `${c.key}`,
            detail: [c.author, c.year, c.title].filter(Boolean).join(" | ") || "Citation",
          }))
        );
        setIntellisenseStart(cursor - citePrefix[1].length);
        setIntellisenseIndex(0);
        if (textarea) setIntellisensePosition(getCaretViewportPosition(textarea, cursor));
        return;
      }
    }

    // Check for \ref{ context
    const refPrefix = source.slice(0, Math.max(0, cursor)).match(/\\ref\{([^}]*)$/);
    if (refPrefix) {
      const query = refPrefix[1].toLowerCase();
      const matches = labelItems
        .filter((l) => !query || l.name.toLowerCase().includes(query))
        .slice(0, 8);
      if (matches.length) {
        setIntellisenseOptions(
          matches.map((l) => ({
            label: l.name,
            insert: `${l.name}`,
            detail: `In file: ${l.file}`,
          }))
        );
        setIntellisenseStart(cursor - refPrefix[1].length);
        setIntellisenseIndex(0);
        if (textarea) setIntellisensePosition(getCaretViewportPosition(textarea, cursor));
        return;
      }
    }

    // Standard \command intellisense
    const prefixMatch = source.slice(0, cursor).match(/\\[a-zA-Z ]*$/);
    if (!prefixMatch) {
      closeIntellisense();
      return;
    }

    const fullPrefix = prefixMatch[0];
    const query = fullPrefix.slice(1).trim().toLowerCase();
    const nextOptions = LATEX_INTELLISENSE_ITEMS.filter((item) => {
      const labelMatch = item.label.toLowerCase().includes(query);
      const aliasMatch = item.aliases?.some((alias) => alias.toLowerCase().includes(query)) ?? false;
      return query ? labelMatch || aliasMatch : true;
    }).slice(0, 8);

    if (!nextOptions.length) {
      closeIntellisense();
      return;
    }

    setIntellisenseOptions(nextOptions);
    setIntellisenseStart(cursor - fullPrefix.length);
    setIntellisenseIndex(0);
    if (textarea) {
      setIntellisensePosition(getCaretViewportPosition(textarea, cursor));
    }
  }

  function applyIntellisenseSelection(index = intellisenseIndex) {
    if (!intellisenseOptions.length || intellisenseStart === null) return;
    const textarea = editorRef.current;
    if (!textarea) return;

    const selected = intellisenseOptions[Math.min(Math.max(index, 0), intellisenseOptions.length - 1)];
    const end = textarea.selectionStart;
    const withSlash = `\\${selected.insert}`;
    const cursorMarker = withSlash.indexOf("|");
    const replacement = withSlash.replace("|", "");

    const nextText = `${activeSource.slice(0, intellisenseStart)}${replacement}${activeSource.slice(end)}`;
    const cursor = intellisenseStart + (cursorMarker >= 0 ? cursorMarker : replacement.length);

    closeIntellisense();
    applyEditorUpdate(nextText, cursor, cursor);
  }

  function onEditorChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextText = event.target.value;
    const cursor = event.target.selectionStart;
    updateActiveFile(nextText);
    updateIntellisenseFromInput(nextText, cursor, event.target);
  }

  function onEditorCursorEvent(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    setEditorScroll({ top: target.scrollTop, left: target.scrollLeft });
    updateIntellisenseFromInput(target.value, target.selectionStart, target);
  }

  function onEditorMouseMove(event: React.MouseEvent<HTMLTextAreaElement>) {
    if (equationHoverRef.current) {
      clearTimeout(equationHoverRef.current);
      equationHoverRef.current = null;
    }
    if (equationTooltip) {
      setEquationTooltip(null);
    }
    const textarea = event.currentTarget;
    const cursorPos = textarea.selectionStart;
    equationHoverRef.current = setTimeout(() => {
      const eq = findEquationAtPosition(textarea.value, cursorPos);
      if (eq) {
        try {
          const rect = textarea.getBoundingClientRect();
          setEquationTooltip({
            top: event.clientY + 12,
            left: event.clientX + 12,
            latex: eq,
          });
        } catch {
          // KaTeX render failed, don't show tooltip
        }
      }
    }, 500);
  }

  function onEditorDragOver(event: React.DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onEditorDrop(event: React.DragEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (!files || !files.length) return;

    const imageFile = files[0];
    if (!imageFile.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const safeName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const figurePath = `figures/${safeName}`;

      // Add or update the figure entry
      setProjectEntries((current) => {
        const withoutExisting = current.filter((e) => e.path !== figurePath);
        return [
          ...withoutExisting,
          { path: figurePath, kind: "file", content: base64 },
        ];
      });

      // Insert LaTeX code at cursor
      const textarea = editorRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const snippet = `\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\\linewidth]{${figurePath}}
  \caption{Figure caption}
  \label{fig:${safeName.replace(/\.[^.]+$/, "")}}
\end{figure}
`;
      const nextText = activeSource.slice(0, cursor) + snippet + activeSource.slice(cursor);
      updateActiveFile(nextText);
      setCompileNotice(`Image "${safeName}" added to figures/ and inserted at cursor.`);
    };
    reader.readAsDataURL(imageFile);
  }

  function openTreeContextMenu(
    event: React.MouseEvent,
    node: ProjectTreeNode,
    explicitFolder: ProjectEntry | undefined
  ) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 196;
    const menuHeight = 220;
    const x = clamp(event.clientX, 8, window.innerWidth - menuWidth);
    const y = clamp(event.clientY, 8, window.innerHeight - menuHeight);
    setTreeContextMenu({
      x,
      y,
      nodePath: node.path,
      nodeKind: node.kind,
      implicitFolder: Boolean(node.kind === "folder" && !explicitFolder),
    });
    setTreeContextActiveIndex(0);
  }

  async function runTreeContextAction(action: TreeContextAction) {
    if (!treeContextMenu) return;

    const { nodeKind, nodePath } = treeContextMenu;
    setTreeContextMenu(null);

    if (action === "open") {
      if (nodeKind === "file") {
        closeIntellisense();
        setSelectedPath(nodePath);
      } else {
        toggleFolder(nodePath);
      }
      return;
    }

    if (action === "new-file" && nodeKind === "folder") {
      await addProjectEntryAt(nodePath, "file");
      return;
    }

    if (action === "new-folder" && nodeKind === "folder") {
      await addProjectEntryAt(nodePath, "folder");
      return;
    }

    if (action === "rename") {
      await renameProjectEntry(nodePath);
      return;
    }

    if (action === "delete") {
      await deleteProjectEntry(nodePath);
    }
  }

  function onTreeContextMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!treeContextItems.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setTreeContextActiveIndex((current) => (current + 1) % treeContextItems.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setTreeContextActiveIndex((current) => (current - 1 + treeContextItems.length) % treeContextItems.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void runTreeContextAction(treeContextItems[boundedTreeContextActiveIndex]?.action || "open");
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setTreeContextMenu(null);
    }
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => ({
      ...current,
      [path]: !(current[path] ?? autoExpandedFolders[path] ?? false),
    }));
  }

  async function addProjectEntryAt(parentFolderPath = "", kind: "file" | "folder") {
    const value = await promptModal(
      kind === "folder" ? "New subfolder" : "New file",
      kind === "folder" ? "Folder name" : "File name",
      kind === "folder" ? "" : "new.tex",
      "Create"
    );
    if (!value) return;

    const cleaned = value.trim().replace(/^\/+/, "");
    if (!cleaned) return;

    const normalized = `${parentFolderPath}${cleaned}${kind === "folder" ? "/" : ""}`;
    const exists = projectEntries.some((entry) => entry.path === normalized);
    if (exists) {
      setAddFileError("A file or folder with this path already exists.");
      return;
    }

    const folderSeeds = new Set<string>();
    const seedSource = kind === "folder" ? normalized : normalized.slice(0, Math.max(0, normalized.lastIndexOf("/") + 1));
    if (seedSource) {
      const parts = seedSource.split("/").filter(Boolean);
      let cursor = "";
      for (const part of parts) {
        cursor += `${part}/`;
        folderSeeds.add(cursor);
      }
    }

    const nextEntries: ProjectEntry[] = [];
    for (const folderPath of folderSeeds) {
      if (!projectEntries.some((entry) => entry.path === folderPath)) {
        nextEntries.push({ path: folderPath, kind: "folder", content: "" });
      }
    }

    nextEntries.push({
      path: normalized,
      kind,
      content: kind === "file" ? nextTemplateFor(normalized) : "",
    });

    setProjectEntries((current) => [...current, ...nextEntries]);
    if (kind === "file") {
      closeIntellisense();
      setSelectedPath(normalized);
    }
    setExpandedFolders((current) => ({
      ...current,
      [parentFolderPath]: true,
    }));
    setAddFileError("");
  }

  useEffect(() => {
    if (!activeResizer) return;

    const onMouseMove = (event: MouseEvent) => {
      const container = panesRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (activeResizer === "left") {
        const nextWidth = clamp(event.clientX - rect.left, 160, 380);
        setLeftPaneWidth(nextWidth);
      } else {
        const nextWidth = clamp(rect.right - event.clientX, 220, 480);
        setRightPaneWidth(nextWidth);
      }
    };

    const onMouseUp = () => {
      setActiveResizer(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeResizer]);

  useEffect(() => {
    return () => {
      if (compiledPdfUrl) {
        URL.revokeObjectURL(compiledPdfUrl);
      }
    };
  }, [compiledPdfUrl]);

  function persistProjectSnapshot(snapshot: SavedProjectData) {
    setSavedProjectSnapshots((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 20));
    setSavedProjects((current) => {
      const meta: SavedProjectMeta = {
        id: snapshot.id,
        name: snapshot.name,
        updatedAt: snapshot.updatedAt,
      };
      return [meta, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 20);
    });
  }

  async function fetchProjectsFromServer() {
    const response = await fetch("/api/research-projects", { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Could not load projects from your account.");
    }

    const payload = (await response.json()) as { projects?: SavedProjectData[] };
    return Array.isArray(payload.projects) ? payload.projects : [];
  }

  async function upsertProjectSnapshotToServer(snapshot: SavedProjectData) {
    const response = await fetch("/api/research-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Could not save the project to your account.");
    }
  }

  async function deleteProjectSnapshotFromServer(projectId: string) {
    const response = await fetch(`/api/research-projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Could not delete the project from your account.");
    }
  }

  function queueServerProjectSync(snapshot: SavedProjectData) {
    if (!userId || accountSyncUnavailable) return;
    void upsertProjectSnapshotToServer(snapshot).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not sync this project.";
      if (isAccountSyncUnavailableMessage(message)) {
        setAccountSyncUnavailable(true);
        setCompileNotice("Saved locally. Account sync is unavailable on this deployment.");
        return;
      }
      appendPreviewError(`Account sync failed: ${message}`);
      setCompileNotice("Saved locally, but account sync failed.");
    });
  }

  function queueServerProjectDeletion(projectId: string) {
    if (!userId || accountSyncUnavailable) return;
    void deleteProjectSnapshotFromServer(projectId).catch((error) => {
      const message = error instanceof Error ? error.message : "Could not delete this project from your account.";
      if (isAccountSyncUnavailableMessage(message)) {
        setAccountSyncUnavailable(true);
        return;
      }
      appendPreviewError(`Account delete failed: ${message}`);
    });
  }

  const applySyncedProjects = useEffectEvent((projects: SavedProjectData[], notice: string) => {
    if (!projects.length) return;
    const nextActive = projects.find((project) => project.id === activeProjectId) ?? projects[0];

    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);

    closeIntellisense();
    setSavedProjectSnapshots(projects.slice(0, 20));
    setSavedProjects(
      projects.map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt })).slice(0, 20)
    );
    setActiveProjectId(nextActive.id);
    setProjectName(nextActive.name);
    setProjectEntries(nextActive.entries);
    setSelectedPath(nextActive.selectedPath || "main.tex");
    setAddFileError("");
    setCompileBusy(false);
    setCompiledPdfBlob(null);
    setCompiledPdfUrl("");
    setCompiledPdfFileName("compiled-main.pdf");
    setCompileMainLog("");
    setCompileMainLogFileName("main.log");
    setAiFixBusy(false);
    setAiFixError("");
    setAiFixSummary("");
    setAiFixSuggestions([]);
    setLastCompileAt(nextActive.lastCompileAt || "Not compiled yet");
    setCompileNotice(notice);
  });

  useEffect(() => {
    if (!authLoaded || !userId || hasHydratedServerProjectsRef.current) return;
    hasHydratedServerProjectsRef.current = true;

    let cancelled = false;

    async function hydrateFromServer() {
      try {
        const projects = await fetchProjectsFromServer();

        if (cancelled) return;

        if (!projects.length) {
          setCompileNotice("Create a project to start syncing this workspace to your account.");
          return;
        }

        applySyncedProjects(projects, "Projects synced from your account.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not sync your account projects.";
        if (isAccountSyncUnavailableMessage(message)) {
          setAccountSyncUnavailable(true);
          setCompileNotice("Account sync is unavailable on this deployment. Projects stay local in this browser.");
          return;
        }
        appendPreviewError(`Account sync failed: ${message}`);
      }
    }

    void hydrateFromServer();

    return () => {
      cancelled = true;
    };
  }, [authLoaded, userId]);

  function buildCurrentProjectSnapshot(overrides?: Partial<SavedProjectData>): SavedProjectData {
    const now = new Date().toISOString();
    return {
      id: overrides?.id ?? activeProjectId,
      name: overrides?.name ?? projectName,
      entries: overrides?.entries ?? projectEntries,
      selectedPath: overrides?.selectedPath ?? selectedPath,
      lastCompileAt: overrides?.lastCompileAt ?? lastCompileAt,
      updatedAt: overrides?.updatedAt ?? now,
    };
  }

  function saveCurrentProject() {
    try {
      const snapshot = buildCurrentProjectSnapshot();
      persistProjectSnapshot(snapshot);
      queueServerProjectSync(snapshot);

      setCompileNotice(
        usesAccountStorage
          ? "Project saved to your account-backed workspace."
          : "Project saved. You can reopen it from Saved Projects."
      );
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Project save failed.";
      setCompileNotice(message);
      appendPreviewError(`Save failed: ${message}`);
    }
  }

  function loadSavedProject(projectId: string) {
    const saved = savedProjectSnapshots.find((project) => project.id === projectId) || null;
    if (!saved) {
      setCompileNotice("Could not load this project. It may be corrupted or removed.");
      return;
    }

    closeIntellisense();

    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);

    setActiveProjectId(saved.id);
    setProjectName(saved.name);
    setProjectEntries(saved.entries);
    setSelectedPath(saved.selectedPath || "main.tex");
    setAddFileError("");
    setCompileBusy(false);
    setCompiledPdfBlob(null);
    setCompiledPdfUrl("");
    setCompiledPdfFileName("compiled-main.pdf");
    setAiFixBusy(false);
    setAiFixError("");
    setAiFixSummary("");
    setAiFixSuggestions([]);
    setLastCompileAt(saved.lastCompileAt || "Not compiled yet");
    setCompileNotice(`Loaded project: ${saved.name}`);
    setWorkspaceScreen("editor");
  }

  async function deleteSavedProject(projectId: string) {
    const target = savedProjects.find((item) => item.id === projectId);
    if (!target) return;
    const confirmed = await confirmModal(
      "Delete project?",
      `Delete saved project "${target.name}"? This cannot be undone.`,
      "Delete",
      true
    );
    if (!confirmed) return;

    queueServerProjectDeletion(projectId);

    const nextSnapshots = savedProjectSnapshots.filter((project) => project.id !== projectId);
    setSavedProjectSnapshots(nextSnapshots);

    setSavedProjects((current) => {
      const nextProjects = current.filter((item) => item.id !== projectId);

      if (projectId === activeProjectId) {
        if (nextSnapshots.length) {
          const fallback = nextSnapshots[0];
          setActiveProjectId(fallback.id);
          setProjectName(fallback.name);
          setProjectEntries(fallback.entries);
          setSelectedPath(fallback.selectedPath || "main.tex");
          setLastCompileAt(fallback.lastCompileAt || "Not compiled yet");
        } else {
          setActiveProjectId("starter-project");
          setProjectName("WiserFiles Research Draft");
          setProjectEntries(STARTER_PROJECT);
          setSelectedPath("main.tex");
          setLastCompileAt("Not compiled yet");
        }
      }

      return nextProjects;
    });
    setCompileNotice(`Deleted saved project: ${target.name}`);

    if (projectId === activeProjectId) {
      setWorkspaceScreen("projects");
    }
  }

  async function renameSavedProject(projectId: string) {
    const target = savedProjects.find((item) => item.id === projectId);
    if (!target) return;

    const nextName = await promptModal("Rename project", "Project name", target.name, "Rename");
    if (!nextName || nextName === target.name) return;

    const updatedAt = new Date().toISOString();
    setSavedProjects((current) =>
      current.map((item) => (item.id === projectId ? { ...item, name: nextName, updatedAt } : item))
    );

    const snapshot = savedProjectSnapshots.find((project) => project.id === projectId) || null;
    if (snapshot) {
      const nextSnapshot = {
        ...snapshot,
        name: nextName,
        updatedAt,
      };
      persistProjectSnapshot(nextSnapshot);
      queueServerProjectSync(nextSnapshot);
    }

    if (projectId === activeProjectId) {
      setProjectName(nextName);
      setCompileNotice(`Renamed project to ${nextName}.`);
    }
  }

  function updateActiveFile(nextContent: string) {
    if (!activeEntry) return;
    setProjectEntries((current) =>
      current.map((entry) =>
        entry.path === activeEntry.path && entry.kind === "file"
          ? { ...entry, content: nextContent }
          : entry
      )
    );
    setAutoSaveStatus("unsaved");
  }

  function createProjectFromTemplate(template: ResearchTemplate) {
    if (!userId && savedProjects.length >= GUEST_PROJECT_LIMIT) {
      setCompileNotice("Guest limit reached: sign in to create more than 5 projects.");
      return;
    }
    const nextProjectId = makeProjectId();
    const name = template.name;
    const createdAt = new Date().toISOString();
    const snapshot: SavedProjectData = {
      id: nextProjectId,
      name,
      entries: template.entries,
      selectedPath: "main.tex",
      lastCompileAt: "Not compiled yet",
      updatedAt: createdAt,
    };
    persistProjectSnapshot(snapshot);
    queueServerProjectSync(snapshot);
    setSavedProjects((current) => [
      { id: nextProjectId, name, updatedAt: createdAt },
      ...current.filter((item) => item.id !== nextProjectId),
    ]);
    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);
    closeIntellisense();
    setActiveProjectId(nextProjectId);
    setProjectName(name);
    setProjectEntries(template.entries);
    setSelectedPath("main.tex");
    setAddFileError("");
    setCompileBusy(false);
    setCompiledPdfBlob(null);
    setCompiledPdfUrl("");
    setCompiledPdfFileName("compiled-main.pdf");
    setAiFixBusy(false);
    setAiFixError("");
    setAiFixSummary("");
    setAiFixSuggestions([]);
    setLastCompileAt("Not compiled yet");
    setCompileNotice(`Created project from "${template.name}" template.`);
    setWorkspaceScreen("editor");
  }

  async function addProjectFile() {
    const normalized = newPath.trim();
    if (!normalized) {
      setAddFileError("Enter a file path.");
      return;
    }

    const exists = projectEntries.some((entry) => entry.path === normalized);
    if (exists) {
      setAddFileError("A file or folder with this path already exists.");
      return;
    }

    const isFolder = normalized.endsWith("/");
    const folderSeeds = new Set<string>();
    const seedSource = isFolder ? normalized : normalized.slice(0, Math.max(0, normalized.lastIndexOf("/") + 1));
    if (seedSource) {
      const parts = seedSource.split("/").filter(Boolean);
      let cursor = "";
      for (const part of parts) {
        cursor += `${part}/`;
        folderSeeds.add(cursor);
      }
    }

    const nextEntries: ProjectEntry[] = [];
    for (const folderPath of folderSeeds) {
      if (!projectEntries.some((entry) => entry.path === folderPath)) {
        nextEntries.push({ path: folderPath, kind: "folder", content: "" });
      }
    }

    nextEntries.push({
      path: normalized,
      kind: isFolder ? "folder" : "file",
      content: isFolder ? "" : nextTemplateFor(normalized),
    });

    setProjectEntries((current) => [...current, ...nextEntries]);
    if (!isFolder) setSelectedPath(normalized);
    setNewPath("");
    setAddFileError("");
  }

  async function createNewProject() {
    if (!userId && savedProjects.length >= GUEST_PROJECT_LIMIT) {
      setCompileNotice("Guest limit reached: sign in to create more than 5 projects.");
      await Swal.fire({
        title: "Project limit reached",
        text: "Guest users can save up to 5 projects. Sign in or create an account to continue creating projects.",
        icon: "info",
        confirmButtonText: "OK",
        confirmButtonColor: "#0f766e",
        background: "#ffffff",
      });
      return;
    }

    const name = await promptModal("New project", "Project name", "", "Create");
    if (!name) return;

    const nextProjectId = makeProjectId();
    const freshEntries = createFreshProjectEntries(name);
    const createdAt = new Date().toISOString();
    const snapshot: SavedProjectData = {
      id: nextProjectId,
      name,
      entries: freshEntries,
      selectedPath: "main.tex",
      lastCompileAt: "Not compiled yet",
      updatedAt: createdAt,
    };

    persistProjectSnapshot(snapshot);
    queueServerProjectSync(snapshot);
    setSavedProjects((current) => [
      { id: nextProjectId, name, updatedAt: createdAt },
      ...current.filter((item) => item.id !== nextProjectId),
    ]);

    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);
    closeIntellisense();
    setActiveProjectId(nextProjectId);
    setProjectName(name);
    setProjectEntries(freshEntries);
    setSelectedPath("main.tex");
    setAddFileError("");
    setCompileBusy(false);
    setCompiledPdfBlob(null);
    setCompiledPdfUrl("");
    setCompiledPdfFileName("compiled-main.pdf");
    setAiFixBusy(false);
    setAiFixError("");
    setAiFixSummary("");
    setAiFixSuggestions([]);
    setLastCompileAt("Not compiled yet");
    setCompileNotice("New project created and saved. Add files and compile when ready.");
    setWorkspaceScreen("editor");
  }

  function openProjectsBoard() {
    setWorkspaceScreen("projects");
  }

  async function renameProjectEntry(targetPath: string) {
    const target = projectEntries.find((entry) => entry.path === targetPath);
    if (!target) return;

    const suggested = target.path;
    const normalized = await promptModal("Rename file or folder", "Path", suggested, "Rename");
    if (!normalized || normalized === target.path) return;

    const folderRename = target.kind === "folder";
    const nextBase = folderRename && !normalized.endsWith("/") ? `${normalized}/` : normalized;

    const conflict = projectEntries.some((entry) => {
      if (entry.path === target.path) return false;
      if (!folderRename) return entry.path === nextBase;
      return entry.path === nextBase || entry.path.startsWith(nextBase);
    });

    if (conflict) {
      setAddFileError("Rename target conflicts with existing files or folders.");
      return;
    }

    setProjectEntries((current) =>
      current.map((entry) => {
        if (!folderRename) {
          return entry.path === target.path ? { ...entry, path: nextBase } : entry;
        }

        if (entry.path === target.path || entry.path.startsWith(target.path)) {
          const suffix = entry.path.slice(target.path.length);
          return { ...entry, path: `${nextBase}${suffix}` };
        }

        return entry;
      })
    );

    setSelectedPath((current) => {
      if (!folderRename) {
        return current === target.path ? nextBase : current;
      }
      if (current === target.path || current.startsWith(target.path)) {
        const suffix = current.slice(target.path.length);
        return `${nextBase}${suffix}`;
      }
      return current;
    });
    setAddFileError("");
  }

  async function showProjectEntryActions(entry: ProjectEntry) {
    const action = await projectEntryActionSheet(entry);
    if (action.isConfirmed) {
      if (entry.kind === "file") {
        closeIntellisense();
        setSelectedPath(entry.path);
      }
      return;
    }

    if (action.isDenied) {
      await renameProjectEntry(entry.path);
      return;
    }

    if (action.dismiss === Swal.DismissReason.cancel) {
      await deleteProjectEntry(entry.path);
    }
  }

  async function deleteProjectEntry(targetPath: string) {
    const target = projectEntries.find((entry) => entry.path === targetPath);
    if (!target) return;

    const confirmed = await confirmModal("Delete file or folder?", `Delete ${target.path}?`, "Delete", true);
    if (!confirmed) return;

    const nextEntries = projectEntries.filter((entry) => {
      if (target.kind === "file") {
        return entry.path !== target.path;
      }
      return !(entry.path === target.path || entry.path.startsWith(target.path));
    });

    const nextFiles = nextEntries.filter((entry) => entry.kind === "file");
    if (!nextFiles.length) {
      setAddFileError("At least one file must remain in the project.");
      return;
    }

    setProjectEntries(nextEntries);
    if (!nextEntries.some((entry) => entry.path === selectedPath && entry.kind === "file")) {
      setSelectedPath(nextFiles[0].path);
    }
    setAddFileError("");
  }

  async function compileProject() {
    const rootPath = editableFiles.some((entry) => entry.path === "main.tex") ? "main.tex" : activeEntry?.path;
    if (!rootPath) {
      setCompileNotice("No file available to compile.");
      return;
    }

    const normalizedFiles = editableFiles.map((entry) => {
      if (entry.path !== "main.tex") {
        return { path: entry.path, content: entry.content };
      }

      const repairedContent = entry.content.replace(/(^|\n)([ \t]*)itle\{/g, "$1$2\\title{");
      return { path: entry.path, content: repairedContent };
    });

    try {
      setCompileMainLog("");
      setCompileMainLogFileName("main.log");
      setPreviewErrorLogs([]);
      setAiFixError("");
      setAiFixSummary("");
      setAiFixSuggestions([]);
      setCompileBusy(true);
      setCompileNotice("Compiling project on server...");
      const response = await fetch("/api/latex-compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootFile: rootPath,
          files: normalizedFiles,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; mainLog?: string; mainLogFileName?: string }
          | null;

        if (payload?.mainLog) {
          setCompileMainLog(payload.mainLog);
          setCompileMainLogFileName(payload.mainLogFileName || "main.log");
        }

        throw new Error(payload?.error || "Compile failed.");
      }

      const blob = await response.blob();
      const previousUrl = compiledPdfUrl;
      const nextUrl = URL.createObjectURL(blob);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      setCompiledPdfBlob(blob);
      setCompiledPdfUrl(nextUrl);

      const downloadName =
        getFileNameFromDisposition(response.headers.get("Content-Disposition")) || "compiled-main.pdf";
      setCompiledPdfFileName(downloadName);
      setCompileMainLog("");
      setCompileMainLogFileName("main.log");
      setAiFixError("");
      setAiFixSummary("");
      setAiFixSuggestions([]);

      const engine = response.headers.get("X-Latex-Engine") || "server engine";
      setCompileNotice(`Compiled ${rootPath} using ${engine}.`);

      // Try to fetch SyncTeX data
      try {
        const synctexRes = await fetch(`/api/latex-compile?synctex=1&root=${encodeURIComponent(rootPath)}`, {
          cache: "no-store",
        });
        if (synctexRes.ok) {
          const synctexBuf = await synctexRes.arrayBuffer();
          const records = await parseSynctexGzBuffer(synctexBuf);
          setSynctexRecords(records);
          if (records.length) {
            setSynctexNotice("");
          } else {
            setSynctexNotice("SyncTeX data available but no records parsed.");
          }
        }
      } catch {
        setSynctexNotice("SyncTeX not available for this compile.");
      }
      const compiledAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLastCompileAt(compiledAt);

      const snapshot = buildCurrentProjectSnapshot({ lastCompileAt: compiledAt });
      persistProjectSnapshot(snapshot);
      queueServerProjectSync(snapshot);
      setSavedProjects((current) => {
        const meta: SavedProjectMeta = {
          id: snapshot.id,
          name: snapshot.name,
          updatedAt: snapshot.updatedAt,
        };
        return [meta, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 20);
      });
    } catch (compileError) {
      const message = compileError instanceof Error ? compileError.message : "Compile failed.";
      if (message.includes("No LaTeX engine available")) {
        const detailed = `${message} For local dev, install latexmk + texlive packages. For Docker, rebuild the image after updating dependencies.`;
        setCompileNotice("Ready.");
        appendPreviewError(`Compile failed: ${detailed}`);
      } else {
        setCompileNotice("Ready.");
        appendPreviewError(`Compile failed: ${message}`);
      }
    } finally {
      setCompileBusy(false);
    }
  }

  async function fetchAiFixSuggestions() {
    if (!compileMainLog.trim()) {
      setAiFixError("Compile the project first or open an available main.log.");
      return;
    }

    try {
      setAiFixBusy(true);
      setAiFixError("");
      const rootPath = editableFiles.some((entry) => entry.path === "main.tex") ? "main.tex" : activeEntry?.path || "main.tex";

      const response = await fetch("/api/latex-fix-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootFile: rootPath,
          mainLog: compileMainLog,
          files: editableFiles.map((entry) => ({ path: entry.path, content: entry.content })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Could not fetch AI suggestions.");
      }

      const payload = (await response.json()) as {
        summary?: string;
        fixes?: AiFixSuggestion[];
      };

      setAiFixSummary(payload.summary || "AI suggestions are ready.");
      setAiFixSuggestions(Array.isArray(payload.fixes) ? payload.fixes : []);
      if (!payload.fixes?.length) {
        setAiFixError("No concrete fixes returned. Try compiling again for a fresher log.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI suggestion request failed.";
      setAiFixError(message);
      appendPreviewError(`AI suggestions failed: ${message}`);
    } finally {
      setAiFixBusy(false);
    }
  }

  function applyAiPatchToActiveFile(rawPatch: string) {
    if (!activeEntry || activeEntry.kind !== "file") {
      setAiFixError("Select a file before applying an AI patch.");
      return;
    }

    const snippet = normalizeAiPatchSnippet(rawPatch);
    if (!isValidAiPatchSnippet(snippet)) {
      setAiFixError("The suggestion does not include a valid LaTeX snippet to apply.");
      return;
    }

    const source = activeEntry.content;
    const textarea = editorRef.current;
    const hasSelection = Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd);
    const selectionStart = textarea ? textarea.selectionStart : source.length;
    const selectionEnd = textarea ? textarea.selectionEnd : source.length;
    const replaceStart = hasSelection ? selectionStart : source.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const lineEndIndex = source.indexOf("\n", hasSelection ? selectionEnd : selectionStart);
    const replaceEnd = hasSelection ? selectionEnd : lineEndIndex === -1 ? source.length : lineEndIndex;
    const needsTrailingNewline = !hasSelection && replaceEnd < source.length && !snippet.endsWith("\n");
    const replacementText = needsTrailingNewline ? `${snippet}\n` : snippet;

    const nextText = `${source.slice(0, replaceStart)}${replacementText}${source.slice(replaceEnd)}`;
    const cursor = replaceStart + replacementText.length;

    setAiFixError("");
    setCompileNotice("Applied AI suggestion to the active file.");
    applyEditorUpdate(nextText, cursor, cursor);
  }

  async function downloadProjectBundle() {
    const zip = new JSZip();
    for (const entry of projectEntries) {
      if (entry.kind === "folder") continue;
      zip.file(entry.path, entry.content);
    }

    if (compiledPdfBlob) {
      zip.file(`build/${compiledPdfFileName}`, compiledPdfBlob);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "research-project.zip");
  }

  function applyEditorUpdate(nextText: string, selectionStart: number, selectionEnd: number) {
    updateActiveFile(nextText);
    window.requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function insertEditorSnippet(snippet: EditorSnippet) {
    if (!activeEntry) return;
    const textarea = editorRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = activeSource.slice(start, end);
    const innerText = selected || snippet.placeholder || "";
    const replacement = snippet.block ?? `${snippet.before}${innerText}${snippet.after}`;
    const nextText = `${activeSource.slice(0, start)}${replacement}${activeSource.slice(end)}`;
    const selectionStart = start + (snippet.cursorOffset ?? snippet.before.length);
    const selectionEnd = selectionStart + innerText.length;

    updateActiveFile(nextText);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function focusMatch(index: number) {
    const match = findMatches[index];
    if (!match) return;
    setActiveMatchIndex(index);
    window.requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
    });
  }

  function jumpToNextMatch(direction: 1 | -1) {
    if (!findMatches.length) return;
    const next = (boundedActiveMatchIndex + direction + findMatches.length) % findMatches.length;
    focusMatch(next);
  }

  function replaceCurrentMatch() {
    const current = findMatches[boundedActiveMatchIndex];
    if (!current) return;
    const nextText =
      activeSource.slice(0, current.start) + replaceQuery + activeSource.slice(current.end);
    const cursor = current.start + replaceQuery.length;
    applyEditorUpdate(nextText, cursor, cursor);
  }

  function replaceAllMatches() {
    if (!findMatches.length) return;
    let nextText = activeSource;
    for (let i = findMatches.length - 1; i >= 0; i -= 1) {
      const match = findMatches[i];
      nextText = nextText.slice(0, match.start) + replaceQuery + nextText.slice(match.end);
    }
    applyEditorUpdate(nextText, 0, 0);
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    const text = activeSource;
    const isMod = event.ctrlKey || event.metaKey;

    if (isMod) {
      const key = event.key.toLowerCase();
      const passThroughShortcuts = new Set([
        "a", // select all
        "c", // copy
        "v", // paste
        "x", // cut
        "z", // undo
        "y", // redo (Windows/Linux)
      ]);

      if (passThroughShortcuts.has(key) || (event.shiftKey && key === "z")) {
        return;
      }
    }

    if (intellisenseOptions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIntellisenseIndex((current) => (current + 1) % intellisenseOptions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIntellisenseIndex((current) => (current - 1 + intellisenseOptions.length) % intellisenseOptions.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyIntellisenseSelection();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeIntellisense();
        return;
      }
    }

    if (event.key === "Escape" && (findPanelOpen || replacePanelOpen)) {
      event.preventDefault();
      setFindPanelOpen(false);
      setReplacePanelOpen(false);
      return;
    }

    if (isMod && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindPanelOpen(true);
      setReplacePanelOpen(false);
      return;
    }

    if (isMod && event.key.toLowerCase() === "h") {
      event.preventDefault();
      setFindPanelOpen(true);
      setReplacePanelOpen(true);
      return;
    }

    if (isMod && event.key.toLowerCase() === "g") {
      event.preventDefault();
      jumpToNextMatch(event.shiftKey ? -1 : 1);
      return;
    }

    if (isMod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void compileProject();
      return;
    }

    if (isMod && event.key === "Enter") {
      event.preventDefault();
      void compileProject();
      return;
    }

    if (isMod && event.key === "/") {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const blockEnd = (() => {
        const index = text.indexOf("\n", end);
        return index === -1 ? text.length : index;
      })();

      const block = text.slice(blockStart, blockEnd);
      const lines = block.split("\n");
      const allCommented = lines.every((line) => !line.trim() || line.trimStart().startsWith("%"));
      const nextLines = allCommented
        ? lines.map((line) => line.replace(/^(\s*)%\s?/, "$1"))
        : lines.map((line) => (line.trim() ? line.replace(/^(\s*)(.*)$/, "$1% $2") : line));

      const nextBlock = nextLines.join("\n");
      const nextText = `${text.slice(0, blockStart)}${nextBlock}${text.slice(blockEnd)}`;
      applyEditorUpdate(nextText, blockStart, blockStart + nextBlock.length);
      return;
    }

    if (isMod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (textarea.selectionStart !== textarea.selectionEnd) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = text.slice(start, end);
        const nextText = `${text.slice(0, end)}${selected}${text.slice(end)}`;
        applyEditorUpdate(nextText, end, end + selected.length);
        return;
      }

      const cursor = textarea.selectionStart;
      const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
      const lineEndIndex = text.indexOf("\n", cursor);
      const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
      const line = text.slice(lineStart, lineEnd);
      const nextText = `${text.slice(0, lineEnd)}\n${line}${text.slice(lineEnd)}`;
      const nextCursor = lineEnd + 1 + line.length;
      applyEditorUpdate(nextText, nextCursor, nextCursor);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const blockEnd = (() => {
        const index = text.indexOf("\n", end);
        return index === -1 ? text.length : index;
      })();

      const block = text.slice(blockStart, blockEnd);
      const lines = block.split("\n");
      const nextLines = event.shiftKey
        ? lines.map((line) => line.replace(/^(\t|  )/, ""))
        : lines.map((line) => `  ${line}`);
      const nextBlock = nextLines.join("\n");
      const nextText = `${text.slice(0, blockStart)}${nextBlock}${text.slice(blockEnd)}`;
      applyEditorUpdate(nextText, blockStart, blockStart + nextBlock.length);
    }
  }

  function renderProjectTree(nodes: ProjectTreeNode[], depth = 0): React.ReactNode {
    return nodes.map((node) => {
      const isFolder = node.kind === "folder";
      const expanded = isFolder ? (expandedFolders[node.path] ?? autoExpandedFolders[node.path] ?? false) : false;
      const explicitFolder = isFolder
        ? projectEntries.find((entry) => entry.path === node.path && entry.kind === "folder")
        : undefined;

      return (
        <li key={node.path || node.name}>
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: `${depth * 10}px` }}
            onContextMenu={(event) => openTreeContextMenu(event, node, explicitFolder)}
          >
            {isFolder ? (
              <button
                type="button"
                onClick={() => toggleFolder(node.path)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600"
                aria-label={expanded ? `Collapse ${node.path}` : `Expand ${node.path}`}
              >
                <svg
                  viewBox="0 0 20 20"
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : "rotate-0"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="h-6 w-6" aria-hidden="true" />
            )}

            <button
              type="button"
              onClick={() => {
                if (!isFolder) {
                  closeIntellisense();
                  setSelectedPath(node.path);
                }
              }}
              className={`flex-1 rounded-md border px-2 py-1 text-left text-xs ${
                isFolder
                  ? "border-slate-200 bg-slate-100 text-slate-600"
                  : selectedPath === node.path
                    ? "border-cyan-300 bg-cyan-50 text-cyan-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {isFolder ? `${node.name || "root"}/` : node.name}
            </button>

            {isFolder ? (
              <>
                <button
                  type="button"
                  onClick={() => void addProjectEntryAt(node.path, "file")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                  aria-label={`Add file in ${node.path || "root"}`}
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void addProjectEntryAt(node.path, "folder")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                  aria-label={`Add folder in ${node.path || "root"}`}
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 6h5l1.2 1.5H17v7.5H3V6z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            ) : null}

            {isFolder && !explicitFolder ? null : (
              <button
                type="button"
                onClick={() => void showProjectEntryActions(explicitFolder || { path: node.path, kind: "file", content: "" })}
                className="group relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                aria-label={`Entry actions for ${node.path}`}
              >
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 10h.01M10 10h.01M16 10h.01" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                  Actions
                </span>
              </button>
            )}
          </div>

          {isFolder && expanded && node.children?.length ? (
            <ul className="mt-1 space-y-1">{renderProjectTree(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });
  }

  const effectiveLeftPaneWidth = leftPaneCollapsed ? 34 : leftPaneWidth;
  const effectiveRightPaneWidth = rightPaneCollapsed ? 34 : rightPaneWidth;

  if (workspaceScreen === "projects") {
    return (
      <main className="depth-stage mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-6 py-5 md:px-10 md:py-6">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Projects</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Research Document Studio
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-700 md:text-base">
                Create, reopen, rename, and delete projects here. Open one to enter the file editor.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50/80 px-3 py-2">
                {usesAccountStorage ? (
                  <>
                    <span className="rounded-full border border-cyan-300 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-900">
                      Account sync active
                    </span>
                    <p className="text-xs text-cyan-900">
                      Projects now persist to your signed-in workspace on the server.
                    </p>
                  </>
                ) : isSignedIn ? (
                  <p className="text-xs text-cyan-900">
                    Signed in. Account sync is unavailable on this deployment, so projects stay local in this browser.
                  </p>
                ) : authLoaded ? (
                  <>
                    <p className="text-xs text-cyan-900">
                      Sign in or create an account to keep projects synced beyond this browser.
                    </p>
                    <SignUpButton mode="modal">
                      <button
                        type="button"
                        className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700"
                      >
                        Create account
                      </button>
                    </SignUpButton>
                    <SignInButton mode="modal">
                      <button
                        type="button"
                        className="rounded-full border border-cyan-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-cyan-900 transition hover:bg-cyan-100"
                      >
                        Sign in
                      </button>
                    </SignInButton>
                  </>
                ) : (
                  <p className="text-xs text-cyan-900">Checking account sync status...</p>
                )}
              </div>
              </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createNewProject}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-400/30 transition hover:scale-105 hover:shadow-xl hover:shadow-cyan-400/40"
                aria-label="Create new project from scratch"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 3h5l3 3v11H7V3h4z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 3v3H3v12h12v-3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 3v3h3M14 13v3M12.5 14.5h3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                New From Scratch
              </button>
              <button
                type="button"
                onClick={async () => {
                  const templateOptions = RESEARCH_TEMPLATES.reduce((acc, t) => {
                    acc[t.slug] = t.name;
                    return acc;
                  }, {} as Record<string, string>);
                  const result = await Swal.fire({
                    title: "New from Template",
                    input: "select",
                    inputOptions: templateOptions,
                    inputPlaceholder: "Select a template",
                    inputValue: Object.keys(templateOptions)[0] || "",
                    showCancelButton: true,
                    confirmButtonText: "Create",
                    cancelButtonText: "Cancel",
                    confirmButtonColor: "#0f766e",
                    cancelButtonColor: "#e2e8f0",
                    background: "#f8fafc",
                    customClass: {
                      input: "swal-template-select",
                    },
                  });
                  if (result.isConfirmed && result.value) {
                    const template = getTemplateBySlug(result.value);
                    if (template) createProjectFromTemplate(template);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-purple-400/30 transition hover:scale-105 hover:shadow-xl hover:shadow-purple-400/40"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 3h9l3 3v11H4V3z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 3v3h3M8 11h4M8 14h2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                New from Template
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              {usesAccountStorage
                ? "Projects sync to your signed-in account and are also cached in this browser."
                : "Projects are stored locally in this browser."}
            </p>
          </div>

          {savedProjects.length === 0 && !usesAccountStorage ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                  <path d="M14 2v6h6M8 13h4M8 17h8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-700">No projects yet</p>
              <p className="text-xs text-slate-500 max-w-xs">Create a new project from scratch or choose a journal template to get started.</p>
            </div>
          ) : null}

            {savedProjects.length ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {savedProjects.map((item) => {
                  const isActive = item.id === activeProjectId;
                  return (
                    <article
                      key={item.id}
                      className={`rounded-xl border p-3 ${isActive ? "border-cyan-300 bg-cyan-100" : "border-slate-300 bg-slate-100"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <div
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${isActive ? "bg-cyan-200 text-cyan-900" : "bg-slate-200 text-slate-700"}`}
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M6 3h6l4 4v10H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M12 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950" style={{ color: "#0f172a" }}>
                              {item.name}
                            </p>
                            <p className="text-[11px] text-slate-600">Updated {new Date(item.updatedAt).toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (item.id !== activeProjectId) {
                                saveCurrentProject();
                              }
                              loadSavedProject(item.id);
                            }}
                            className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                            aria-label={`Open ${item.name}`}
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M6 4l9 6-9 6V4z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                              Open
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => renameSavedProject(item.id)}
                            className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                            aria-label={`Rename ${item.name}`}
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M4 14.5V16h1.5L15 6.5 13.5 5 4 14.5z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                              Rename
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedProject(item.id)}
                            className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100"
                            aria-label={`Delete ${item.name}`}
                          >
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M5 6h10M8 6V4h4v2m-5 0l.5 10h5L13 6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                              Delete
                            </span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : loadingProject ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-slate-100 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-slate-200" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 rounded bg-slate-200" />
                        <div className="h-3 w-1/2 rounded bg-slate-200" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
                  <svg viewBox="0 0 20 20" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6 3h6l4 4v10H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="mb-1 text-sm font-semibold text-slate-700">Create your first research project</p>
                <p className="mb-4 text-xs text-slate-500">Start with a blank project or choose a journal template to get going faster.</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={createNewProject}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-cyan-400/30 transition hover:scale-105 hover:shadow-xl hover:shadow-cyan-400/40"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 3h5l3 3v11H7V3h4z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M12 3v3h3M14 13v3M12.5 14.5h3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    New From Scratch
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const templateOptions = RESEARCH_TEMPLATES.reduce((acc, t) => {
                        acc[t.slug] = t.name;
                        return acc;
                      }, {} as Record<string, string>);
                      const result = await Swal.fire({
                        title: "New from Template",
                        input: "select",
                        inputOptions: templateOptions,
                        inputPlaceholder: "Select a template",
                        inputValue: Object.keys(templateOptions)[0] || "",
                        showCancelButton: true,
                        confirmButtonText: "Create",
                        cancelButtonText: "Cancel",
                        confirmButtonColor: "#0f766e",
                        cancelButtonColor: "#e2e8f0",
                        background: "#f8fafc",
                        customClass: {
                          input: "swal-template-select",
                        },
                      });
                      if (result.isConfirmed && result.value) {
                        const template = getTemplateBySlug(result.value);
                        if (template) createProjectFromTemplate(template);
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-purple-400/30 transition hover:scale-105 hover:shadow-xl hover:shadow-purple-400/40"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 3h9l3 3v11H4V3z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M12 3v3h3M8 11h4M8 14h2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    New from Template
                  </button>
                </div>
              </div>
            )}
        </section>
      </main>
    );
  }

  return (
    <main className="depth-stage mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-3 md:px-4 md:py-4">
      <header className="border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={openProjectsBoard}
            className="group relative inline-flex h-8 w-fit items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-700 transition hover:bg-slate-100"
            aria-label="Back to projects board"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Projects</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
              Back to projects
            </span>
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Scientific Workspace</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              Research Document Studio
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-700 md:text-base">
              Focused LaTeX editing layout with file tree, shortcuts, and live PDF preview.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-900">
              Project: {projectName}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              {usesAccountStorage
                ? "Signed in: projects are synced to your account-backed workspace."
                : isSignedIn
                  ? "Signed in: account sync storage is unavailable here, so projects stay in this browser."
                  : "Guest mode: projects stay in this browser until you sign in."}
            </p>
          </div>
          </div>
        </div>
      </header>

      <section
        ref={panesRef}
        className="grid grid-cols-1 lg:gap-0 lg:[grid-template-columns:var(--left-pane-width)_1px_minmax(0,1fr)_1px_var(--right-pane-width)]"
        style={
          {
            "--left-pane-width": `${effectiveLeftPaneWidth}px`,
            "--right-pane-width": `${effectiveRightPaneWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside
          className={`transition-[padding] border-r border-slate-200 ${leftPaneCollapsed ? "cursor-pointer p-1" : "p-1.5"}`}
          onClick={() => {
            if (leftPaneCollapsed) setLeftPaneCollapsed(false);
          }}
          role={leftPaneCollapsed ? "button" : undefined}
          aria-label={leftPaneCollapsed ? "Expand project files pane" : undefined}
        >
          <div className={`flex items-center gap-2 ${leftPaneCollapsed ? "justify-center" : "justify-end"}`}>
            {!leftPaneCollapsed ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Files</span>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setLeftPaneCollapsed((current) => !current);
              }}
              className="group relative rounded-md border border-slate-300 bg-white p-1 text-slate-700"
              aria-label={leftPaneCollapsed ? "Expand project files pane" : "Collapse project files pane"}
            >
              <svg
                viewBox="0 0 20 20"
                className={`h-4 w-4 transition-transform duration-200 ${leftPaneCollapsed ? "rotate-180" : "rotate-0"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                {leftPaneCollapsed ? (
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M13 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
              <span className="pointer-events-none absolute right-0 top-7 z-20 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white group-hover:block">
                {leftPaneCollapsed ? "Expand project files" : "Collapse project files"}
              </span>
            </button>
          </div>

          {!leftPaneCollapsed ? (
            <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-900">
              Active: {projectName}
            </p>
          ) : null}

          {!leftPaneCollapsed ? (
            <>
              <div className="mt-1.5 grid gap-1">
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => void compileProject()}
                    disabled={compileBusy}
                    className="group relative inline-flex h-8 items-center justify-center rounded-md border border-cyan-300 bg-cyan-50 text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-60"
                    aria-label={compileBusy ? "Compiling project" : "Compile project"}
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M7 6l7 4-7 4V6z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                      {compileBusy ? "Compiling..." : "Compile project"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void downloadProjectBundle()}
                    className="group relative inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                    aria-label="Download project bundle"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                      Download project
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={saveCurrentProject}
                    className="group relative inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                    aria-label="Save current project"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 3h10l2 2v12H4V3z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M7 3v5h6V3M7 14h6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                      Save project
                    </span>
                  </button>

                  <Link
                    href="/tools/pdf-to-latex"
                    className="group relative inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                    aria-label="Import PDF as TeX"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M6 3h6l3 3v11H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M12 3v3h3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                      Import PDF as .tex
                    </span>
                  </Link>
                </div>
              </div>

              <div className="mt-1.5 flex gap-1">
                <input
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  placeholder="sections/new.tex"
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                />
                <button
                  type="button"
                  onClick={addProjectFile}
                  className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-cyan-300 bg-cyan-50 text-cyan-900 transition hover:bg-cyan-100"
                  aria-label="Add file or folder"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                    Add
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void addProjectEntryAt("", "folder")}
                  className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                  aria-label="Add root folder"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 6h5l1.2 1.5H17v7.5H3V6z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                    New folder
                  </span>
                </button>
              </div>
              {addFileError ? <p className="mt-1 text-xs text-rose-700">{addFileError}</p> : null}
              <ul className="mt-2 space-y-1 text-sm text-slate-700">{renderProjectTree(projectTree)}</ul>
              <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Section Outline (active file)
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
                  {preview.sections.length ? (
                    preview.sections.map((section) => {
                      const isCollapsed = Boolean(collapsedOutlineSections[section.title]);
                      return (
                        <li key={section.title} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedOutlineSections((current) => ({
                                ...current,
                                [section.title]: !current[section.title],
                              }))
                            }
                            className="flex w-full items-center justify-between text-left font-medium text-slate-800"
                          >
                            <span className="truncate">{section.title}</span>
                            <span className="ml-2 text-[10px] text-slate-500">{isCollapsed ? "Expand" : "Collapse"}</span>
                          </button>
                          {!isCollapsed ? <p className="mt-1 text-[11px] text-slate-600">{section.body}</p> : null}
                        </li>
                      );
                    })
                  ) : (
                    <li className="text-slate-500">No sections found in current source.</li>
                  )}
                </ul>
              </div>
              <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-1.5 text-xs text-amber-900">
                Navigate folders with expand/collapse controls. Use + buttons on folders to add nested files and subfolders.
              </div>
            </>
          ) : null}
        </aside>

        <div
          className={`hidden items-center justify-center lg:flex ${leftPaneCollapsed ? "cursor-default" : "cursor-col-resize"}`}
          onMouseDown={() => {
            if (!leftPaneCollapsed) setActiveResizer("left");
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize project files pane"
        >
          <span className="h-20 w-1 rounded-full bg-slate-300" />
        </div>

          <div className="bg-white p-1.5">
            <div className="mb-1.5 border-b border-slate-200 pb-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Editor</p>
            </div>

            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{activeEntry?.path || "No file selected"}</p>

          <div className="mb-1.5 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-[11px] text-slate-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">Document</span>
              <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                Last compile: {lastCompileAt} {compileBusy ? "Compiling..." : "Ready"}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => void compileProject()}
                  disabled={compileBusy}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-cyan-500 to-cyan-700 px-4 text-sm font-bold text-white shadow-md shadow-cyan-500/30 transition hover:from-cyan-600 hover:to-cyan-800 hover:shadow-lg disabled:opacity-60"
                  aria-label={compileBusy ? "Compiling project" : "Compile project"}
                >
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 6l7 4-7 4V6z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{compileBusy ? "Compiling..." : "Compile"}</span>
                </button>
                <button
                  type="button"
                  onClick={saveCurrentProject}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-slate-800 transition hover:bg-slate-100"
                  aria-label="Save current project"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 3h10l2 2v12H4V3z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M7 3v5h6V3M7 14h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Save</span>
                </button>
                <button
                  type="button"
                  onClick={() => void downloadProjectBundle()}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-slate-800 transition hover:bg-slate-100"
                  aria-label="Download project bundle"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFindPanelOpen((current) => !current)}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-slate-800 transition hover:bg-slate-100"
                  aria-label={findPanelOpen ? "Hide find panel" : "Show find panel"}
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="9" cy="9" r="4" />
                    <path d="M12.5 12.5L16 16" strokeLinecap="round" />
                  </svg>
                  <span>{findPanelOpen ? "Hide Find" : "Find"}</span>
                </button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-start gap-1.5">
                <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Text</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\textbf{", after: "}", placeholder: "bold text" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert bold text"
                    >
                      <span className="text-xs font-bold">B</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Bold
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\textit{", after: "}", placeholder: "italic text" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert italic text"
                    >
                      <span className="text-xs font-semibold italic">I</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Italic
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\underline{", after: "}", placeholder: "underlined text" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert underlined text"
                    >
                      <span className="text-xs font-bold underline">U</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Underline
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\footnote{", after: "}", placeholder: "footnote text" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert footnote"
                    >
                      <span className="text-[10px] font-semibold">fn</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Footnote
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Structure</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\section{Section Title}\n", before: "", after: "", cursorOffset: 9 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert section"
                    >
                      <span className="text-xs font-semibold">S1</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Section
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\subsection{Subsection Title}\n", before: "", after: "", cursorOffset: 12 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert subsection"
                    >
                      <span className="text-xs font-semibold">S2</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Subsection
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\begin{itemize}\n  \\item Item one\n  \\item Item two\n\\end{itemize}\n", before: "", after: "", cursorOffset: 18 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert itemize list"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M7 5h9M7 10h9M7 15h9M4 5h.01M4 10h.01M4 15h.01" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Itemize
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\begin{enumerate}\n  \\item First\n  \\item Second\n\\end{enumerate}\n", before: "", after: "", cursorOffset: 19 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert enumerated list"
                    >
                      <span className="text-xs font-semibold">1.</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Enumerate
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Math</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "$", after: "$", placeholder: "math" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert inline math"
                    >
                      <span className="text-xs font-semibold">$</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Inline math
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\[\n  a^2 + b^2 = c^2\n\\]\n", before: "", after: "", cursorOffset: 4 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert display math"
                    >
                      <span className="text-[10px] font-semibold">[]</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Display math
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\begin{equation}\n  E = mc^2\n  \\label{eq:key}\n\\end{equation}\n", before: "", after: "", cursorOffset: 18 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert equation environment"
                    >
                      <span className="text-[10px] font-semibold">eq</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Equation
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ block: "\\begin{align}\n  y &= mx + b \\\\n  z &= ax^2 + bx + c\n\\end{align}\n", before: "", after: "", cursorOffset: 15 })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert align environment"
                    >
                      <span className="text-[10px] font-semibold">al</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Align
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Figures and Tables</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        insertEditorSnippet({
                          block:
                            "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/plot.png}\n  \\caption{Figure caption}\n  \\label{fig:plot}\n\\end{figure}\n",
                          before: "",
                          after: "",
                          cursorOffset: 62,
                        })
                      }
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert figure environment"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="3" y="4" width="14" height="12" rx="1.5" />
                        <circle cx="8" cy="8" r="1.2" />
                        <path d="M4.5 14l4.5-4 2.6 2 1.9-1.7L15.5 14" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Figure
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\includegraphics[width=0.8\\linewidth]{", after: "}", placeholder: "figures/image.png" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert includegraphics"
                    >
                      <span className="text-[10px] font-semibold">img</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Include image
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        insertEditorSnippet({
                          block:
                            "\\begin{table}[htbp]\n  \\centering\n  \\caption{Table caption}\n  \\label{tab:results}\n  \\begin{tabular}{lcc}\n    \\toprule\n    Item & Value A & Value B \\\\n    \\midrule\n    A & 1.0 & 2.0 \\\\n    B & 3.0 & 4.0 \\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n",
                          before: "",
                          after: "",
                          cursorOffset: 56,
                        })
                      }
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert table environment"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="3" y="4" width="14" height="12" rx="1" />
                        <path d="M3 8h14M3 12h14M8 4v12M12 4v12" />
                      </svg>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Table
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\begin{tabular}{lcc}\n", after: "\\end{tabular}\n", placeholder: "  Header A & Header B & Header C \\\\n  \\hline\n  A & B & C \\\\" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert tabular"
                    >
                      <span className="text-[10px] font-semibold">tab</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Tabular
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">References</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\label{", after: "}", placeholder: "sec:key" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert label"
                    >
                      <span className="text-[10px] font-semibold">lbl</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Label
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\ref{", after: "}", placeholder: "sec:key" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert ref"
                    >
                      <span className="text-[10px] font-semibold">ref</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Reference
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\cite{", after: "}", placeholder: "wiserfiles2026" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert citation"
                    >
                      <span className="text-[10px] font-semibold">cite</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Citation
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertEditorSnippet({ before: "\\href{", after: "}{link text}", placeholder: "https://example.com" })}
                      className="group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 transition hover:bg-slate-100"
                      aria-label="Insert hyperlink"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M8 12l4-4M7 7l-2 2a2.5 2.5 0 003.5 3.5l2-2M13 13l2-2a2.5 2.5 0 00-3.5-3.5l-2 2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                        Hyperlink
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {findPanelOpen ? (
            <div className="mb-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  placeholder="Find"
                  className="min-w-[180px] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                />
                <span className="text-xs text-slate-500">
                  {findMatches.length ? `${boundedActiveMatchIndex + 1}/${findMatches.length}` : "0/0"}
                </span>
                <button
                  type="button"
                  onClick={() => jumpToNextMatch(-1)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => jumpToNextMatch(1)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => setReplacePanelOpen((current) => !current)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  {replacePanelOpen ? "Hide Replace" : "Show Replace"}
                </button>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={findCaseSensitive}
                    onChange={(event) => setFindCaseSensitive(event.target.checked)}
                  />
                  Case
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={findUseRegex}
                    onChange={(event) => setFindUseRegex(event.target.checked)}
                  />
                  Regex
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={findWholeWord}
                    onChange={(event) => setFindWholeWord(event.target.checked)}
                  />
                  Whole word
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setFindPanelOpen(false);
                    setReplacePanelOpen(false);
                  }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>

              {replacePanelOpen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={replaceQuery}
                    onChange={(event) => setReplaceQuery(event.target.value)}
                    placeholder="Replace"
                    className="min-w-[180px] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={replaceCurrentMatch}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={replaceAllMatches}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    Replace All
                  </button>
                </div>
              ) : null}

              {findRegexError ? <p className="text-xs font-medium text-rose-700">{findRegexError}</p> : null}
            </div>
          ) : null}

          <div className={`grid gap-1.5 ${showMatchGutter ? "lg:grid-cols-[140px_minmax(0,1fr)]" : ""}`}>
            {showMatchGutter ? (
              <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-1.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match gutter</p>
                {matchLines.length ? (
                  <ul className="space-y-1">
                    {matchLines.map((line) => (
                      <li key={`match-line-${line.lineNumber}`}>
                        <button
                          type="button"
                          onClick={() => focusMatch(line.firstMatchIndex)}
                          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs text-slate-700 transition hover:border-cyan-300 hover:bg-cyan-50"
                        >
                          <p className="font-semibold text-cyan-900">L{line.lineNumber} ({line.count})</p>
                          <p className="truncate text-slate-600">{line.preview}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">No matches.</p>
                )}
              </div>
            ) : null}

            <div className="latex-editor-shell relative min-h-[68vh] overflow-hidden rounded-xl border border-slate-200">
              <pre
                aria-hidden="true"
                className="latex-highlight-layer pointer-events-none absolute inset-0 m-0 overflow-hidden p-3 font-mono text-sm leading-6"
                style={{ transform: `translate(${-editorScroll.left}px, ${-editorScroll.top}px)` }}
                dangerouslySetInnerHTML={{ __html: `${highlightedSource}\n` }}
              />
              <textarea
                ref={editorRef}
                value={activeSource}
                onChange={onEditorChange}
                onClick={onEditorCursorEvent}
                onKeyUp={onEditorCursorEvent}
                onScroll={onEditorCursorEvent}
                onKeyDown={onEditorKeyDown}
                onMouseMove={onEditorMouseMove}
                onMouseLeave={() => { if (equationHoverRef.current) clearTimeout(equationHoverRef.current); setEquationTooltip(null); }}
                onDragOver={onEditorDragOver}
                onDrop={onEditorDrop}
                disabled={!activeEntry}
                className="latex-editor-input research-editor relative z-10 min-h-[68vh] w-full resize-none border-0 bg-transparent p-3 font-mono text-sm leading-6 outline-none ring-cyan-400 focus:ring-2 disabled:opacity-60"
                spellCheck={true}
                lang="en"
              />

              {intellisenseOptions.length && intellisensePosition ? (
                <div
                  className="latex-intellisense-panel fixed z-30 w-72 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
                  style={{ top: `${intellisensePosition.top}px`, left: `${intellisensePosition.left}px` }}
                >
                  <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    LaTeX Intellisense
                  </p>
                  <ul className="max-h-56 overflow-auto">
                    {intellisenseOptions.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <button
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyIntellisenseSelection(index);
                          }}
                          className={`latex-intellisense-option w-full rounded-md px-2 py-1 text-left text-xs transition ${
                            index === intellisenseIndex
                              ? "bg-cyan-50 text-cyan-900"
                              : "bg-white text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <p className="font-semibold">\{item.label}</p>
                          <p className="text-[11px] text-slate-500">{item.detail}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {equationTooltip ? (
                <div
                  className="equation-preview-tooltip fixed z-30 max-w-sm rounded-lg border border-cyan-300 bg-white p-3 shadow-xl"
                  style={{ top: `${equationTooltip.top}px`, left: `${equationTooltip.left}px` }}
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      try {
                        return katex.renderToString(equationTooltip.latex, { displayMode: true, throwOnError: true });
                      } catch {
                        return '<span class="text-xs text-rose-600">Could not render equation</span>';
                      }
                    })(),
                  }}
                />
              ) : null}
            </div>

            {/* Status bar */}
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  <span className="font-semibold">Words:</span> {wordCount.words} · <span className="font-semibold">Chars:</span> {wordCount.chars}
                </span>
                {wordCount.abstractWords > 0 ? (
                  <span className={wordCount.abstractWords > 250 ? "font-semibold text-rose-600" : "text-slate-500"}>
                    Abstract: {wordCount.abstractWords}/250 words
                    {wordCount.abstractWords > 250 ? " (over limit!)" : ""}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowShortcuts((c) => !c)}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
                >
                  {showShortcuts ? "Hide Shortcuts" : "Shortcuts"}
                </button>
                <span className={autoSaveStatus === "saved" ? "text-emerald-600" : autoSaveStatus === "saving" ? "text-slate-500" : "text-amber-600"}>
                  {autoSaveStatus === "saved" ? `Saved ${autoSaveTimestamp || ""}` : autoSaveStatus === "saving" ? "Saving..." : "Unsaved changes"}
                </span>
              </div>
            </div>

            {/* Keyboard shortcuts panel */}
            {showShortcuts ? (
              <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-1.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Keyboard Shortcuts</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-slate-600">
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+S</kbd> / <kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Cmd+Enter</kbd> Compile</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+F</kbd> Find</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+H</kbd> Find & Replace</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+G</kbd> Next match</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+D</kbd> Duplicate line</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+/</kbd> Toggle comment</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Tab</kbd> Indent · <kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Shift+Tab</kbd> Outdent</div>
                  <div><kbd className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold shadow">Ctrl+Click PDF</kbd> Sync to source</div>
                  <div className="col-span-2 mt-1 text-[10px] text-slate-400">Right-click for browser spellcheck suggestions (spellcheck enabled)</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`hidden items-center justify-center lg:flex ${rightPaneCollapsed ? "cursor-default" : "cursor-col-resize"}`}
          onMouseDown={() => {
            if (!rightPaneCollapsed) setActiveResizer("right");
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview pane"
        >
          <span className="h-20 w-1 rounded-full bg-slate-300" />
        </div>

        <aside
          className={`transition-[padding] border-l border-slate-200 ${rightPaneCollapsed ? "cursor-pointer p-1" : "p-1.5"}`}
          onClick={() => {
            if (rightPaneCollapsed) setRightPaneCollapsed(false);
          }}
          role={rightPaneCollapsed ? "button" : undefined}
          aria-label={rightPaneCollapsed ? "Expand preview pane" : undefined}
        >
          <div className={`flex items-center gap-2 ${rightPaneCollapsed ? "justify-center" : "justify-between"}`}>
            {!rightPaneCollapsed ? (
              <p className="text-xs font-semibold text-slate-600">
                PDF Preview
                {synctexNotice ? (
                  <span className="ml-2 text-[10px] font-normal text-amber-600">
                    Ctrl+click for sync · {synctexNotice}
                  </span>
                ) : null}
              </p>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setRightPaneCollapsed((current) => !current);
              }}
              className="group relative rounded-md border border-slate-300 bg-white p-1 text-slate-700"
              aria-label={rightPaneCollapsed ? "Expand preview pane" : "Collapse preview pane"}
            >
              <svg
                viewBox="0 0 20 20"
                className={`h-4 w-4 transition-transform duration-200 ${rightPaneCollapsed ? "rotate-180" : "rotate-0"}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                {rightPaneCollapsed ? (
                  <path d="M13 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
              <span className="pointer-events-none absolute right-0 top-7 z-20 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white group-hover:block">
                {rightPaneCollapsed ? "Expand preview" : "Collapse preview"}
              </span>
            </button>
          </div>

          {!rightPaneCollapsed ? (
            <div className="mt-2 h-[68vh] rounded-xl border border-slate-200 bg-slate-50 p-1.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {compileBusy ? "Compiling project..." : compileNotice}
              </p>

              {compileMainLog ? (
                <details className="mb-1.5 rounded-md border border-slate-300 bg-white p-1.5">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                    View {compileMainLogFileName}
                  </summary>
                  <div className="mt-1.5 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        downloadBlob(
                          new Blob([compileMainLog], { type: "text/plain;charset=utf-8" }),
                          compileMainLogFileName
                        )
                      }
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700"
                    >
                      Download log
                    </button>
                  </div>
                  <pre className="mt-1.5 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-1.5 text-[11px] leading-5 text-slate-700">
                    {compileMainLog}
                  </pre>
                </details>
              ) : null}

              {compileMainLog ? (
                <div className="mb-1.5 rounded-md border border-slate-300 bg-white p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                      AI Compile Fix Suggestions
                    </p>
                    <button
                      type="button"
                      onClick={() => void fetchAiFixSuggestions()}
                      disabled={aiFixBusy}
                      className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-60"
                    >
                      {aiFixBusy ? "Analyzing..." : "Get suggestions"}
                    </button>
                  </div>

                  {aiFixSummary ? <p className="mt-1.5 text-[11px] text-slate-700">{aiFixSummary}</p> : null}
                  {aiFixError ? <p className="mt-1.5 text-[11px] text-rose-700">{aiFixError}</p> : null}

                  {aiFixSuggestions.length ? (
                    <ul className="mt-1.5 max-h-52 space-y-1.5 overflow-auto">
                      {aiFixSuggestions.map((suggestion, index) => (
                        <li key={`${suggestion.title}-${index}`} className="rounded border border-slate-200 bg-slate-50 p-1.5">
                          <p className="text-[11px] font-semibold text-slate-900">{suggestion.title}</p>
                          <p className="mt-1 text-[11px] text-slate-700">{suggestion.why}</p>

                          {suggestion.files?.length ? (
                            <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                              Files: {suggestion.files.join(", ")}
                            </p>
                          ) : null}

                          {suggestion.steps?.length ? (
                            <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px] text-slate-700">
                              {suggestion.steps.map((step, stepIndex) => (
                                <li key={`${index}-step-${stepIndex}`}>{step}</li>
                              ))}
                            </ol>
                          ) : null}

                          {suggestion.patch ? (
                            <>
                              <div className="mt-1.5 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => applyAiPatchToActiveFile(suggestion.patch || "")}
                                  disabled={!isValidAiPatchSnippet(suggestion.patch || "") || !activeEntry}
                                  className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-60"
                                >
                                  Apply to active file
                                </button>
                              </div>
                              <pre className="mt-1.5 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-1.5 text-[11px] leading-5 text-slate-700">
                                {suggestion.patch}
                              </pre>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {previewErrorLogs.length ? (
                <div className="mb-1.5 rounded-md border border-rose-200 bg-rose-50 p-1.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-800">Error log</p>
                    <button
                      type="button"
                      onClick={() => setPreviewErrorLogs([])}
                      className="rounded border border-rose-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                    >
                      Clear
                    </button>
                  </div>
                  <ul className="space-y-1 text-[11px] text-rose-700">
                    {previewErrorLogs.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {compiledPdfUrl ? (
                <div className="flex h-full flex-col gap-1.5">
                  <div className="flex justify-end">
                    <a
                      href={compiledPdfUrl}
                      download={compiledPdfFileName}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                      aria-label="Download compiled PDF"
                      title="Download compiled PDF"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </a>
                  </div>
                  <iframe
                    src={compiledPdfUrl}
                    title="Compiled LaTeX PDF preview"
                    className="h-full w-full rounded-md border border-slate-200 bg-white"
                    onClick={(event) => {
                      if (!event.ctrlKey && !event.metaKey) return;
                      if (!synctexRecords.length) {
                        setSynctexNotice("No SyncTeX data available. Recompile with synctex enabled.");
                        return;
                      }
                      // Approximate page detection from click position
                      const iframe = event.currentTarget;
                      const rect = iframe.getBoundingClientRect();
                      const relY = event.clientY - rect.top;
                      const approxPage = Math.floor(relY / (rect.height / Math.max(1, synctexRecords.reduce((max, r) => Math.max(max, r.page), 0)))) + 1;
                      const match = synctexRecords.find((r) => r.page === approxPage);
                      if (match) {
                        const targetFile = match.file.replace(/^\.\//, "");
                        const fileEntry = projectEntries.find(
                          (e) => e.kind === "file" &&
                            (e.path === targetFile || e.path.endsWith("/" + targetFile.split("/").pop() || ""))
                        );
                        if (fileEntry) {
                          setSelectedPath(fileEntry.path);
                          setSynctexNotice(`Navigated to ${targetFile} line ${match.line}`);
                          window.requestAnimationFrame(() => {
                            const textarea = editorRef.current;
                            if (!textarea) return;
                            textarea.focus();
                            const lines = activeSource.split("\n");
                            let targetLinePos = 0;
                            for (let i = 0; i < Math.min(match.line - 1, lines.length); i++) {
                              targetLinePos += lines[i].length + 1;
                            }
                            textarea.setSelectionRange(targetLinePos, targetLinePos);
                          });
                        } else {
                          setSynctexNotice(`File ${targetFile} not found in project.`);
                        }
                      } else {
                        setSynctexNotice(`No source mapping for page ${approxPage}.`);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white">
                  <button
                    type="button"
                    onClick={() => void compileProject()}
                    className="inline-flex items-center gap-2 rounded-md border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-900 transition hover:bg-cyan-100"
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M7 6l7 4-7 4V6z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Compile to preview PDF
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </aside>
      </section>

      {treeContextMenu ? (
        <div
          ref={treeContextMenuRef}
          className="fixed z-40 w-48 rounded-lg border border-slate-300 bg-white p-1 shadow-xl"
          style={{ left: `${treeContextMenu.x}px`, top: `${treeContextMenu.y}px` }}
          role="menu"
          tabIndex={0}
          aria-label="Tree node actions"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onTreeContextMenuKeyDown}
        >
          {treeContextItems.map((item, index) => {
            const active = index === boundedTreeContextActiveIndex;
            const danger = item.tone === "danger";
            return (
              <button
                key={`${item.action}-${index}`}
                type="button"
                role="menuitem"
                onMouseEnter={() => setTreeContextActiveIndex(index)}
                onClick={() => void runTreeContextAction(item.action)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition ${
                  danger
                    ? active
                      ? "bg-rose-100 text-rose-800"
                      : "text-rose-700 hover:bg-rose-50"
                    : active
                      ? "bg-slate-100 text-slate-800"
                      : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center">{renderTreeContextIcon(item.action)}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
