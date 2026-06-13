"use client";

import JSZip from "jszip";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";

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
};

type AiFixSuggestion = {
  title: string;
  why: string;
  steps: string[];
  patch?: string;
  files?: string[];
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

const SAVED_PROJECTS_INDEX_KEY = "papertrail-research-projects";
const ACTIVE_PROJECT_KEY = "papertrail-research-active-project";
const PROJECT_DATA_PREFIX = "papertrail-research-project:";

const DEFAULT_LATEX = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}
\usepackage{siunitx}
\usepackage{hyperref}
\title{PaperTrail Research Draft}
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

const DEFAULT_BIB = String.raw`@article{papertrail2026,
  title={PaperTrail Research Patterns},
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

function safeReadJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getProjectStorageKey(projectId: string) {
  return `${PROJECT_DATA_PREFIX}${projectId}`;
}

function loadSavedProjectIndex(): SavedProjectMeta[] {
  if (typeof window === "undefined") return [];
  const parsed = safeReadJson<SavedProjectMeta[]>(window.localStorage.getItem(SAVED_PROJECTS_INDEX_KEY), []);
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (item) => Boolean(item) && typeof item.id === "string" && typeof item.name === "string"
  );
}

function loadSavedProjectData(projectId: string): SavedProjectData | null {
  if (typeof window === "undefined") return null;
  const parsed = safeReadJson<SavedProjectData | null>(
    window.localStorage.getItem(getProjectStorageKey(projectId)),
    null
  );
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.id !== projectId) return null;
  if (!Array.isArray(parsed.entries) || !parsed.entries.length) return null;
  return parsed;
}

function loadInitialResearchStudioState(): InitialResearchStudioState {
  const fallback: InitialResearchStudioState = {
    savedProjects: [],
    activeProjectId: "starter-project",
    projectName: "PaperTrail Research Draft",
    projectEntries: STARTER_PROJECT,
    selectedPath: "main.tex",
    lastCompileAt: "Not compiled yet",
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const savedProjects = loadSavedProjectIndex();
  if (!savedProjects.length) {
    return fallback;
  }

  const rememberedActiveId = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  const activeId =
    rememberedActiveId && savedProjects.some((project) => project.id === rememberedActiveId)
      ? rememberedActiveId
      : savedProjects[0].id;

  const activeProject = loadSavedProjectData(activeId);
  if (!activeProject) {
    return {
      ...fallback,
      savedProjects,
      activeProjectId: activeId,
    };
  }

  return {
    savedProjects,
    activeProjectId: activeId,
    projectName: activeProject.name,
    projectEntries: activeProject.entries,
    selectedPath: activeProject.selectedPath,
    lastCompileAt: activeProject.lastCompileAt || "Not compiled yet",
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

  const [workspaceScreen, setWorkspaceScreen] = useState<"projects" | "editor">("projects");
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>(initialState.savedProjects);
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
  const panesRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);

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

  function closeIntellisense() {
    setIntellisenseOptions([]);
    setIntellisenseIndex(0);
    setIntellisenseStart(null);
    setIntellisensePosition(null);
  }

  function updateIntellisenseFromInput(source: string, cursor: number, textarea?: HTMLTextAreaElement) {
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SAVED_PROJECTS_INDEX_KEY, JSON.stringify(savedProjects));
  }, [savedProjects]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
  }, [activeProjectId]);

  function persistProjectSnapshot(snapshot: SavedProjectData) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(getProjectStorageKey(snapshot.id), JSON.stringify(snapshot));
  }

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

      setSavedProjects((current) => {
        const nextMeta: SavedProjectMeta = {
          id: snapshot.id,
          name: snapshot.name,
          updatedAt: snapshot.updatedAt,
        };

        const withoutCurrent = current.filter((item) => item.id !== snapshot.id);
        return [nextMeta, ...withoutCurrent].slice(0, 20);
      });

      setCompileNotice("Project saved. You can reopen it from Saved Projects.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Project save failed.";
      setCompileNotice(message);
      appendPreviewError(`Save failed: ${message}`);
    }
  }

  function loadSavedProject(projectId: string) {
    const saved = loadSavedProjectData(projectId);
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

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(getProjectStorageKey(projectId));
    }

    setSavedProjects((current) => {
      const nextProjects = current.filter((item) => item.id !== projectId);

      if (projectId === activeProjectId) {
        if (nextProjects.length) {
          const fallback = loadSavedProjectData(nextProjects[0].id);
          if (fallback) {
            setActiveProjectId(fallback.id);
            setProjectName(fallback.name);
            setProjectEntries(fallback.entries);
            setSelectedPath(fallback.selectedPath || "main.tex");
            setLastCompileAt(fallback.lastCompileAt || "Not compiled yet");
          }
        } else {
          setActiveProjectId("starter-project");
          setProjectName("PaperTrail Research Draft");
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

    const snapshot = loadSavedProjectData(projectId);
    if (snapshot) {
      persistProjectSnapshot({
        ...snapshot,
        name: nextName,
        updatedAt,
      });
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
      setCompileBusy(true);
      setCompileNotice("Compiling project on server...");
      setAiFixError("");
      setAiFixSummary("");
      setAiFixSuggestions([]);
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
      const compiledAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLastCompileAt(compiledAt);

      const snapshot = buildCurrentProjectSnapshot({ lastCompileAt: compiledAt });
      persistProjectSnapshot(snapshot);
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
    const insertionPoint = textarea ? textarea.selectionStart : source.length;

    const needsPrefixNewline = insertionPoint > 0 && source[insertionPoint - 1] !== "\n";
    const needsSuffixNewline = insertionPoint < source.length && source[insertionPoint] !== "\n";
    const insertedText = `${needsPrefixNewline ? "\n" : ""}${snippet}${needsSuffixNewline ? "\n" : ""}`;

    const nextText = `${source.slice(0, insertionPoint)}${insertedText}${source.slice(insertionPoint)}`;
    const cursor = insertionPoint + insertedText.length;

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
      <main className="depth-stage mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-8 md:px-10 md:py-10">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Projects</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Research Document Studio
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-700 md:text-base">
                Create, reopen, rename, and delete projects here. Open one to enter the file editor.
              </p>
              </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={createNewProject}
              className="group relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-cyan-300 bg-cyan-50 text-cyan-900 transition hover:bg-cyan-100"
              aria-label="Create new project"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                Create project
              </span>
            </button>
            <p className="text-[11px] text-slate-500">Projects are stored locally in this browser.</p>
          </div>

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
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No saved projects yet. Create one to start editing.
              </div>
            )}
        </section>
      </main>
    );
  }

  return (
    <main className="depth-stage mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-3 py-3 md:px-4 md:py-4">
      <header className="rounded-2xl border border-slate-200 bg-white/90 p-3">
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
          </div>
          </div>
        </div>
      </header>

      <section
        ref={panesRef}
        className="grid grid-cols-1 gap-2 lg:gap-0 lg:[grid-template-columns:var(--left-pane-width)_10px_minmax(0,1fr)_10px_var(--right-pane-width)]"
        style={
          {
            "--left-pane-width": `${effectiveLeftPaneWidth}px`,
            "--right-pane-width": `${effectiveRightPaneWidth}px`,
          } as React.CSSProperties
        }
      >
        <aside
          className={`rounded-xl border border-slate-200 bg-white/90 transition-[padding] ${leftPaneCollapsed ? "cursor-pointer p-1" : "p-2"}`}
          onClick={() => {
            if (leftPaneCollapsed) setLeftPaneCollapsed(false);
          }}
          role={leftPaneCollapsed ? "button" : undefined}
          aria-label={leftPaneCollapsed ? "Expand project files pane" : undefined}
        >
          <div className={`flex items-center gap-2 ${leftPaneCollapsed ? "justify-center" : "justify-between"}`}>
            {!leftPaneCollapsed ? (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Project Files</p>
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
              <div className="mt-2 grid gap-1.5">
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

              <div className="mt-2 flex gap-1">
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
              <ul className="mt-3 space-y-1 text-sm text-slate-700">{renderProjectTree(projectTree)}</ul>
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Section Outline (active file)
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
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
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
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

          <div className="rounded-xl border border-slate-200 bg-white/90 p-2">
            <div className="mb-2 border-b border-slate-200 pb-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Editor</p>
            </div>

            <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{activeEntry?.path || "No file selected"}</p>

          <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
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
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-cyan-300 bg-cyan-50 px-2 text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-60"
                  aria-label={compileBusy ? "Compiling project" : "Compile project"}
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 6l7 4-7 4V6z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Compile</span>
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
            <div className="grid gap-2">
              <div className="flex flex-wrap items-start gap-2">
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
                      onClick={() => insertEditorSnippet({ before: "\\cite{", after: "}", placeholder: "papertrail2026" })}
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
            <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
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

          <div className={`grid gap-2 ${showMatchGutter ? "lg:grid-cols-[140px_minmax(0,1fr)]" : ""}`}>
            {showMatchGutter ? (
              <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Match gutter</p>
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
                disabled={!activeEntry}
                className="latex-editor-input relative z-10 min-h-[68vh] w-full resize-none border-0 bg-transparent p-3 font-mono text-sm leading-6 outline-none ring-cyan-400 focus:ring-2 disabled:opacity-60"
                spellCheck={false}
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
            </div>
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
          className={`rounded-xl border border-slate-200 bg-white/90 transition-[padding] ${rightPaneCollapsed ? "cursor-pointer p-1" : "p-2"}`}
          onClick={() => {
            if (rightPaneCollapsed) setRightPaneCollapsed(false);
          }}
          role={rightPaneCollapsed ? "button" : undefined}
          aria-label={rightPaneCollapsed ? "Expand preview pane" : undefined}
        >
          <div className={`flex items-center gap-2 ${rightPaneCollapsed ? "justify-center" : "justify-between"}`}>
            {!rightPaneCollapsed ? (
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Preview Pane</p>
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
            <div className="mt-3 h-[68vh] rounded-xl border border-slate-200 bg-slate-50 p-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {compileBusy ? "Compiling project..." : compileNotice}
              </p>

              {compileMainLog ? (
                <details className="mb-2 rounded-md border border-slate-300 bg-white p-2">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                    View {compileMainLogFileName}
                  </summary>
                  <div className="mt-2 flex items-center justify-end">
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
                  <pre className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 text-slate-700">
                    {compileMainLog}
                  </pre>
                </details>
              ) : null}

              {compileMainLog ? (
                <div className="mb-2 rounded-md border border-slate-300 bg-white p-2">
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

                  {aiFixSummary ? <p className="mt-2 text-[11px] text-slate-700">{aiFixSummary}</p> : null}
                  {aiFixError ? <p className="mt-2 text-[11px] text-rose-700">{aiFixError}</p> : null}

                  {aiFixSuggestions.length ? (
                    <ul className="mt-2 max-h-52 space-y-2 overflow-auto">
                      {aiFixSuggestions.map((suggestion, index) => (
                        <li key={`${suggestion.title}-${index}`} className="rounded border border-slate-200 bg-slate-50 p-2">
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
                              <div className="mt-2 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => applyAiPatchToActiveFile(suggestion.patch || "")}
                                  disabled={!isValidAiPatchSnippet(suggestion.patch || "") || !activeEntry}
                                  className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-900 transition hover:bg-cyan-100 disabled:opacity-60"
                                >
                                  Apply to active file
                                </button>
                              </div>
                              <pre className="mt-2 max-h-32 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] leading-5 text-slate-700">
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
                <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 p-2">
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
                <div className="flex h-full flex-col gap-2">
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
