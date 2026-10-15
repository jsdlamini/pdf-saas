import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

export type EditorLanguage = "latex" | "python" | "cpp";

export type EditorCompletionContext = {
  bibKeys: string[];
  labels: string[];
  figures: string[];
};

/**
 * Completion source for LaTeX-only completions: `\cite{…}`, `\ref{…}` and
 * `\includegraphics{…}` (and their common variants). Returns null for any
 * other context so that normal language completions (e.g. Python/C++ keywords)
 * still run.
 */
export function latexCompletionSource(
  context: CompletionContext,
  data: EditorCompletionContext | undefined
): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const lineBefore = state.doc.sliceString(line.from, pos);
  const m = /\\(cite|citep|citet|parencite|ref|eqref|includegraphics)\*?\{([^{}\n]*)$/.exec(
    lineBefore
  );
  if (!m) return null;
  const command = m[1];
  const partial = m[2];
  let list: string[] = [];
  if (command === "ref" || command === "eqref") list = data?.labels ?? [];
  else if (command === "includegraphics") list = data?.figures ?? [];
  else if (command === "cite" || command === "citep" || command === "citet" || command === "parencite")
    list = data?.bibKeys ?? [];
  else return null;
  if (!list.length) return null;
  return {
    from: pos - partial.length,
    options: list.map((label) => ({ label, type: "text" })),
    validFor: /^[^\s{},]*$/,
  };
}

export type LatexCompletionOverride = (
  context: CompletionContext
) => CompletionResult | null;

/**
 * Returns the LaTeX completion override only when the active editor language
 * is LaTeX. For Python/C++ it returns null so the editor installs the base
 * `autocompletion()` (which surfaces each language's own keyword completions)
 * and never the LaTeX one.
 */
export function latexAutocompleteOverride(
  language: EditorLanguage,
  getData: () => EditorCompletionContext | undefined
): LatexCompletionOverride | null {
  if (language !== "latex") return null;
  return (context) => latexCompletionSource(context, getData());
}
