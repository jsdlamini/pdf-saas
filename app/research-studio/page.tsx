"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import JSZip from "jszip";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  type?: EditorMode;
};

type SavedProjectData = {
  id: string;
  name: string;
  entries: ProjectEntry[];
  selectedPath: string;
  lastCompileAt: string;
  updatedAt: string;
  editorMode?: EditorMode;
};

type EditorMode = "latex" | "python" | "cpp";

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

function getTodayString(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function createFreshProjectEntries(projectName: string, type: EditorMode = "latex"): ProjectEntry[] {
  if (type === "python") {
    const pyTemplate = getTemplateBySlug("python-script");
    const pyContent = (pyTemplate?.entries.find((e) => e.path === "main.py")?.content || "")
      .replace("{today}", getTodayString());
    return [
      { path: "main.py", kind: "file" as const, content: pyContent },
      { path: "data/", kind: "folder" as const, content: "" },
      { path: "output/", kind: "folder" as const, content: "" },
    ];
  }
  if (type === "cpp") {
    const cppTemplate = getTemplateBySlug("cpp-program");
    const cppContent = (cppTemplate?.entries.find((e) => e.path === "main.cpp")?.content || "")
      .replace("{today}", getTodayString());
    return [
      { path: "main.cpp", kind: "file" as const, content: cppContent },
      { path: "data/", kind: "folder" as const, content: "" },
      { path: "output/", kind: "folder" as const, content: "" },
    ];
  }
  return [
    {
      path: "main.tex",
      kind: "file" as const,
      content: String.raw`\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\title{${projectName || "Untitled Document"}}
\\author{Author}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Start writing your document here.

\\end{document}
`,
    },
    { path: "sections/", kind: "folder" as const, content: "" },
    { path: "figures/", kind: "folder" as const, content: "" },
    { path: "refs.bib", kind: "file" as const, content: "" },
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

function nextTemplateFor(path: string, mode?: EditorMode) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tex")) {
    return "\\section{New Section}\nWrite your content here.\n";
  }
  if (lower.endsWith(".bib")) {
    return "@article{newref,\n  title={Title},\n  author={Author},\n  year={2026}\n}\n";
  }
  if (lower.endsWith(".py")) {
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `#!/usr/bin/env python3
"""
New Module

Author: Your Name
Date: ${today}
"""


def main():
    print("Hello, World!")


if __name__ == "__main__":
    main()
`;
  }
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) {
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `#include <iostream>
#include <string>
#include <vector>

/**
 * New Program
 *
 * Author: Your Name
 * Date: ${today}
 */

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`;
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
    position: "top",
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
    position: "top",
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
  before?: string;
  after?: string;
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
    .replace(/(%[^\n]*)/g, '<span class="studio-hl-cmt">$1</span>')
    .replace(/(\\(?:begin|end|section|subsection|subsubsection|paragraph|textbf|textit|underline|footnote|cite|ref|label|includegraphics|caption|author|title|date|maketitle|input|bibliography|bibliographystyle|documentclass|usepackage|item|frac|sqrt|alpha|beta|gamma|today|[a-zA-Z@]+))/g, '<span class="studio-hl-cmd">$1</span>')
    .replace(/(\$\$[^$\n]*\$\$|\$[^$\n]*\$)/g, '<span class="studio-hl-mth">$1</span>')
    .replace(/([{}])/g, '<span class="studio-hl-brc">$1</span>')
    .replace(/(\[[^\]\n]*\])/g, '<span class="studio-hl-opt">$1</span>');
}

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
  "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

const BUILTIN_PYTHON_FUNCTIONS = new Set([
  "print", "len", "range", "int", "float", "str", "list", "dict", "set", "tuple",
  "bool", "enumerate", "zip", "map", "filter", "sorted", "reversed", "abs", "sum",
  "min", "max", "round", "type", "isinstance", "hasattr", "getattr", "setattr",
  "open", "input", "super", "any", "all", "next", "iter", "chr", "ord", "hex",
  "bin", "oct", "id", "dir", "vars", "help", "format", "repr",
]);

function highlightPythonSource(source: string) {
  const escaped = escapeHtml(source);
  const regions: { start: number; end: number; cls: string }[] = [];

  function collect(pattern: RegExp, cls: string, groupIdx = 0) {
    for (const m of escaped.matchAll(pattern)) {
      const start = (m.index ?? 0) + m[0].indexOf(m[groupIdx]);
      const text = m[groupIdx];
      regions.push({ start: start, end: start + text.length, cls });
    }
  }

  function collectReplacer(pattern: RegExp, cls: string, getMatch: (m: RegExpMatchArray) => { start: number; text: string }) {
    for (const m of escaped.matchAll(pattern)) {
      const { start, text } = getMatch(m);
      regions.push({ start, end: start + text.length, cls });
    }
  }

  // Triple-quoted strings
  collect(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, "studio-hl-str");

  // Line comments: capture the # and rest, return the exact match info
  for (const m of escaped.matchAll(/(^|\n)(\s*)(#[^\n]*)/g)) {
    const comment = m[3]; // the # part
    const start = m.index! + m[1].length + m[2].length;
    regions.push({ start, end: start + comment.length, cls: "studio-hl-cmt" });
  }

  // Regular strings
  collect(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, "studio-hl-str");

  // @decorators
  collect(/(@[a-zA-Z_]\w*)/g, "studio-hl-dec");

  // Keywords
  for (const kw of PYTHON_KEYWORDS) {
    const escapedKw = escapeHtml(kw);
    collect(new RegExp(`\\b(${escapedKw})\\b`, "g"), "studio-hl-kw");
  }

  // Built-in functions
  for (const fn of BUILTIN_PYTHON_FUNCTIONS) {
    const escapedFn = escapeHtml(fn);
    collect(new RegExp(`\\b(${escapedFn})\\b`, "g"), "studio-hl-fn");
  }

  // Function definitions
  for (const m of escaped.matchAll(/\b(def)\s+(\w+)/g)) {
    regions.push({ start: m.index!, end: m.index! + m[1].length, cls: "studio-hl-kw" });
    regions.push({ start: m.index! + m[0].indexOf(m[2]), end: m.index! + m[0].length, cls: "studio-hl-fn" });
  }

  // Numbers
  collect(/\b(\d+\.?\d*|0[xb][\da-fA-F]+)\b/g, "studio-hl-num");

  // Sort by start position. For overlapping regions, keep the one applied first (earlier in regions array = wider patterns applied first).
  regions.sort((a, b) => a.start - b.start);

  // Remove completely nested regions (keep outer)
  const filtered: typeof regions = [];
  for (const r of regions) {
    const last = filtered[filtered.length - 1];
    if (last && r.start >= last.start && r.end <= last.end) continue; // nested inside previous
    if (last && r.start < last.end && r.end > last.end) continue; // partial overlap, skip
    filtered.push(r);
  }

  // Build final HTML
  let result = "";
  let pos = 0;
  for (const r of filtered) {
    if (r.start < pos) continue; // skip if already covered
    result += escaped.slice(pos, r.start);
    result += `<span class="${r.cls}">${escaped.slice(r.start, r.end)}</span>`;
    pos = r.end;
  }
  result += escaped.slice(pos);
  return result;
}

const CPP_KEYWORDS = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor",
  "bool", "break", "case", "catch", "char", "char8_t", "char16_t", "char32_t",
  "class", "compl", "concept", "const", "consteval", "constexpr", "constinit",
  "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype",
  "default", "delete", "do", "double", "dynamic_cast", "else", "enum", "explicit",
  "export", "extern", "false", "float", "for", "friend", "goto", "if", "inline",
  "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
  "nullptr", "operator", "or", "or_eq", "private", "protected", "public",
  "register", "reinterpret_cast", "requires", "return", "short", "signed",
  "sizeof", "static", "static_assert", "static_cast", "struct", "switch",
  "template", "this", "thread_local", "throw", "true", "try", "typedef",
  "typeid", "typename", "union", "unsigned", "using", "virtual", "void",
  "volatile", "wchar_t", "while", "xor", "xor_eq",
]);

const CPP_TYPES = new Set([
  "std", "string", "vector", "map", "set", "queue", "stack", "deque",
  "list", "array", "pair", "tuple", "optional", "variant", "function",
  "shared_ptr", "unique_ptr", "weak_ptr", "size_t", "ptrdiff_t",
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t",
  "uint32_t", "uint64_t", "istream", "ostream", "iostream", "fstream",
  "stringstream", "ifstream", "ofstream", "cin", "cout", "cerr", "endl",
  "algorithm", "cmath", "numeric", "iterator", "ios",
]);

function highlightCppSource(source: string) {
  const escaped = escapeHtml(source);
  const regions: { start: number; end: number; cls: string }[] = [];

  function collect(pattern: RegExp, cls: string, groupIdx = 0) {
    for (const m of escaped.matchAll(pattern)) {
      const text = m[groupIdx];
      if (!text) continue;
      const start = m.index! + m[0].indexOf(text);
      regions.push({ start, end: start + text.length, cls });
    }
  }

  // Multi-line comments first (widest patterns get priority via array order)
  collect(/(\/\*[\s\S]*?\*\/)/g, "studio-hl-cmt");

  // Preprocessor directives
  collect(/^(#\s*\w+.*)$/gm, "studio-hl-pp");

  // String literals
  collect(/(R?"(?:[^"\\]|\\.)*")/g, "studio-hl-str");
  collect(/('(?:[^'\\]|\\.)*')/g, "studio-hl-str");

  // Single-line comments
  collect(/(\/\/[^\n]*)/g, "studio-hl-cmt");

  // Keywords
  for (const kw of CPP_KEYWORDS) {
    const escapedKw = escapeHtml(kw);
    collect(new RegExp(`\\b(${escapedKw})\\b`, "g"), "studio-hl-kw");
  }

  // Types / STL
  for (const t of CPP_TYPES) {
    const escapedT = escapeHtml(t);
    collect(new RegExp(`\\b(${escapedT})\\b`, "g"), "studio-hl-fn");
  }

  // Numbers
  collect(/\b(\d+\.?\d*[fFLlUu]*|0[xb][\da-fA-F]+[UuLl]*)\b/g, "studio-hl-num");

  // Function calls (name before paren, not a keyword)
  for (const m of escaped.matchAll(/\b([a-zA-Z_]\w*)\s*(?=\()/g)) {
    const name = m[1];
    if (CPP_KEYWORDS.has(name)) continue;
    regions.push({ start: m.index!, end: m.index! + name.length, cls: "studio-hl-fn" });
  }

  // Sort; for overlaps keep wider (earlier in array = wider pattern)
  regions.sort((a, b) => a.start - b.start);
  const filtered: typeof regions = [];
  for (const r of regions) {
    const last = filtered[filtered.length - 1];
    if (last && r.start >= last.start && r.end <= last.end) continue;
    if (last && r.start < last.end && r.end > last.end) continue;
    filtered.push(r);
  }

  let result = "";
  let pos = 0;
  for (const r of filtered) {
    if (r.start < pos) continue;
    result += escaped.slice(pos, r.start);
    result += `<span class="${r.cls}">${escaped.slice(r.start, r.end)}</span>`;
    pos = r.end;
  }
  result += escaped.slice(pos);
  return result;
}

function highlightCodeSource(source: string, mode: EditorMode): string {
  if (mode === "python") return highlightPythonSource(source);
  if (mode === "cpp") return highlightCppSource(source);
  return highlightLatexSource(source);
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
  // Start with no projects — users create their own
  return {
    savedProjects: [],
    activeProjectId: "",
    projectName: "",
    projectEntries: [],
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

  // Restore workspace state from localStorage on mount
  const [workspaceScreen, setWorkspaceScreen] = useState<"projects" | "editor">(() => {
    if (typeof window === "undefined") return initialState.workspaceScreen;
    try {
      const saved = localStorage.getItem("wiserfiles-workspace");
      return saved ? (JSON.parse(saved) as "projects" | "editor") : initialState.workspaceScreen;
    } catch { return initialState.workspaceScreen; }
  });
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>(() => {
    if (typeof window === "undefined") return initialState.savedProjects;
    try {
      const raw = localStorage.getItem("wiserfiles-guest-projects");
      if (!raw) return initialState.savedProjects;
      const data = JSON.parse(raw) as SavedProjectData[];
      return data
        .filter((p) => p.id && p.name.trim() && p.entries.length)
        .slice(0, GUEST_PROJECT_LIMIT)
        .map((p) => ({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          type: p.editorMode || (p.entries.some((e) => e.path.endsWith(".py")) ? "python" : p.entries.some((e) => e.path.endsWith(".cpp")) ? "cpp" : "latex"),
        }));
    } catch { return initialState.savedProjects; }
  });
  const [savedProjectSnapshots, setSavedProjectSnapshots] = useState<SavedProjectData[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("wiserfiles-guest-projects");
      if (!raw) return [];
      const data = JSON.parse(raw) as SavedProjectData[];
      return data.filter((p) => p.id && p.name.trim() && p.entries.length).slice(0, GUEST_PROJECT_LIMIT);
    } catch { return []; }
  });
  const [activeProjectId, setActiveProjectId] = useState(() => {
    if (typeof window === "undefined") return initialState.activeProjectId;
    try {
      return localStorage.getItem("wiserfiles-active-project") || initialState.activeProjectId;
    } catch { return initialState.activeProjectId; }
  });
  const [projectName, setProjectName] = useState(initialState.projectName);
  const [projectEntries, setProjectEntries] = useState<ProjectEntry[]>(initialState.projectEntries);
  const searchParams = useSearchParams();
  const shareId = searchParams.get("share");
  const [sharedProject, setSharedProject] = useState<any>(null);
  const [shareLoading, setShareLoading] = useState(!!shareId);

  // Load shared project on mount
  useEffect(() => {
    if (!shareId) { setShareLoading(false); return; }
    fetch(`/api/share-project?id=${shareId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.project) setSharedProject(d.project);
        setShareLoading(false);
      })
      .catch(() => setShareLoading(false));
  }, [shareId]);

  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    if (typeof window === "undefined") return "latex";
    try {
      return (localStorage.getItem("wiserfiles-editor-mode") as EditorMode) || "latex";
    } catch { return "latex"; }
  });

  const [codeOutput, setCodeOutput] = useState<{ stdout: string; stderr: string; exitCode: number } | null>(null);
  // Persist workspace + active project to localStorage
  useEffect(() => {
    try { localStorage.setItem("wiserfiles-workspace", JSON.stringify(workspaceScreen)); } catch {}
  }, [workspaceScreen]);

  useEffect(() => {
    try { localStorage.setItem("wiserfiles-active-project", activeProjectId); } catch {}
  }, [activeProjectId]);

  useEffect(() => {
    try { localStorage.setItem("wiserfiles-editor-mode", editorMode); } catch {}
  }, [editorMode]);

  // Restore project data when returning to editor on refresh
  useEffect(() => {
    if (workspaceScreen === "editor" && activeProjectId && !projectName) {
      const snapshot = savedProjectSnapshots.find((p) => p.id === activeProjectId);
      if (snapshot) {
        setProjectName(snapshot.name);
        setProjectEntries(snapshot.entries);
        setSelectedPath(snapshot.selectedPath || "main.tex");
        setLastCompileAt(snapshot.lastCompileAt || "Not compiled yet");
        setEditorMode(snapshot.editorMode || (
          snapshot.entries?.some((e) => e.path.endsWith(".py")) ? "python"
          : snapshot.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
          : "latex"
        ));
      }
    }
  }, [workspaceScreen, activeProjectId, projectName, savedProjectSnapshots]);
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
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);

  // Auto-collapse file tree on mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setLeftPaneCollapsed(true);
      setRightPaneCollapsed(true);
    }
  }, [isMobile]);
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
  const [codeRunBusy, setCodeRunBusy] = useState(false);
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<string | null>(null);

  // ── Terminal state ─────
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<string[]>([]);
  const [terminalHistoryIdx, setTerminalHistoryIdx] = useState(-1);
  const [terminalOutput, setTerminalOutput] = useState<
    { type: "command" | "stdout" | "stderr" | "error"; text: string }[]
  >([]);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalCwd, setTerminalCwd] = useState("");
  const [terminalHeight, setTerminalHeight] = useState(180);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);

  // Undo/redo stacks
  const undoStackRef = useRef<{ source: string; cursorPos: number }[]>([]);
  const redoStackRef = useRef<{ source: string; cursorPos: number }[]>([]);
  const isUndoRedoRef = useRef(false);
  const menuHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [equationTooltip, setEquationTooltip] = useState<{ top: number; left: number; latex: string } | null>(null);
  const [wordCount, setWordCount] = useState<{ words: number; chars: number; abstractWords: number }>({ words: 0, chars: 0, abstractWords: 0 });
  const [loadingProject, setLoadingProject] = useState(false);
  const [synctexRecords, setSynctexRecords] = useState<SynctexRecord[]>([]);
  const [synctexNotice, setSynctexNotice] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [openMenu, setOpenMenu] = useState("");

  // Close menu dropdown on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".studio-menu-group")) setOpenMenu("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equationHoverRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zipImportRef = useRef<HTMLInputElement | null>(null);
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

  const isCodeMode = editorMode === "python" || editorMode === "cpp";
  const activeSource = activeEntry?.content ?? "";

  const preview = useMemo(() => buildPreview(activeSource), [activeSource]);
  const projectTree = useMemo(() => buildProjectTree(projectEntries), [projectEntries]);
  const highlightedSource = useMemo(() => {
    // Detect from file extension (belt-and-suspenders — avoids stale editorMode)
    const detectedMode = selectedPath.endsWith(".py") ? "python"
      : selectedPath.endsWith(".cpp") || selectedPath.endsWith(".h") ? "cpp"
      : editorMode;
    return highlightCodeSource(activeSource, detectedMode);
  }, [activeSource, editorMode, selectedPath]);
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
    // Never auto-save when there is no active project yet
    if (!activeProjectId || !projectName.trim()) return;
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

  // Global Ctrl+` to toggle terminal
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

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
      content: kind === "file" ? nextTemplateFor(normalized, editorMode) : "",
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
    if (!snapshot.id || !snapshot.name.trim() || !snapshot.entries.length) return;
    setSavedProjectSnapshots((current) => {
      const next = [snapshot, ...current.filter((item) => item.id !== snapshot.id)].slice(0, 20);
      // Guests persist projects locally in the browser (up to the guest limit)
      if (!userId) {
        try {
          localStorage.setItem("wiserfiles-guest-projects", JSON.stringify(next.slice(0, GUEST_PROJECT_LIMIT)));
        } catch {}
      }
      return next;
    });
    setSavedProjects((current) => {
      const meta: SavedProjectMeta = {
        id: snapshot.id,
        name: snapshot.name,
        updatedAt: snapshot.updatedAt,
        type: snapshot.editorMode || (
          snapshot.entries?.some((e) => e.path.endsWith(".py")) ? "python"
          : snapshot.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
          : "latex"
        ),
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
        setCompileNotice("Account storage unavailable on this deployment.");
        return;
      }
      appendPreviewError(`Account sync failed: ${message}`);
      setCompileNotice("Save failed — could not reach account storage.");
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
      projects.map((project) => ({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        type: project.editorMode || (
          project.entries?.some((e) => e.path.endsWith(".py")) ? "python"
          : project.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
          : "latex"
        ),
      })).slice(0, 20)
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
    setEditorMode(nextActive.editorMode || (
      nextActive.entries?.some((e: ProjectEntry) => e.path.endsWith(".py")) ? "python"
      : nextActive.entries?.some((e: ProjectEntry) => e.path.endsWith(".cpp")) ? "cpp"
      : "latex"
    ));
    setCodeOutput(null);
    setCodeRunBusy(false);
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
          setCompileNotice("Account storage unavailable on this deployment.");
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
      editorMode: overrides?.editorMode ?? editorMode,
    };
  }

  function saveCurrentProject() {
    try {
      const snapshot = buildCurrentProjectSnapshot();
      persistProjectSnapshot(snapshot);
      queueServerProjectSync(snapshot);

      setCompileNotice(
        usesAccountStorage
          ? "Project saved to your account."
          : "Save queued — retrying against account storage."
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
    setEditorMode(saved.editorMode || (
      saved.entries?.some((e) => e.path.endsWith(".py")) ? "python"
      : saved.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
      : "latex"
    ));
    setCodeOutput(null);
    setCodeRunBusy(false);
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
    if (!userId) {
      try {
        localStorage.setItem("wiserfiles-guest-projects", JSON.stringify(nextSnapshots.slice(0, GUEST_PROJECT_LIMIT)));
      } catch {}
    }

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
          setEditorMode(fallback.editorMode || (
            fallback.entries?.some((e) => e.path.endsWith(".py")) ? "python"
            : fallback.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
            : "latex"
          ));
        } else {
          setActiveProjectId("");
          setProjectName("");
          setProjectEntries([]);
          setSelectedPath("main.tex");
          setLastCompileAt("Not compiled yet");
          setWorkspaceScreen("projects");
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

    // Push previous state onto undo stack (unless we're undoing/redoing)
    if (!isUndoRedoRef.current) {
      const prevContent = activeEntry.content;
      if (prevContent !== nextContent) {
        // Estimate the old cursor position before the edit
        const newCursor = editorRef.current?.selectionStart ?? 0;
        const lengthDiff = nextContent.length - prevContent.length;
        const oldCursor = Math.max(0, Math.min(newCursor - lengthDiff, prevContent.length));
        undoStackRef.current.push({ source: prevContent, cursorPos: oldCursor });
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        // Clear redo stack on new edit
        redoStackRef.current = [];
      }
    }

    setProjectEntries((current) =>
      current.map((entry) =>
        entry.path === activeEntry.path && entry.kind === "file"
          ? { ...entry, content: nextContent }
          : entry
      )
    );
    setAutoSaveStatus("unsaved");
  }

  function undo() {
    if (!undoStackRef.current.length || !activeEntry) return;
    isUndoRedoRef.current = true;

    // Push current state to redo stack
    const currentSource = activeEntry.content;
    const currentCursor = editorRef.current?.selectionStart ?? 0;
    redoStackRef.current.push({ source: currentSource, cursorPos: currentCursor });

    // Restore previous state from undo stack
    const prev = undoStackRef.current.pop()!;
    updateActiveFile(prev.source);
    window.requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(prev.cursorPos, prev.cursorPos);
      }
      isUndoRedoRef.current = false;
    });
  }

  function redo() {
    if (!redoStackRef.current.length || !activeEntry) return;
    isUndoRedoRef.current = true;

    // Push current state to undo stack
    const currentSource = activeEntry.content;
    const currentCursor = editorRef.current?.selectionStart ?? 0;
    undoStackRef.current.push({ source: currentSource, cursorPos: currentCursor });

    // Restore next state from redo stack
    const next = redoStackRef.current.pop()!;
    updateActiveFile(next.source);
    window.requestAnimationFrame(() => {
      const textarea = editorRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(next.cursorPos, next.cursorPos);
      }
      isUndoRedoRef.current = false;
    });
  }

  function createProjectFromTemplate(template: ResearchTemplate) {
    if (!userId && savedProjects.length >= GUEST_PROJECT_LIMIT) {
      setCompileNotice("Guest limit reached: sign in to create more than 5 projects.");
      return;
    }
    const nextProjectId = makeProjectId();
    const name = template.name;
    const createdAt = new Date().toISOString();
    const defaultPath = template.entries.find((e) => e.kind === "file")?.path || "main.tex";
    const detectedMode: EditorMode = template.slug.startsWith("python-") ? "python" : template.slug.startsWith("cpp-") ? "cpp" : "latex";
    const snapshot: SavedProjectData = {
      id: nextProjectId,
      name,
      entries: template.entries.map((e) =>
        e.kind === "file" ? { ...e, content: e.content.replace(/\{today\}/g, getTodayString()) } : e
      ),
      selectedPath: defaultPath,
      lastCompileAt: "Not compiled yet",
      updatedAt: createdAt,
      editorMode: detectedMode,
    };
    persistProjectSnapshot(snapshot);
    queueServerProjectSync(snapshot);
    setSavedProjects((current) => [
      { id: nextProjectId, name, updatedAt: createdAt, type: detectedMode },
      ...current.filter((item) => item.id !== nextProjectId),
    ]);
    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);
    closeIntellisense();
    setActiveProjectId(nextProjectId);
    setProjectName(name);
    setProjectEntries(snapshot.entries);
    setSelectedPath(defaultPath);
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
    setEditorMode(detectedMode);
    setCodeOutput(null);
    setCodeRunBusy(false);
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
      content: isFolder ? "" : nextTemplateFor(normalized, editorMode),
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

    // Build template options for each type
    const latexTemplates = RESEARCH_TEMPLATES.filter((t) => !t.slug.startsWith("python-") && !t.slug.startsWith("cpp-"));
    const pythonTemplates = RESEARCH_TEMPLATES.filter((t) => t.slug.startsWith("python-"));
    const cppTemplates = RESEARCH_TEMPLATES.filter((t) => t.slug.startsWith("cpp-"));
    const opts = (list: ResearchTemplate[]) =>
      list.map((t) => `<option value="${t.slug}">${t.name}</option>`).join("");

    // Show dialog with name + type + template selector
    const result = await Swal.fire({
      title: "New Project",
      html: `
        <div style="text-align:left;display:flex;flex-direction:column;gap:12px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#e2e8f0;display:block;margin-bottom:4px">Project Name</label>
            <input id="swal-project-name" class="swal2-input" placeholder="My Research Project" style="background:#0f172a;color:#e2e8f0;border-color:#334155;width:calc(100% - 24px);max-width:100%;min-width:0;box-sizing:border-box;margin-left:0;margin-right:24px;text-align:left">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#e2e8f0;display:block;margin-bottom:4px">Project Type</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label style="flex:1;padding:8px 4px;border:1px solid #818cf8;border-radius:6px;text-align:center;cursor:pointer;color:#e2e8f0;font-size:12px">
                <input type="radio" name="project-type" value="latex" checked style="margin-right:4px" onchange="this.ownerDocument.getElementById('swal-tpl-latex').style.display='';this.ownerDocument.getElementById('swal-tpl-python').style.display='none';this.ownerDocument.getElementById('swal-tpl-cpp').style.display='none'"> LaTeX
              </label>
              <label style="flex:1;padding:8px 4px;border:1px solid #4ade80;border-radius:6px;text-align:center;cursor:pointer;color:#e2e8f0;font-size:12px">
                <input type="radio" name="project-type" value="python" style="margin-right:4px" onchange="this.ownerDocument.getElementById('swal-tpl-latex').style.display='none';this.ownerDocument.getElementById('swal-tpl-python').style.display='';this.ownerDocument.getElementById('swal-tpl-cpp').style.display='none'"> Python
              </label>
              <label style="flex:1;padding:8px 4px;border:1px solid #f97316;border-radius:6px;text-align:center;cursor:pointer;color:#e2e8f0;font-size:12px">
                <input type="radio" name="project-type" value="cpp" style="margin-right:4px" onchange="this.ownerDocument.getElementById('swal-tpl-latex').style.display='none';this.ownerDocument.getElementById('swal-tpl-python').style.display='none';this.ownerDocument.getElementById('swal-tpl-cpp').style.display=''"> C++
              </label>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label style="font-size:13px;font-weight:600;color:#e2e8f0;display:block">Start from a template</label>
            <select id="swal-tpl-latex" class="swal2-input" style="background:#0f172a;color:#e2e8f0;border-color:#334155;width:calc(100% - 24px);margin-left:0;margin-right:24px;text-align:left">
              <option value="">Blank project (no template)</option>
              ${opts(latexTemplates)}
            </select>
            <select id="swal-tpl-python" class="swal2-input" style="display:none;background:#0f172a;color:#e2e8f0;border-color:#334155;width:calc(100% - 24px);margin-left:0;margin-right:24px;text-align:left">
              <option value="">Blank project (no template)</option>
              ${opts(pythonTemplates)}
            </select>
            <select id="swal-tpl-cpp" class="swal2-input" style="display:none;background:#0f172a;color:#e2e8f0;border-color:#334155;width:calc(100% - 24px);margin-left:0;margin-right:24px;text-align:left">
              <option value="">Blank project (no template)</option>
              ${opts(cppTemplates)}
            </select>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Create",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#0f766e",
      cancelButtonColor: "#334155",
      background: "#1a1d2b",
      color: "#e2e8f0",
      customClass: {
        popup: "swal-draggable",
        title: "swal-drag-handle",
      },
      position: "top",
      didOpen: () => {
        const popup = document.querySelector(".swal-draggable") as HTMLElement | null;
        const titleEl = document.querySelector(".swal-drag-handle") as HTMLElement | null;
        if (!popup || !titleEl) return;
        let offsetX = 0, offsetY = 0, dragging = false;
        titleEl.style.cursor = "grab";
        titleEl.addEventListener("mousedown", (e) => {
          dragging = true;
          offsetX = (e as MouseEvent).clientX - popup.getBoundingClientRect().left;
          offsetY = (e as MouseEvent).clientY - popup.getBoundingClientRect().top;
          titleEl.style.cursor = "grabbing";
        });
        document.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          popup.style.position = "fixed";
          popup.style.left = `${e.clientX - offsetX}px`;
          popup.style.top = `${e.clientY - offsetY}px`;
          popup.style.margin = "0";
        });
        document.addEventListener("mouseup", () => {
          dragging = false;
          titleEl.style.cursor = "grab";
        });
      },
      preConfirm: () => {
        const name = (document.getElementById("swal-project-name") as HTMLInputElement)?.value?.trim();
        if (!name) {
          Swal.showValidationMessage("Enter a project name");
          return false;
        }
        const typeEl = document.querySelector('input[name="project-type"]:checked') as HTMLInputElement | null;
        const type = (typeEl?.value || "latex") as EditorMode;
        const selectId = type === "python" ? "swal-tpl-python" : type === "cpp" ? "swal-tpl-cpp" : "swal-tpl-latex";
        const templateSlug = (document.getElementById(selectId) as HTMLSelectElement)?.value || "";
        return { name, type, templateSlug };
      },
    });

    if (!result.isConfirmed || !result.value) return;
    const { name, type, templateSlug } = result.value as { name: string; type: EditorMode; templateSlug: string };

    const nextProjectId = makeProjectId();
    const template = templateSlug ? getTemplateBySlug(templateSlug) : null;
    const freshEntries = template
      ? template.entries.map((e) => (e.kind === "file" ? { ...e, content: e.content.replace(/\{today\}/g, getTodayString()) } : e))
      : createFreshProjectEntries(name, type);
    const templateMainFile = template?.entries.find((e) => e.kind === "file")?.path;
    const defaultPath = templateMainFile
      || (type === "python" ? "main.py" : type === "cpp" ? "main.cpp" : "main.tex");
    const createdAt = new Date().toISOString();
    const snapshot: SavedProjectData = {
      id: nextProjectId,
      name,
      entries: freshEntries,
      selectedPath: defaultPath,
      lastCompileAt: "Not compiled yet",
      updatedAt: createdAt,
      editorMode: type,
    };

    persistProjectSnapshot(snapshot);
    queueServerProjectSync(snapshot);
    setSavedProjects((current) => [
      { id: nextProjectId, name, updatedAt: createdAt, type },
      ...current.filter((item) => item.id !== nextProjectId),
    ]);

    if (compiledPdfUrl) URL.revokeObjectURL(compiledPdfUrl);
    closeIntellisense();
    setActiveProjectId(nextProjectId);
    setProjectName(name);
    setProjectEntries(freshEntries);
    setSelectedPath(defaultPath);
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
    setEditorMode(type);
    setCodeOutput(null);
    setCodeRunBusy(false);
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

  async function runTerminalCommand(overrideCommand?: string) {
    const command = (overrideCommand ?? terminalInput).trim();
    if (!command) return;

    // Add to history
    setTerminalHistory((prev) => {
      const next = [...prev, command];
      if (next.length > 100) next.shift();
      return next;
    });
    setTerminalHistoryIdx(-1);

    setTerminalOutput((prev) => [...prev, { type: "command", text: command }]);
    setTerminalInput("");
    setTerminalBusy(true);

    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, cwd: terminalCwd || undefined }),
      });

      const result = (await response.json()) as {
        stdout?: string;
        stderr?: string;
        error?: string;
        exitCode?: number;
        cwd?: string;
      };

      setTerminalOutput((prev) => {
        const next = [...prev];
        if (result.stdout) next.push({ type: "stdout", text: result.stdout });
        if (result.stderr) next.push({ type: "stderr", text: result.stderr });
        if (result.error) next.push({ type: "error", text: result.error });
        return next;
      });

      if (result.cwd) setTerminalCwd(result.cwd);
    } catch (err) {
      setTerminalOutput((prev) => [
        ...prev,
        { type: "error", text: `Failed to execute command: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    } finally {
      setTerminalBusy(false);
    }
  }

  async function runCode() {
    if (!activeEntry) {
      setCompileNotice("No file selected to run.");
      return;
    }

    const code = activeEntry.content;
    if (!code.trim()) {
      setCompileNotice("Code file is empty.");
      return;
    }

    try {
      setCodeRunBusy(true);
      setCodeOutput(null);
      setCompileNotice(`Running ${editorMode} code on server...`);

      const response = await fetch("/api/run-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: editorMode }),
      });

      const result = (await response.json()) as { output?: string; error?: string; exitCode?: number; message?: string };

      if (!response.ok) {
        setCodeOutput({ stdout: "", stderr: result.error || result.message || `Server error: ${response.status}`, exitCode: result.exitCode ?? 1 });
        setCompileNotice("Code execution failed.");
        return;
      }

      setCodeOutput({
        stdout: result.output || "",
        stderr: result.error || "",
        exitCode: result.exitCode ?? 0,
      });
      setCompileNotice(`Code executed (exit code: ${result.exitCode ?? 0}).`);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Code execution failed.";
      setCodeOutput({ stdout: "", stderr: `Error: ${message}`, exitCode: 1 });
      setCompileNotice("Code execution failed.");
    } finally {
      setCodeRunBusy(false);
    }
  }

  async function compileProject() {
    // Detect code mode from file extension (belt-and-suspenders — works even if editorMode state hasn't updated)
    const activeMode = activeEntry?.path?.endsWith(".py") ? "python"
      : activeEntry?.path?.endsWith(".cpp") ? "cpp"
      : editorMode;
    if (activeMode === "python" || activeMode === "cpp") {
      await runCode();
      return;
    }
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
          type: snapshot.editorMode || (
            snapshot.entries?.some((e) => e.path.endsWith(".py")) ? "python"
            : snapshot.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
            : "latex"
          ),
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

  async function openCollaborateDialog() {
    const result = await Swal.fire({
      title: "⋮⋮ Collaborate",
      titleText: "⋮⋮ Collaborate",
      position: "top",
      customClass: {
        popup: "swal-draggable",
        title: "swal-drag-handle",
      },
      html: `
        <div style="text-align:left;display:flex;flex-direction:column;gap:12px">
          <div style="background:#1e293b;border-radius:8px;padding:12px">
            <p style="font-size:13px;font-weight:600;color:#e2e8f0;margin:0 0 4px">📋 Share Link</p>
            <p style="font-size:11px;color:#94a3b8;margin:0 0 8px">Anyone with the link can view and copy this project.</p>
            <button type="button" id="swal-share-btn" class="swal2-confirm swal2-styled" style="width:100%;background:#4ade80;font-size:12px;padding:8px">Copy Share Link</button>
          </div>
          <div style="background:#1e293b;border-radius:8px;padding:12px">
            <p style="font-size:13px;font-weight:600;color:#e2e8f0;margin:0 0 4px">✉ Invite by Email</p>
            <p style="font-size:11px;color:#94a3b8;margin:0 0 8px">Send an invitation with specific access permissions.</p>
            <input id="swal-invite-email" class="swal2-input" placeholder="colleague@university.edu" style="background:#0f172a;color:#e2e8f0;border-color:#334155;margin-bottom:8px">
            <select id="swal-invite-access" class="swal2-input" style="background:#0f172a;color:#e2e8f0;border-color:#334155;margin-bottom:8px">
              <option value="read">Read only — can view and compile</option>
              <option value="write">Write — can edit files</option>
              <option value="admin">Admin — full access</option>
            </select>
            <button type="button" id="swal-invite-btn" class="swal2-confirm swal2-styled" style="width:100%;background:#818cf8;font-size:12px;padding:8px">Send Invite</button>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: "Close",
      cancelButtonColor: "#475569",
      background: "#1a1d2b",
      color: "#e2e8f0",
      didOpen: () => {
        // Make dialog draggable
        const modal = Swal.getPopup();
        if (modal) {
          modal.style.position = "absolute";
          modal.style.top = "8%";
          modal.style.left = "50%";
          modal.style.transform = "translateX(-50%)";
          let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
          modal.addEventListener("mousedown", (e) => {
            if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT" || (e.target as HTMLElement).tagName === "BUTTON") return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = modal.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            modal.style.cursor = "grabbing";
          });
          window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            modal.style.left = `${startLeft + e.clientX - startX}px`;
            modal.style.top = `${startTop + e.clientY - startY}px`;
            modal.style.transform = "none";
          });
          window.addEventListener("mouseup", () => {
            isDragging = false;
            if (modal) modal.style.cursor = "";
          });
        }
        // Share + Invite buttons
        document.getElementById("swal-share-btn")?.addEventListener("click", async () => {
          try {
            const snapshot = buildCurrentProjectSnapshot();
            const res = await fetch("/api/share-project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectData: snapshot }) });
            const { shareId } = await res.json();
            await navigator.clipboard.writeText(`${window.location.origin}/research-studio?share=${shareId}`);
            setCompileNotice("Share link copied! Anyone with this link can view and copy your project.");
          } catch { setCompileNotice("Could not create share link."); }
          Swal.close();
        });
        document.getElementById("swal-invite-btn")?.addEventListener("click", async () => {
          const email = (document.getElementById("swal-invite-email") as HTMLInputElement)?.value?.trim();
          const access = (document.getElementById("swal-invite-access") as HTMLSelectElement)?.value;
          if (!email) { Swal.showValidationMessage("Enter an email address"); return; }
          try {
            await fetch("/api/project-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: activeProjectId, projectName, email, accessLevel: access }) });
            setCompileNotice(`Invitation sent to ${email} (${access} access).`);
          } catch { setCompileNotice("Could not send invitation."); }
          Swal.close();
        });
      },
    });
  }

  async function shareProject() {
    await openCollaborateDialog();
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

  async function importProjectFromZip(file: File) {
    try {
      const zip = await JSZip.loadAsync(file);
      const entries: ProjectEntry[] = [];
      const folderSet = new Set<string>();
      let mainTexPath = "main.tex";

      for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir || zipPath.startsWith("__MACOSX") || zipPath.startsWith(".")) continue;
        const name = zipPath.split("/").pop() || zipPath;
        if (name.startsWith(".")) continue;

        const content = await zipEntry.async("string");
        entries.push({ path: zipPath, kind: "file", content });

        // Add implicit parent folders
        const parts = zipPath.split("/");
        let cursor = "";
        for (let i = 0; i < parts.length - 1; i++) {
          cursor += parts[i] + "/";
          folderSet.add(cursor);
        }

        // Detect main .tex file
        if (content.includes("\\documentclass") && zipPath.toLowerCase().endsWith(".tex")) {
          mainTexPath = zipPath;
        }
      }

      for (const folder of folderSet) {
        if (!entries.some((e) => e.path === folder)) {
          entries.push({ path: folder, kind: "folder", content: "" });
        }
      }

      const projectName = file.name.replace(/\.zip$/i, "") || "Imported Project";
      const projectId = makeProjectId();
      const now = new Date().toISOString();
      const snapshot: SavedProjectData = {
        id: projectId,
        name: projectName,
        entries,
        selectedPath: mainTexPath,
        lastCompileAt: "Not compiled yet",
        updatedAt: now,
        editorMode: "latex",
      };

      persistProjectSnapshot(snapshot);
      queueServerProjectSync(snapshot);
      setActiveProjectId(projectId);
      setProjectName(projectName);
      setProjectEntries(entries);
      setSelectedPath(mainTexPath);
      setEditorMode("latex");
      setCompileNotice(`Imported ${entries.filter((e) => e.kind === "file").length} files from ${file.name}.`);
      setWorkspaceScreen("editor");
    } catch (e) {
      setCompileNotice("Import failed. Make sure the file is a valid .zip archive.");
    }
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
    const selectionStart = start + (snippet.cursorOffset ?? (snippet.before?.length || 0));
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

      // Ctrl+Z: undo
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z: redo
      if (key === "y" || (event.shiftKey && key === "z")) {
        event.preventDefault();
        redo();
        return;
      }

      const passThroughShortcuts = new Set([
        "a", // select all
        "c", // copy
        "v", // paste
        "x", // cut
      ]);

      if (passThroughShortcuts.has(key)) {
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

    if (isMod && event.key.toLowerCase() === "b") {
      if (isCodeMode) return;
      event.preventDefault();
      insertEditorSnippet({ before: "\\textbf{", after: "}", placeholder: "bold text" });
      return;
    }

    if (isMod && event.key.toLowerCase() === "i") {
      if (isCodeMode) return;
      event.preventDefault();
      insertEditorSnippet({ before: "\\textit{", after: "}", placeholder: "italic text" });
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
      const isActive = !isFolder && selectedPath === node.path;

      return (
        <li key={node.path || node.name}>
          <div
            className={`studio-tree-node ${isActive ? "studio-tree-node-active" : ""}`}
            style={{ "--depth": depth } as React.CSSProperties}
            onContextMenu={(event) => openTreeContextMenu(event, node, explicitFolder)}
          >
            {isFolder ? (
              <span
                className={`studio-tree-chevron ${expanded ? "studio-tree-chevron-expanded" : ""}`}
                onClick={(e) => { e.stopPropagation(); toggleFolder(node.path); }}
              >
                <svg viewBox="0 0 20 20" style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : (
              <span className="studio-tree-icon">
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 3h6l4 4v10H6V3z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}

            <span
              onClick={() => {
                if (!isFolder) {
                  closeIntellisense();
                  setSelectedPath(node.path);
                  setOpenTabs((prev) => prev.includes(node.path) ? prev : [...prev, node.path]);
                } else {
                  toggleFolder(node.path);
                }
              }}
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
            >
              {isFolder ? `${node.name || "root"}/` : node.name}
            </span>

            {isFolder ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void addProjectEntryAt(node.path, "file"); }}
                  className="studio-btn studio-btn-ghost"
                  style={{ width: 20, height: 20, padding: 0, opacity: 0, fontSize: 0 }}
                  aria-label={`Add file in ${node.path || "root"}`}
                >
                  <svg viewBox="0 0 20 20" style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>

          {isFolder && expanded && node.children?.length ? (
            <ul>{renderProjectTree(node.children, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });
  }

  const effectiveLeftPaneWidth = leftPaneCollapsed ? 34 : leftPaneWidth;
  const effectiveRightPaneWidth = rightPaneCollapsed ? 34 : rightPaneWidth;

  // Ensure openTabs always includes the selected file
  const activeOpenTabs = useMemo(() => {
    if (!activeEntry) return [];
    const tabs = openTabs.includes(activeEntry.path)
      ? openTabs
      : [...openTabs, activeEntry.path];
    return tabs.filter((path) => editableFiles.some((f) => f.path === path));
  }, [openTabs, activeEntry, editableFiles]);

  // Filter projects by search query
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return savedProjects;
    const q = searchQuery.toLowerCase();
    return savedProjects.filter(
      (p) => p.name.toLowerCase().includes(q)
    );
  }, [savedProjects, searchQuery]);

  if (workspaceScreen === "projects") {
    return (
      <main className="studio-dark studio-shell">
        <div className="studio-dashboard studio-scrollbar" style={{ overflowY: "auto" }}>
        {/* Shared project banner */}
        {shareLoading ? (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <p className="text-sm text-emerald-300">Loading shared project...</p>
          </div>
        ) : sharedProject ? (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-emerald-300">📋 Shared Project: {sharedProject.name}</p>
                <p className="text-xs text-emerald-400/80 mt-0.5">{sharedProject.entries?.filter((e: any) => e.kind === "file").length || 0} files</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const projectId = makeProjectId();
                  const now = new Date().toISOString();
                  const snapshot: SavedProjectData = {
                    id: projectId,
                    name: `${sharedProject.name} (copy)`,
                    entries: sharedProject.entries || [],
                    selectedPath: sharedProject.selectedPath || "main.tex",
                    lastCompileAt: "Not compiled yet",
                    updatedAt: now,
                    editorMode: sharedProject.editorMode || "latex",
                  };
                  persistProjectSnapshot(snapshot);
                  queueServerProjectSync(snapshot);
                  setActiveProjectId(projectId);
                  setProjectName(snapshot.name);
                  setProjectEntries(snapshot.entries);
                  setSelectedPath(snapshot.selectedPath);
                  setEditorMode(snapshot.editorMode || (
                    snapshot.entries?.some((e) => e.path.endsWith(".py")) ? "python"
                    : snapshot.entries?.some((e) => e.path.endsWith(".cpp")) ? "cpp"
                    : "latex"
                  ));
                  setCompileNotice(`Copied "${sharedProject.name}" to your projects.`);
                  setWorkspaceScreen("editor");
                  setSharedProject(null);
                }}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-600"
              >
                Copy to My Projects
              </button>
            </div>
          </div>
        ) : shareId ? (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-center">
            <p className="text-sm text-rose-300">Shared project not found or has expired.</p>
          </div>
        ) : null}
        {/* Dashboard header */}
        <div className="studio-dashboard-header">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="studio-dashboard-title">Research Studio</h1>
              <p className="studio-dashboard-subtitle">Create, open, and manage your LaTeX research projects</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createNewProject}
                className="studio-btn studio-btn-primary"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                New Project
              </button>
              <input
                ref={zipImportRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importProjectFromZip(f);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => zipImportRef.current?.click()}
                className="studio-btn studio-btn-secondary"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 10h14M10 3v14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Import
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="studio-search-wrapper" style={{ marginTop: 16 }}>
            <svg viewBox="0 0 20 20" className="studio-search-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="9" r="4" />
              <path d="M12.5 12.5L16 16" strokeLinecap="round" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="studio-search"
            />
          </div>

          {/* Auth info */}
          {usesAccountStorage ? (
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted, #64748b)" }}>
              Projects stored securely in your account
            </p>
          ) : isSignedIn ? (
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted, #64748b)" }}>
              Account storage unavailable — check your connection
            </p>
          ) : authLoaded ? (
            <div className="studio-auth-cta">
              <span>Working offline — up to {GUEST_PROJECT_LIMIT} projects saved in this browser. Sign in to sync unlimited projects.</span>
              <SignUpButton mode="modal">
                <button type="button">Create account</button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button type="button">Sign in</button>
              </SignInButton>
            </div>
          ) : null}

          {/* Storage indicator */}
          <p style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted, #64748b)" }}>
            {usesAccountStorage ? "Synced to account" : `Offline (${savedProjects.length}/${GUEST_PROJECT_LIMIT} projects)`}
            {searchQuery.trim() ? ` · ${filteredProjects.length} of ${savedProjects.length} projects` : ` · ${savedProjects.length} project${savedProjects.length !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Project cards grid */}
        {savedProjects.length === 0 && !loadingProject ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 14, background: "var(--bg-secondary, #131620)", marginBottom: 16 }}>
              <svg viewBox="0 0 24 24" style={{ width: 28, height: 28, color: "var(--text-muted, #64748b)" }} fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <path d="M14 2v6h6M8 13h4M8 17h8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary, #e2e8f0)", marginBottom: 4 }}>No projects yet</p>
            <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", maxWidth: 280, margin: "0 auto" }}>Create a new project or choose a template to get started.</p>
          </div>
        ) : loadingProject ? (
          <div className="studio-project-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="studio-project-card" style={{ minHeight: 100 }}>
                <div className="studio-skeleton" style={{ height: 16, width: "60%", marginBottom: 8 }} />
                <div className="studio-skeleton" style={{ height: 12, width: "40%" }} />
              </div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary, #94a3b8)" }}>No projects match &ldquo;{searchQuery}&rdquo;</p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="studio-btn studio-btn-secondary"
              style={{ marginTop: 12 }}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="studio-project-grid" style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${filteredProjects.length > 8 ? 220 : filteredProjects.length > 4 ? 260 : 280}px, 1fr))`,
          }}>
            {filteredProjects.map((item) => {
              const isActive = item.id === activeProjectId;
              const templateSlugs = RESEARCH_TEMPLATES.map((t) => t.slug);
              const snapshot = savedProjectSnapshots.find((s) => s.id === item.id);
              const fileCount = snapshot?.entries?.filter((e) => e.kind === "file").length ?? 0;
              const tagName = snapshot?.entries?.some((e) => e.path === "main.tex" && e.content.includes("\\documentclass"))
                ? templateSlugs.find((slug) => {
                    const t = getTemplateBySlug(slug);
                    return t && snapshot?.entries?.some((e) => e.path === "main.tex" && e.content === t.entries.find((te) => te.path === "main.tex")?.content);
                  }) ?? "Custom"
                : "Custom";

              const mode = item.type || snapshot?.editorMode || (
                snapshot?.entries?.some((e: ProjectEntry) => e.path.endsWith(".py")) ? "python"
                : snapshot?.entries?.some((e: ProjectEntry) => e.path.endsWith(".cpp")) ? "cpp"
                : "latex"
              );

              return (
                <article
                  key={item.id}
                  className="studio-project-card"
                  data-mode={mode}
                  style={{
                    ...(isActive ? { borderColor: "rgba(74,222,128,0.35)" } : {}),
                  }}
                >
                  <p className="studio-project-card-name">{item.name}</p>
                  <p className="studio-project-card-meta">
                    Updated {new Date(item.updatedAt).toLocaleString()}
                    {fileCount > 0 ? ` · ${fileCount} file${fileCount !== 1 ? "s" : ""}` : ""}
                  </p>
                  <div className="studio-project-card-tags">
                    {tagName !== "Custom" ? (
                      <span className="studio-tag">
                        <span className="studio-tag-dot" style={{ background: tagName === "ieee" ? "#60a5fa" : tagName === "acm" ? "#f472b6" : tagName === "neurips" ? "#a78bfa" : tagName === "lncs" ? "#fbbf24" : "#4ade80" }} />
                        {RESEARCH_TEMPLATES.find((t) => t.slug === tagName)?.name || tagName}
                      </span>
                    ) : null}
                    {(() => {
                      if (mode === "python") {
                        return (
                          <span className="studio-tag">
                            <span className="studio-tag-dot" style={{ background: "#4ade80" }} />
                            Python
                          </span>
                        );
                      }
                      if (mode === "cpp") {
                        return (
                          <span className="studio-tag">
                            <span className="studio-tag-dot" style={{ background: "#f97316" }} />
                            C++
                          </span>
                        );
                      }
                      return (
                        <span className="studio-tag">
                          <span className="studio-tag-dot" style={{ background: "#818cf8" }} />
                          LaTeX
                        </span>
                      );
                    })()}
                  </div>
                  <div className="studio-project-card-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.id !== activeProjectId) saveCurrentProject();
                        loadSavedProject(item.id);
                      }}
                      className="studio-btn studio-btn-primary studio-card-btn"
                      title={`Open ${item.name}`}
                      aria-label={`Open ${item.name}`}
                    >
                      <svg viewBox="0 0 20 20" className="studio-card-btn-icon" aria-hidden="true"><path d="M6 4l9 6-9 6V4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="studio-card-btn-label">Open</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (item.id !== activeProjectId) saveCurrentProject();
                        loadSavedProject(item.id);
                        setTimeout(() => {
                          void downloadProjectBundle();
                        }, 500);
                      }}
                      className="studio-btn studio-btn-secondary studio-card-btn"
                      title={`Download ${item.name}`}
                      aria-label={`Download ${item.name}`}
                    >
                      <svg viewBox="0 0 20 20" className="studio-card-btn-icon" aria-hidden="true"><path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="studio-card-btn-label">Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSavedProject(item.id)}
                      className="studio-btn studio-btn-danger studio-card-btn"
                      title={`Delete ${item.name}`}
                      aria-label={`Delete ${item.name}`}
                    >
                      <svg viewBox="0 0 20 20" className="studio-card-btn-icon" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m-5 0l.5 10h5L13 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="studio-card-btn-label">Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Template quick-start section */}
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary, #e2e8f0)", marginBottom: 12 }}>Start from a LaTeX template</h3>
          <div className="studio-template-grid">
            {RESEARCH_TEMPLATES.filter((t) => !t.slug.startsWith("python-") && !t.slug.startsWith("cpp-")).map((template) => (
              <div
                key={template.slug}
                className="studio-template-card"
                onClick={() => createProjectFromTemplate(template)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") createProjectFromTemplate(template); }}
              >
                <h4>{template.name}</h4>
                <p>{template.description}</p>
              </div>
            ))}
          </div>
        </div>
        </div>
      </main>
    );
  }

  return (
    <main className="studio-dark studio-shell">
      {/* Top bar */}
      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <button
            type="button"
            onClick={openProjectsBoard}
            className="studio-btn studio-btn-ghost"
            aria-label="Back to projects board"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Back</span>
          </button>
          <span style={{ color: "var(--border-color, #334155)" }} className="hidden sm:inline">|</span>
          <span className="studio-topbar-title">{projectName}</span>
          {/* Mode selector tabs */}
          <div className="studio-mode-selector">
            <button
              type="button"
              onClick={() => setEditorMode("latex")}
              className={`studio-mode-tab ${editorMode === "latex" ? "studio-mode-tab-active" : ""}`}
            >
              LaTeX
            </button>
            <button
              type="button"
              onClick={() => setEditorMode("python")}
              className={`studio-mode-tab ${editorMode === "python" ? "studio-mode-tab-active" : ""}`}
            >
              Python
            </button>
            <button
              type="button"
              onClick={() => setEditorMode("cpp")}
              className={`studio-mode-tab ${editorMode === "cpp" ? "studio-mode-tab-active" : ""}`}
            >
              C++
            </button>
          </div>
          <span className={`studio-topbar-meta ${autoSaveStatus === "saved" ? "studio-status-saved" : autoSaveStatus === "unsaved" ? "studio-status-unsaved" : ""}`}>
            {autoSaveStatus === "saved" ? `Saved ${autoSaveTimestamp || ""}` : autoSaveStatus === "saving" ? "Saving..." : "Unsaved"}
          </span>
        </div>
        <div className="studio-topbar-right">
          {isMobile ? (
            <>
              <button
                type="button"
                onClick={() => setLeftPaneCollapsed(!leftPaneCollapsed)}
                className="studio-btn studio-btn-secondary"
              >
                {leftPaneCollapsed ? "Files" : "Hide"}
              </button>
              <button
                type="button"
                onClick={() => setRightPaneCollapsed(!rightPaneCollapsed)}
                className="studio-btn studio-btn-secondary"
              >
                {rightPaneCollapsed ? "Preview" : "Hide"}
              </button>
            </>
          ) : null}
          {isCodeMode ? (
            <>
              {/* Language selector in code mode */}
              <select
                value={editorMode}
                onChange={(e) => setEditorMode(e.target.value as EditorMode)}
                className="studio-code-lang-select"
              >
                <option value="python">Python</option>
                <option value="cpp">C++</option>
              </select>
              <button
                type="button"
                onClick={() => void compileProject()}
                disabled={codeRunBusy}
                className="studio-btn studio-btn-primary"
                aria-label={codeRunBusy ? "Running code" : "Run code"}
                style={{ background: "#4ade80", color: "#000" }}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" stroke="none">
                  <path d="M7 4l9 6-9 6V4z" />
                </svg>
                <span className="hidden sm:inline">{codeRunBusy ? "Running..." : "Run"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const ext = editorMode === "python" ? ".py" : ".cpp";
                  const filename = activeEntry?.path || `program${ext}`;
                  const blob = new Blob([activeSource], { type: "text/plain;charset=utf-8" });
                  downloadBlob(blob, filename.split("/").pop() || filename);
                }}
                className="studio-btn studio-btn-secondary"
                aria-label="Download source file"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Download</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void compileProject()}
                disabled={compileBusy}
                className="studio-btn studio-btn-primary"
                aria-label={compileBusy ? "Compiling project" : "Compile project"}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 6l7 4-7 4V6z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">{compileBusy ? "Compiling..." : "Compile"}</span>
              </button>
              <button
                type="button"
                onClick={() => void downloadProjectBundle()}
                className="studio-btn studio-btn-secondary"
                aria-label="Download project bundle"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Download</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openCollaborateDialog}
            className="studio-btn inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-purple-500/30 transition hover:scale-105 hover:shadow-xl hover:shadow-purple-500/40"
            aria-label="Collaborate"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM3 17v-1a4 4 0 0 1 4-4h2.5M14 12h4m-2-2v4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Collaborate</span>
          </button>
          <button
            type="button"
            onClick={saveCurrentProject}
            className="studio-btn studio-btn-secondary"
            aria-label="Save current project"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 3h10l2 2v12H4V3z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 3v5h6V3M7 14h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </header>

      {/* ── Menu Bar ──────────────────────────────── */}
      <div
        className="studio-menubar"
        onMouseLeave={() => {
          if (menuHoverTimerRef.current) {
            clearTimeout(menuHoverTimerRef.current);
            menuHoverTimerRef.current = null;
          }
          menuCloseTimerRef.current = setTimeout(() => {
            setOpenMenu("");
          }, 200);
        }}
      >
        {[
          {
            label: "File", key: "file", items: [
              { label: <>New Project</>, action: () => { setOpenMenu(""); createNewProject(); } },
              { label: <>Open Project</>, action: () => { setOpenMenu(""); openProjectsBoard(); } },
              "-",
              { label: <>Save <kbd className="studio-menu-kbd">Ctrl+S</kbd></>, action: () => { setOpenMenu(""); saveCurrentProject(); } },
              { label: <>Download ZIP</>, action: () => { setOpenMenu(""); void downloadProjectBundle(); } },
              "-",
              { label: <>Import ZIP</>, action: () => { setOpenMenu(""); document.getElementById("zip-import-editor-menu")?.click(); } },
            ]
          },
          {
            label: "Edit", key: "edit", items: [
              { label: <>Undo <kbd className="studio-menu-kbd">Ctrl+Z</kbd></>, action: () => { setOpenMenu(""); undo(); } },
              { label: <>Redo <kbd className="studio-menu-kbd">Ctrl+Y</kbd></>, action: () => { setOpenMenu(""); redo(); } },
              "-",
              { label: <>Find <kbd className="studio-menu-kbd">Ctrl+F</kbd></>, action: () => { setOpenMenu(""); setFindPanelOpen(true); setReplacePanelOpen(false); } },
              { label: <>Replace <kbd className="studio-menu-kbd">Ctrl+H</kbd></>, action: () => { setOpenMenu(""); setFindPanelOpen(true); setReplacePanelOpen(true); } },
            ]
          },
          editorMode === "latex" ? {
            label: "Insert", key: "insert", items: [
              { label: "Section", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\section{}\n", cursorOffset: 9 }); } },
              { label: "Subsection", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\subsection{}\n", cursorOffset: 12 }); } },
              "-",
              { label: "Inline Math", action: () => { setOpenMenu(""); insertEditorSnippet({ before: "$", after: "$", placeholder: "math" }); } },
              { label: "Equation Block", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\begin{equation}\n  \n\\end{equation}\n", cursorOffset: 18 }); } },
              "-",
              { label: "Figure", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n  \\label{}\n\\end{figure}\n", cursorOffset: 62 }); } },
              { label: "Table", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{lcc}\n    \\toprule\n     &  & \\\\\n    \\midrule\n     &  & \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n", cursorOffset: 41 }); } },
              "-",
              { label: "Citation", action: () => { setOpenMenu(""); insertEditorSnippet({ before: "\\cite{", after: "}" }); } },
              { label: "Reference", action: () => { setOpenMenu(""); insertEditorSnippet({ before: "\\ref{", after: "}", placeholder: "key" }); } },
              { label: "Bullet List", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\begin{itemize}\n  \\item \n\\end{itemize}\n", cursorOffset: 17 }); } },
              { label: "Numbered List", action: () => { setOpenMenu(""); insertEditorSnippet({ block: "\\begin{enumerate}\n  \\item \n\\end{enumerate}\n", cursorOffset: 18 }); } },
            ]
          } : null,
          {
            label: "Format", key: "format", items: [
              { label: <>Bold <kbd className="studio-menu-kbd">Ctrl+B</kbd></>, action: () => { setOpenMenu(""); insertEditorSnippet({ before: "\\textbf{", after: "}", placeholder: "text" }); } },
              { label: <>Italic <kbd className="studio-menu-kbd">Ctrl+I</kbd></>, action: () => { setOpenMenu(""); insertEditorSnippet({ before: "\\textit{", after: "}", placeholder: "text" }); } },
              { label: "Underline", action: () => { setOpenMenu(""); insertEditorSnippet({ before: "\\underline{", after: "}", placeholder: "text" }); } },
            ]
          },
          {
            label: "View", key: "view", items: [
              { label: rightPaneCollapsed ? "Show PDF Preview" : "Hide PDF Preview", action: () => { setOpenMenu(""); setRightPaneCollapsed(!rightPaneCollapsed); } },
              { label: leftPaneCollapsed ? "Show File Tree" : "Hide File Tree", action: () => { setOpenMenu(""); setLeftPaneCollapsed(!leftPaneCollapsed); } },
              "-",
              { label: "Keyboard Shortcuts", action: () => { setOpenMenu(""); setShowShortcuts(!showShortcuts); } },
            ]
          },
          {
            label: "Help", key: "help", items: [
              { label: "FAQ", action: () => { setOpenMenu(""); window.open("/faq", "_blank"); } },
              { label: "Keyboard Shortcuts", action: () => { setOpenMenu(""); setShowShortcuts(true); } },
            ]
          },
        ].filter(Boolean).map((menu: any) => (
          <div key={menu.key} className="studio-menu-group">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === menu.key ? "" : menu.key)}
              onMouseEnter={() => {
                if (menuCloseTimerRef.current) {
                  clearTimeout(menuCloseTimerRef.current);
                  menuCloseTimerRef.current = null;
                }
                if (menuHoverTimerRef.current) clearTimeout(menuHoverTimerRef.current);
                menuHoverTimerRef.current = setTimeout(() => {
                  setOpenMenu(menu.key);
                }, 150);
              }}
              className={`studio-menu-trigger ${openMenu === menu.key ? "studio-menu-active" : ""}`}>{menu.label}</button>
            {openMenu === menu.key ? (
              <div className="studio-menu-dropdown">
                {menu.items.map((item: any, i: number) => (
                  item === "-" ? <hr key={i} className="studio-menu-divider" /> :
                  <button key={i} type="button" onClick={item.action} className="studio-menu-item">{item.label}</button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Tab bar */}
      {activeOpenTabs.length > 0 ? (
        <div className="studio-tabbar">
          {activeOpenTabs.map((path) => (
            <div
              key={path}
              className={`studio-tab ${selectedPath === path ? "studio-tab-active" : ""}`}
              onClick={() => { closeIntellisense(); setSelectedPath(path); }}
            >
              <span>{path.split("/").pop() || path}</span>
              <button
                type="button"
                className="studio-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenTabs((current) => {
                    const next = current.filter((t) => t !== path);
                    if (path === selectedPath && next.length) {
                      setSelectedPath(next[next.length - 1]);
                    }
                    return next;
                  });
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Main panes */}
      <section
        ref={panesRef}
        className="studio-panes"
        style={{
          "--left-width": leftPaneCollapsed ? "40px" : `${leftPaneWidth}px`,
          "--right-width": rightPaneCollapsed ? "40px" : `${rightPaneWidth}px`,
        } as React.CSSProperties}
      >
        {/* File tree sidebar */}
        <aside className="studio-filetree">
          {leftPaneCollapsed ? (
            <button
              type="button"
              className="studio-collapsed-btn"
              onClick={() => setLeftPaneCollapsed(false)}
            >
              <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Files
            </button>
          ) : (
            <>
              <div className="studio-filetree-header">
                <span className="studio-filetree-title">Files</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => void addProjectEntryAt("", "file")}
                    className="studio-btn studio-btn-ghost"
                    style={{ width: 24, height: 24, padding: 0 }}
                    aria-label="Add file"
                  >
                    <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => void addProjectEntryAt("", "folder")}
                    className="studio-btn studio-btn-ghost"
                    style={{ width: 24, height: 24, padding: 0 }}
                    aria-label="Add folder"
                  >
                    <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h5l1.2 1.5H17v7.5H3V6z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftPaneCollapsed(true)}
                    className="studio-btn studio-btn-ghost"
                    style={{ width: 24, height: 24, padding: 0 }}
                    aria-label="Collapse"
                  >
                    <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="studio-filetree-header" style={{ borderBottom: "none", padding: "4px 12px" }}>
                <input
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addProjectFile(); }}
                  placeholder="Add file/folder..."
                  style={{
                    flex: 1,
                    height: 24,
                    padding: "0 8px",
                    background: "var(--bg-primary, #0d0f17)",
                    border: "1px solid var(--border-color, #334155)",
                    borderRadius: 4,
                    color: "var(--text-primary, #e2e8f0)",
                    fontSize: 11,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={addProjectFile}
                  className="studio-btn studio-btn-ghost"
                  style={{ height: 24, fontSize: 10, padding: "0 6px" }}
                >
                  Add
                </button>
              </div>
              {addFileError ? <p style={{ padding: "4px 12px", fontSize: 11, color: "#ef4444" }}>{addFileError}</p> : null}
              <div className="studio-filetree-body">
                {renderProjectTree(projectTree)}
              </div>
            </>
          )}
        </aside>

        {/* Left resize */}
        <div
          className="studio-resize-handle"
          onMouseDown={() => { if (!leftPaneCollapsed) setActiveResizer("left"); }}
        >
          <div className="studio-resize-handle-inner" />
        </div>

        {/* Editor area */}
        <div className="studio-editor-wrapper">
          {/* Editor toolbar */}
          {isCodeMode ? (
            <div className="studio-editor-toolbar">
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary, #e2e8f0)", marginRight: 8 }}>
                {editorMode === "python" ? "Python" : "C++"}
              </span>
              <button type="button" onClick={() => setFindPanelOpen((c) => !c)} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, padding: "0 8px" }} title="Find & Replace">
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="9" r="4" /><path d="M12.5 12.5L16 16" strokeLinecap="round" />
                </svg>
              </button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button
                type="button"
                onClick={() => setTerminalOpen((prev) => !prev)}
                className={`studio-btn studio-btn-ghost ${terminalOpen ? "studio-terminal-btn-active" : ""}`}
                style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                title={terminalOpen ? "Hide Terminal" : "Show Terminal"}
              >
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6l3 3-3 3M9 12h6" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="2" y="3" width="16" height="14" rx="2" />
                </svg>
              </button>
              <span style={{ fontSize: 11, color: "var(--text-muted, #64748b)", marginLeft: 8 }}>{activeEntry?.path || "No file selected"}</span>
            </div>
          ) : (
            <div className="studio-editor-toolbar">
              <button type="button" onClick={() => insertEditorSnippet({ before: "\\textbf{", after: "}", placeholder: "bold text" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, fontWeight: 700, padding: "0 8px" }} title="Bold (Ctrl+B)">B</button>
              <button type="button" onClick={() => insertEditorSnippet({ before: "\\textit{", after: "}", placeholder: "italic text" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, fontStyle: "italic", padding: "0 8px" }} title="Italic (Ctrl+I)">I</button>
              <button type="button" onClick={() => insertEditorSnippet({ before: "\\underline{", after: "}", placeholder: "underlined text" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, textDecoration: "underline", padding: "0 8px" }} title="Underline">U</button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\section{Section Title}\n", before: "", after: "", cursorOffset: 9 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, fontWeight: 600, padding: "0 8px" }} title="Section">S1</button>
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\subsection{Subsection Title}\n", before: "", after: "", cursorOffset: 12 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, fontWeight: 600, padding: "0 8px" }} title="Subsection">S2</button>
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\subsubsection{Title}\n", before: "", after: "", cursorOffset: 15 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, fontWeight: 600, padding: "0 8px" }} title="Subsubsection">S3</button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button type="button" onClick={() => insertEditorSnippet({ before: "$", after: "$", placeholder: "math" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, padding: "0 8px" }} title="Inline math">$</button>
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\begin{equation}\n  E = mc^2\n  \\label{eq:key}\n\\end{equation}\n", before: "", after: "", cursorOffset: 18 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, padding: "0 8px" }} title="Equation block">eq</button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\begin{itemize}\n  \\item First item\n  \\item Second item\n\\end{itemize}\n", before: "", after: "", cursorOffset: 17 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, padding: "0 8px" }} title="Bullet list">•list</button>
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\begin{enumerate}\n  \\item First item\n  \\item Second item\n\\end{enumerate}\n", before: "", after: "", cursorOffset: 18 })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, padding: "0 8px" }} title="Numbered list">1.list</button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/plot.png}\n  \\caption{Figure caption}\n  \\label{fig:plot}\n\\end{figure}\n", before: "", after: "", cursorOffset: 62 })} className="studio-btn studio-btn-ghost" style={{ height: 26, padding: "0 8px" }} title="Figure">
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="14" height="12" rx="1.5" /><circle cx="8" cy="8" r="1.2" /><path d="M4.5 14l4.5-4 2.6 2 1.9-1.7L15.5 14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" onClick={() => insertEditorSnippet({ block: "\\begin{table}[htbp]\n  \\centering\n  \\caption{Table caption}\n  \\label{tab:key}\n  \\begin{tabular}{lcc}\n    \\toprule\n    Item & A & B \\\\\n    \\midrule\n    X & 1 & 2 \\\\\n    Y & 3 & 4 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n", before: "", after: "", cursorOffset: 41 })} className="studio-btn studio-btn-ghost" style={{ height: 26, padding: "0 8px" }} title="Table">
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="14" height="12" rx="1" /><path d="M3 9h14M10 4v12" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" onClick={() => insertEditorSnippet({ before: "\\cite{", after: "}", placeholder: "key" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, padding: "0 8px" }} title="Citation">cite</button>
              <button type="button" onClick={() => insertEditorSnippet({ before: "\\ref{", after: "}", placeholder: "key" })} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 10, padding: "0 8px" }} title="Reference">ref</button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button type="button" onClick={() => setFindPanelOpen((c) => !c)} className="studio-btn studio-btn-ghost" style={{ height: 26, fontSize: 11, padding: "0 8px" }} title="Find & Replace">
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="9" r="4" /><path d="M12.5 12.5L16 16" strokeLinecap="round" />
                </svg>
              </button>
              <span style={{ width: 1, height: 18, background: "var(--border-color, #334155)", margin: "0 4px" }} />
              <button
                type="button"
                onClick={() => setTerminalOpen((prev) => !prev)}
                className={`studio-btn studio-btn-ghost ${terminalOpen ? "studio-terminal-btn-active" : ""}`}
                style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                title={terminalOpen ? "Hide Terminal" : "Show Terminal"}
              >
                <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6l3 3-3 3M9 12h6" strokeLinecap="round" strokeLinejoin="round" />
                  <rect x="2" y="3" width="16" height="14" rx="2" />
                </svg>
              </button>
              <span style={{ fontSize: 11, color: "var(--text-muted, #64748b)", marginLeft: 8 }}>{activeEntry?.path || "No file selected"}</span>
            </div>
          )}

          {/* Find/replace panel */}
          {findPanelOpen ? (
            <div className="studio-find-panel">
              <input ref={findInputRef} value={findQuery} onChange={(e) => setFindQuery(e.target.value)} placeholder="Find..." className="studio-find-input" />
              <span className="studio-find-count">{findMatches.length ? `${boundedActiveMatchIndex + 1}/${findMatches.length}` : "0/0"}</span>
              <button type="button" onClick={() => jumpToNextMatch(-1)} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10 }}>Prev</button>
              <button type="button" onClick={() => jumpToNextMatch(1)} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10 }}>Next</button>
              <button type="button" onClick={() => setReplacePanelOpen((c) => !c)} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10 }}>{replacePanelOpen ? "Hide Replace" : "Replace"}</button>
              <label style={{ fontSize: 10, color: "var(--text-muted, #64748b)", display: "flex", alignItems: "center", gap: 2 }}><input type="checkbox" checked={findCaseSensitive} onChange={(e) => setFindCaseSensitive(e.target.checked)} style={{ width: 12, height: 12 }} />Aa</label>
              <label style={{ fontSize: 10, color: "var(--text-muted, #64748b)", display: "flex", alignItems: "center", gap: 2 }}><input type="checkbox" checked={findUseRegex} onChange={(e) => setFindUseRegex(e.target.checked)} style={{ width: 12, height: 12 }} />.*</label>
              <label style={{ fontSize: 10, color: "var(--text-muted, #64748b)", display: "flex", alignItems: "center", gap: 2 }}><input type="checkbox" checked={findWholeWord} onChange={(e) => setFindWholeWord(e.target.checked)} style={{ width: 12, height: 12 }} />Word</label>
              <button type="button" onClick={() => { setFindPanelOpen(false); setReplacePanelOpen(false); }} style={{ background: "none", border: "none", color: "var(--text-muted, #64748b)", cursor: "pointer", marginLeft: "auto", fontSize: 16 }}>×</button>
              {replacePanelOpen ? (
                <>
                  <input value={replaceQuery} onChange={(e) => setReplaceQuery(e.target.value)} placeholder="Replace with..." className="studio-find-input" style={{ marginTop: 4, width: "100%" }} />
                  <button type="button" onClick={replaceCurrentMatch} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10 }}>Replace</button>
                  <button type="button" onClick={replaceAllMatches} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10 }}>All</button>
                </>
              ) : null}
              {findRegexError ? <span style={{ fontSize: 10, color: "#ef4444" }}>{findRegexError}</span> : null}
            </div>
          ) : null}

          {/* Editor with line numbers */}
          <div className="studio-editor-with-gutter">
            {showMatchGutter ? (
              <div className="studio-match-gutter">
                <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted, #64748b)", marginBottom: 4 }}>Matches</p>
                {matchLines.length ? matchLines.map((line) => (
                  <button key={`match-line-${line.lineNumber}`} type="button" onClick={() => focusMatch(line.firstMatchIndex)} style={{ display: "block", width: "100%", textAlign: "left", padding: "2px 4px", fontSize: 10, color: "var(--text-secondary, #94a3b8)", background: "none", border: "none", cursor: "pointer", borderRadius: 2 }}>
                    L{line.lineNumber} ({line.count})
                  </button>
                )) : <p style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>None</p>}
              </div>
            ) : null}

            {/* Line numbers gutter */}
            <div className="studio-editor-gutter">
              {activeSource.split("\n").map((_, i) => (
                <div key={i} style={{ lineHeight: 1.625 }}>{i + 1}</div>
              ))}
            </div>

            <div className="studio-editor-area">
              <pre
                aria-hidden="true"
                className="studio-editor-highlight"
                style={{ transform: `translate(${-editorScroll.left}px, ${-editorScroll.top}px)` }}
                dangerouslySetInnerHTML={{
                  __html: `${highlightedSource
                    .replace(/latex-token-/g, "studio-hl-")}\n`,
                }}
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
                className="studio-editor-textarea"
                spellCheck={true}
                lang="en"
              />

              {intellisenseOptions.length && intellisensePosition ? (
                <div className="studio-intellisense" style={{ top: `${intellisensePosition.top}px`, left: `${intellisensePosition.left}px` }}>
                  <div className="studio-intellisense-header">Suggestions</div>
                  <div className="studio-intellisense-list">
                    {intellisenseOptions.map((item, index) => (
                      <div
                        key={`${item.label}-${index}`}
                        className={`studio-intellisense-item ${index === intellisenseIndex ? "studio-intellisense-item-active" : ""}`}
                        onMouseDown={(event) => { event.preventDefault(); applyIntellisenseSelection(index); }}
                      >
                        <span className="studio-intellisense-item-label">\{item.label}</span>
                        <span className="studio-intellisense-item-detail">{item.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {equationTooltip ? (
                <div
                  className="studio-eq-tooltip"
                  style={{ top: `${equationTooltip.top}px`, left: `${equationTooltip.left}px` }}
                  dangerouslySetInnerHTML={{
                    __html: (() => {
                      try {
                        return katex.renderToString(equationTooltip.latex, { displayMode: true, throwOnError: true });
                      } catch {
                        return '<span style="font-size:12px;color:#ef4444">Could not render equation</span>';
                      }
                    })(),
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* Code output panel */}
          {isCodeMode && codeOutput ? (
            <div className="studio-code-output">
              <div className="studio-code-output-header">
                <span>Output {codeOutput.exitCode !== undefined ? `(exit: ${codeOutput.exitCode})` : ""}</span>
                <button
                  type="button"
                  onClick={() => setCodeOutput(null)}
                  className="studio-btn studio-btn-ghost"
                  style={{ height: 20, fontSize: 10, padding: "0 6px" }}
                >
                  Clear
                </button>
              </div>
              {codeOutput.stdout ? (
                <pre className="studio-code-output-body" style={{ color: "#4ade80" }}>{codeOutput.stdout}</pre>
              ) : null}
              {codeOutput.stderr ? (
                <pre className="studio-code-output-body" style={{ color: "#f87171" }}>{codeOutput.stderr}</pre>
              ) : null}
              {!codeOutput.stdout && !codeOutput.stderr ? (
                <pre className="studio-code-output-body" style={{ color: "#94a3b8" }}>No output.</pre>
              ) : null}
            </div>
          ) : null}
          {/* Running indicator */}
          {isCodeMode && codeRunBusy && !codeOutput ? (
            <div className="studio-code-output">
              <div className="studio-code-output-header">
                <span>Output</span>
              </div>
              <pre className="studio-code-output-body" style={{ color: "#fbbf24" }}>Running...</pre>
            </div>
          ) : null}

          {/* Terminal pane */}
          {terminalOpen ? (
            <div
              className="studio-terminal"
              style={{ height: `${terminalHeight}px` }}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === "`") {
                  e.preventDefault();
                  setTerminalOpen(false);
                }
              }}
            >
              {/* Drag handle */}
              <div
                className="studio-terminal-resize-handle"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startHeight = terminalHeight;
                  const onMouseMove = (ev: MouseEvent) => {
                    const delta = startY - ev.clientY;
                    setTerminalHeight(clamp(startHeight + delta, 80, window.innerHeight * 0.5));
                  };
                  const onMouseUp = () => {
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);
                  };
                  document.addEventListener("mousemove", onMouseMove);
                  document.addEventListener("mouseup", onMouseUp);
                }}
              />
              {/* Header */}
              <div className="studio-terminal-header">
                <span>Terminal</span>
                <button
                  type="button"
                  onClick={() => setTerminalOpen(false)}
                  className="studio-terminal-close-btn"
                  aria-label="Close terminal"
                >
                  <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {/* Output */}
              <div
                className="studio-terminal-output"
                ref={(el) => {
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                {terminalOutput.map((line, i) => (
                  <div key={i} className={`studio-terminal-${line.type}`}>
                    {line.type === "command" ? `$ ${line.text}` : line.text}
                  </div>
                ))}
                {terminalBusy ? (
                  <div className="studio-terminal-command">Running...</div>
                ) : null}
              </div>
              {/* Input line */}
              <div className="studio-terminal-input-line">
                <span className="studio-terminal-prompt">$</span>
                <input
                  ref={terminalInputRef}
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runTerminalCommand();
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (terminalHistory.length > 0) {
                        const nextIdx =
                          terminalHistoryIdx === -1
                            ? terminalHistory.length - 1
                            : Math.max(0, terminalHistoryIdx - 1);
                        setTerminalHistoryIdx(nextIdx);
                        setTerminalInput(terminalHistory[nextIdx]);
                      }
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (terminalHistoryIdx >= 0) {
                        const nextIdx = terminalHistoryIdx + 1;
                        if (nextIdx >= terminalHistory.length) {
                          setTerminalHistoryIdx(-1);
                          setTerminalInput("");
                        } else {
                          setTerminalHistoryIdx(nextIdx);
                          setTerminalInput(terminalHistory[nextIdx]);
                        }
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setTerminalOpen(false);
                    } else if (e.ctrlKey && e.key === "`") {
                      e.preventDefault();
                      setTerminalOpen(false);
                    }
                  }}
                  disabled={terminalBusy}
                  className="studio-terminal-input"
                  placeholder={terminalBusy ? "Running..." : "Enter command..."}
                  autoFocus
                />
              </div>
            </div>
          ) : null}

          {/* Status bar */}
          <div className="studio-statusbar">
            <div className="studio-statusbar-left">
              <span>Words: {wordCount.words}</span>
              <span>Chars: {wordCount.chars}</span>
              {wordCount.abstractWords > 0 ? (
                <span style={wordCount.abstractWords > 250 ? { color: "#ef4444" } : {}}>Abstract: {wordCount.abstractWords}/250</span>
              ) : null}
              <span>UTF-8 · {isCodeMode ? (editorMode === "python" ? "Python" : "C++") : "LaTeX"}</span>
            </div>
            <div className="studio-statusbar-right">
              <span>Compiled: {lastCompileAt}</span>
              <span className={autoSaveStatus === "saved" ? "studio-status-saved" : autoSaveStatus === "unsaved" ? "studio-status-unsaved" : ""}>
                {autoSaveStatus === "saved" ? `Saved ${autoSaveTimestamp || ""}` : autoSaveStatus === "saving" ? "Saving..." : "Unsaved"}
              </span>
              <button type="button" onClick={() => setShowShortcuts((c) => !c)} style={{ background: "none", border: "none", color: "var(--text-muted, #64748b)", cursor: "pointer", fontSize: 11 }}>
                {showShortcuts ? "Hide shortcuts" : "Shortcuts"}
              </button>
            </div>
          </div>

          {/* Keyboard shortcuts */}
          {showShortcuts ? (
            <div className="studio-shortcuts">
              <div><kbd className="studio-kbd">Ctrl+Z</kbd> Undo</div>
              <div><kbd className="studio-kbd">Ctrl+Y</kbd> Redo</div>
              <div><kbd className="studio-kbd">Ctrl+Shift+Z</kbd> Redo</div>
              {isCodeMode ? (
                <>
                  <div><kbd className="studio-kbd">Ctrl+S</kbd> Run</div>
                  <div><kbd className="studio-kbd">Ctrl+Enter</kbd> Run</div>
                  <div><kbd className="studio-kbd">Ctrl+F</kbd> Find</div>
                  <div><kbd className="studio-kbd">Ctrl+H</kbd> Replace</div>
                  <div><kbd className="studio-kbd">Ctrl+G</kbd> Next match</div>
                  <div><kbd className="studio-kbd">Ctrl+D</kbd> Duplicate</div>
                  <div><kbd className="studio-kbd">Ctrl+/</kbd> Comment</div>
                  <div><kbd className="studio-kbd">Tab</kbd> Indent</div>
                  <div><kbd className="studio-kbd">Esc</kbd> Close panels</div>
                </>
              ) : (
                <>
                  <div><kbd className="studio-kbd">Ctrl+B</kbd> Bold</div>
                  <div><kbd className="studio-kbd">Ctrl+I</kbd> Italic</div>
                  <div><kbd className="studio-kbd">Ctrl+S</kbd> Compile</div>
                  <div><kbd className="studio-kbd">Ctrl+Enter</kbd> Compile</div>
                  <div><kbd className="studio-kbd">Ctrl+F</kbd> Find</div>
                  <div><kbd className="studio-kbd">Ctrl+H</kbd> Replace</div>
                  <div><kbd className="studio-kbd">Ctrl+G</kbd> Next match</div>
                  <div><kbd className="studio-kbd">Ctrl+D</kbd> Duplicate</div>
                  <div><kbd className="studio-kbd">Ctrl+/</kbd> Comment</div>
                  <div><kbd className="studio-kbd">Tab</kbd> Indent</div>
                  <div><kbd className="studio-kbd">Esc</kbd> Close panels</div>
                  <div><kbd className="studio-kbd">Ctrl+Click</kbd> Sync PDF</div>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Right resize */}
        <div
          className="studio-resize-handle"
          onMouseDown={() => { if (!rightPaneCollapsed) setActiveResizer("right"); }}
        >
          <div className="studio-resize-handle-inner" />
        </div>

        {/* Preview pane */}
        <aside className="studio-preview">
          {rightPaneCollapsed ? (
            <button type="button" className="studio-collapsed-btn" onClick={() => setRightPaneCollapsed(false)}>
              <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Preview
            </button>
          ) : (
            <>
              <div className="studio-preview-header">
                <span className="studio-preview-title">PDF Preview</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {compiledPdfUrl ? (
                    <a href={compiledPdfUrl} download={compiledPdfFileName} className="studio-btn studio-btn-ghost" style={{ height: 24, fontSize: 10, padding: "0 6px", textDecoration: "none" }}>
                      <svg viewBox="0 0 20 20" style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 3v9m0 0l-3-3m3 3l3-3M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </a>
                  ) : null}
                  <button type="button" onClick={() => setRightPaneCollapsed(true)} className="studio-btn studio-btn-ghost" style={{ width: 24, height: 24, padding: 0 }}>
                    <svg viewBox="0 0 20 20" style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="studio-preview-body">
                <p style={{ padding: "4px 12px", fontSize: 10, color: "var(--text-muted, #64748b)" }}>
                  {compileBusy ? "Compiling..." : compileNotice}
                </p>
                {synctexNotice ? <p style={{ padding: "0 12px 4px", fontSize: 10, color: "#f59e0b" }}>{synctexNotice}</p> : null}

                {/* Log viewer */}
                {compileMainLog ? (
                  <details style={{ margin: "4px 8px", border: "1px solid var(--border-color, #334155)", borderRadius: 6, overflow: "hidden" }}>
                    <summary style={{ cursor: "pointer", padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #94a3b8)", background: "var(--bg-sidebar, #1a1d2b)" }}>
                      {compileMainLogFileName}
                    </summary>
                    <div style={{ padding: "4px 8px", display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => downloadBlob(new Blob([compileMainLog], { type: "text/plain;charset=utf-8" }), compileMainLogFileName)}
                        className="studio-btn studio-btn-ghost"
                        style={{ height: 22, fontSize: 10 }}
                      >
                        Download log
                      </button>
                    </div>
                    <pre className="studio-log-viewer">{compileMainLog}</pre>
                  </details>
                ) : null}

                {/* AI Fix suggestions */}
                {compileMainLog ? (
                  <div className="studio-ai-fixes">
                    <div style={{ padding: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary, #e2e8f0)" }}>AI Fix Suggestions</span>
                      <button
                        type="button"
                        onClick={() => void fetchAiFixSuggestions()}
                        disabled={aiFixBusy}
                        className="studio-btn studio-btn-primary"
                        style={{ height: 24, fontSize: 10, padding: "0 8px" }}
                      >
                        {aiFixBusy ? "Analyzing..." : "Get suggestions"}
                      </button>
                    </div>
                    {aiFixSummary ? <p style={{ padding: "0 8px", fontSize: 10, color: "var(--text-secondary, #94a3b8)" }}>{aiFixSummary}</p> : null}
                    {aiFixError ? <p style={{ padding: "0 8px", fontSize: 10, color: "#ef4444" }}>{aiFixError}</p> : null}
                    {aiFixSuggestions.length ? (
                      <div style={{ maxHeight: 200, overflow: "auto" }}>
                        {aiFixSuggestions.map((suggestion, index) => (
                          <div key={`${suggestion.title}-${index}`} className="studio-ai-fix-item">
                            <p className="studio-ai-fix-title">{suggestion.title}</p>
                            <p className="studio-ai-fix-why">{suggestion.why}</p>
                            {suggestion.files?.length ? <p style={{ fontSize: 10, color: "var(--text-muted, #64748b)" }}>Files: {suggestion.files.join(", ")}</p> : null}
                            {suggestion.steps?.length ? (
                              <ol style={{ margin: "4px 0", paddingLeft: 16, fontSize: 10, color: "var(--text-secondary, #94a3b8)" }}>
                                {suggestion.steps.map((step, si) => <li key={`${index}-step-${si}`}>{step}</li>)}
                              </ol>
                            ) : null}
                            {suggestion.patch ? (
                              <>
                                <div style={{ marginTop: 4, textAlign: "right" }}>
                                  <button
                                    type="button"
                                    onClick={() => applyAiPatchToActiveFile(suggestion.patch || "")}
                                    disabled={!isValidAiPatchSnippet(suggestion.patch || "") || !activeEntry}
                                    className="studio-btn studio-btn-secondary"
                                    style={{ height: 22, fontSize: 9 }}
                                  >
                                    Apply to active file
                                  </button>
                                </div>
                                <pre className="studio-log-viewer" style={{ margin: "4px 0 0 0" }}>{suggestion.patch}</pre>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Error logs */}
                {previewErrorLogs.length ? (
                  <div className="studio-preview-errors" style={{ padding: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#ef4444" }}>Errors</span>
                      <button type="button" onClick={() => setPreviewErrorLogs([])} className="studio-btn studio-btn-ghost" style={{ height: 20, fontSize: 9 }}>Clear</button>
                    </div>
                    {previewErrorLogs.map((entry) => <div key={entry} style={{ fontSize: 10, color: "#f87171" }}>{entry}</div>)}
                  </div>
                ) : null}

                {compiledPdfUrl ? (
                  <iframe
                    src={compiledPdfUrl}
                    title="Compiled LaTeX PDF preview"
                    className="studio-preview-iframe"
                    onClick={(event) => {
                      if (!event.ctrlKey && !event.metaKey) return;
                      if (!synctexRecords.length) {
                        setSynctexNotice("No SyncTeX data available. Recompile with synctex enabled.");
                        return;
                      }
                      const iframe = event.currentTarget;
                      const rect = iframe.getBoundingClientRect();
                      const relY = event.clientY - rect.top;
                      const approxPage = Math.floor(relY / (rect.height / Math.max(1, synctexRecords.reduce((max, r) => Math.max(max, r.page), 0)))) + 1;
                      const match = synctexRecords.find((r) => r.page === approxPage);
                      if (match) {
                        const targetFile = match.file.replace(/^\.\//, "");
                        const fileEntry = projectEntries.find(
                          (e) => e.kind === "file" && (e.path === targetFile || e.path.endsWith("/" + targetFile.split("/").pop() || ""))
                        );
                        if (fileEntry) {
                          setSelectedPath(fileEntry.path);
                          setOpenTabs((prev) => prev.includes(fileEntry.path) ? prev : [...prev, fileEntry.path]);
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
                ) : (
                  <div className="studio-preview-empty">
                    <svg viewBox="0 0 24 24" style={{ width: 32, height: 32, opacity: 0.4 }} fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p style={{ fontSize: 13 }}>No PDF compiled</p>
                    <button type="button" onClick={() => void compileProject()} className="studio-btn studio-btn-primary">
                      Compile to preview
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </section>

      {treeContextMenu ? (
        <div
          ref={treeContextMenuRef}
          className="studio-context-menu"
          style={{ left: `${treeContextMenu.x}px`, top: `${treeContextMenu.y}px` }}
          role="menu"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
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
                className={`studio-context-menu-item ${danger ? "studio-context-menu-item-danger" : ""} ${active ? "studio-intellisense-item-active" : ""}`}
              >
                <span style={{ display: "inline-flex", width: 14, height: 14 }}>{renderTreeContextIcon(item.action)}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
