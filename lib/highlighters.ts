export type EditorMode = "latex" | "python" | "cpp";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function highlightLatexSource(source: string) {
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

export function highlightPythonSource(source: string) {
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

export function highlightCppSource(source: string) {
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

export function highlightCodeSource(source: string, mode: EditorMode): string {
  if (mode === "python") return highlightPythonSource(source);
  if (mode === "cpp") return highlightCppSource(source);
  return highlightLatexSource(source);
}

