import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import {
  latexAutocompleteOverride,
  latexCompletionSource,
  type EditorCompletionContext,
} from "./latex-completion";

function completionContext(doc: string, pos = doc.length): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, true);
}

const data: EditorCompletionContext = {
  bibKeys: ["einstein1905", "dirac1928"],
  labels: ["sec:intro", "eq:mass"],
  figures: ["figures/plot.png", "figures/diagram.pdf"],
};

describe("latexCompletionSource", () => {
  it("returns bib keys for \\cite{", () => {
    const result = latexCompletionSource(completionContext("\\cite{ei"), data);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(["einstein1905", "dirac1928"]);
    expect(result!.from).toBe(6);
  });

  it("returns bib keys for \\citep{, \\citet{, and \\parencite{", () => {
    for (const cmd of ["citep", "citet", "parencite"]) {
      const result = latexCompletionSource(completionContext(`\\${cmd}{ei`), data);
      expect(result).not.toBeNull();
      expect(result!.options.map((o) => o.label)).toEqual(["einstein1905", "dirac1928"]);
    }
  });

  it("returns labels for \\ref{ and \\eqref{", () => {
    for (const cmd of ["ref", "eqref"]) {
      const result = latexCompletionSource(completionContext(`\\${cmd}{sec:`), data);
      expect(result).not.toBeNull();
      expect(result!.options.map((o) => o.label)).toEqual(["sec:intro", "eq:mass"]);
    }
  });

  it("returns figures for \\includegraphics{", () => {
    const result = latexCompletionSource(completionContext("\\includegraphics{fig"), data);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(["figures/plot.png", "figures/diagram.pdf"]);
  });

  it("returns null when there is no LaTeX command context (e.g. a lone backslash or \\n in code)", () => {
    expect(latexCompletionSource(completionContext("\\"), data)).toBeNull();
    expect(latexCompletionSource(completionContext('print("hello\\n")'), data)).toBeNull();
    expect(latexCompletionSource(completionContext("const x = 1;"), data)).toBeNull();
  });

  it("returns null when completion data is missing or empty", () => {
    expect(latexCompletionSource(completionContext("\\cite{ei"), undefined)).toBeNull();
    expect(
      latexCompletionSource(completionContext("\\cite{ei"), { bibKeys: [], labels: [], figures: [] })
    ).toBeNull();
  });
});

describe("latexAutocompleteOverride", () => {
  it("is disabled for Python and C++", () => {
    expect(latexAutocompleteOverride("python", () => data)).toBeNull();
    expect(latexAutocompleteOverride("cpp", () => data)).toBeNull();
  });

  it("is enabled for LaTeX and still matches LaTeX commands", () => {
    const override = latexAutocompleteOverride("latex", () => data);
    expect(override).not.toBeNull();
    const result = override!(completionContext("\\cite{ei"));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(["einstein1905", "dirac1928"]);
  });

  it("does not leak LaTeX completions into non-LaTeX contexts", () => {
    const pythonOverride = latexAutocompleteOverride("python", () => data);
    expect(pythonOverride).toBeNull();
  });
});
