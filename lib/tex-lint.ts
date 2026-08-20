// LaTeX compiler-log → CodeMirror lint diagnostics. The Research Studio already
// compiles server-side (/api/latex-compile) and offers fixes
// (/api/latex-fix-suggestions); this turns the log into inline gutter markers.
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

export type TexLogIssue = {
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
};

function nextLineNumber(lines: string[], from: number) {
  for (let j = from + 1; j < Math.min(from + 4, lines.length); j += 1) {
    const match = lines[j].match(/^l\.(\d+)\s*(.*)$/);
    if (match) {
      const column = (match[2] || "").search(/\S/);
      return { line: Number(match[1]), column: column >= 0 ? column : 0 };
    }
  }
  return { line: 1, column: 0 };
}

// LaTeX errors start with "!" and are followed by an "l.<line> <source>" line.
// Warnings are lines such as "LaTeX Warning:", "Package ... Warning:", and
// "Overfull/Underfull \hbox".
export function texLogDiagnostics(log: string): TexLogIssue[] {
  const issues: TexLogIssue[] = [];
  const lines = log.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.startsWith("!")) {
      const location = nextLineNumber(lines, i);
      issues.push({
        line: location.line,
        column: location.column,
        severity: "error",
        message: raw.slice(1).trim(),
      });
    } else if (/^(?:LaTeX Warning|Package \w+ Warning|Overfull|Underfull)/.test(raw)) {
      const location = nextLineNumber(lines, i);
      issues.push({
        line: location.line,
        column: location.column,
        severity: "warning",
        message: raw.trim(),
      });
    }
  }

  return issues;
}

// Builds a CodeMirror linter source from a compiled log string. Wire it into a
// linter() compartment and reconfigure after each compile to get inline errors.
export function texLinter(log: string): (view: EditorView) => Diagnostic[] {
  const issues = texLogDiagnostics(log);
  return (view: EditorView): Diagnostic[] => {
    const doc = view.state.doc;
    return issues.map((issue) => {
      const line = doc.line(Math.min(Math.max(1, issue.line), doc.lines));
      const from = Math.min(line.to, line.from + issue.column);
      return {
        from,
        to: from,
        severity: issue.severity,
        message: issue.message,
      };
    });
  };
}
