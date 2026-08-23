"use client";

// CodeMirror 6 editor for Research Studio. Supports LaTeX, Python, and C++,
// selectable color themes, and find-match highlighting. The parent reaches the
// EditorView through onViewReady.
import { useEffect, useRef, type Ref } from "react";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { python } from "@codemirror/legacy-modes/mode/python";
import { cpp } from "@codemirror/legacy-modes/mode/clike";
import { tags } from "@lezer/highlight";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";

export type EditorLanguage = "latex" | "python" | "cpp";

export type EditorFindRange = { from: number; to: number };

export type LatexEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  language?: EditorLanguage;
  theme?: EditorThemeId;
  highlightRanges?: EditorFindRange[];
  extensions?: Extension[];
  onViewReady?: (view: EditorView | null) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onSelectionChange?: (cursor: number) => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
};

const languages: Record<EditorLanguage, Extension> = {
  latex: StreamLanguage.define(stex),
  python: StreamLanguage.define(python),
  cpp: StreamLanguage.define(cpp),
};

// ── Selectable color themes (VSCode-style) ────────────────────────────────
type ThemeColors = {
  background: string;
  foreground: string;
  caret: string;
  selection: string;
  gutterBackground: string;
  gutterForeground: string;
  activeLine: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  func: string;
  type: string;
  operator: string;
  bracket: string;
  property: string;
  atom: string;
  meta: string;
};

function buildTheme(c: ThemeColors): Extension {
  return [
    EditorView.theme({
      "&": { backgroundColor: c.background, color: c.foreground, height: "100%" },
      ".cm-content": { caretColor: c.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: c.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: c.selection },
      ".cm-gutters": {
        backgroundColor: c.gutterBackground,
        color: c.gutterForeground,
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: c.activeLine },
      ".cm-activeLineGutter": { backgroundColor: c.activeLine },
      ".cm-matchingBracket": { backgroundColor: c.selection, outline: `1px solid ${c.bracket}` },
      ".cm-nonmatchingBracket": { outline: "1px solid rgba(239, 68, 68, 0.7)" },
    }),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.comment, color: c.comment },
        { tag: tags.keyword, color: c.keyword },
        { tag: tags.string, color: c.string },
        { tag: tags.number, color: c.number },
        { tag: tags.function(tags.variableName), color: c.func },
        { tag: tags.typeName, color: c.type },
        { tag: tags.definition(tags.variableName), color: c.func },
        { tag: tags.operator, color: c.operator },
        { tag: tags.bracket, color: c.bracket },
        { tag: tags.brace, color: c.bracket },
        { tag: tags.squareBracket, color: c.bracket },
        { tag: tags.paren, color: c.bracket },
        { tag: tags.propertyName, color: c.property },
        { tag: tags.atom, color: c.atom },
        { tag: tags.meta, color: c.meta },
        { tag: tags.contentSeparator, color: c.bracket },
      ])
    ),
  ];
}

export type EditorThemeId = "dark" | "light" | "one-dark" | "monokai" | "solarized-dark" | "nord" | "dracula" | "github";

export const EDITOR_THEMES: Record<
  EditorThemeId,
  { label: string; dark: boolean; extension: Extension }
> = {
  dark: {
    label: "Dark",
    dark: true,
    extension: buildTheme({
      background: "#0d0f17", foreground: "#e2e8f0", caret: "#4ade80",
      selection: "rgba(74,222,128,0.22)", gutterBackground: "#131620",
      gutterForeground: "#64748b", activeLine: "rgba(255,255,255,0.03)",
      comment: "#64748b", keyword: "#67e8f9", string: "#f472b6",
      number: "#b5cea8", func: "#67e8f9", type: "#67e8f9",
      operator: "#fbbf24", bracket: "#fbbf24", property: "#4ade80",
      atom: "#f472b6", meta: "#67e8f9",
    }),
  },
  light: {
    label: "Light",
    dark: false,
    extension: buildTheme({
      background: "#ffffff", foreground: "#1a1a1a", caret: "#0f766e",
      selection: "rgba(15,118,110,0.18)", gutterBackground: "#f1f5f9",
      gutterForeground: "#64748b", activeLine: "rgba(0,0,0,0.03)",
      comment: "#6a9955", keyword: "#0000ff", string: "#a31515",
      number: "#098658", func: "#795e26", type: "#267f99",
      operator: "#000000", bracket: "#000000", property: "#0451a5",
      atom: "#a31515", meta: "#008080",
    }),
  },
  "one-dark": {
    label: "One Dark",
    dark: true,
    extension: buildTheme({
      background: "#282c34", foreground: "#abb2bf", caret: "#528bff",
      selection: "rgba(96,175,255,0.3)", gutterBackground: "#21252b",
      gutterForeground: "#636d83", activeLine: "rgba(255,255,255,0.05)",
      comment: "#7f848e", keyword: "#c678dd", string: "#98c379",
      number: "#d19a66", func: "#61afef", type: "#e5c07b",
      operator: "#56b6c2", bracket: "#abb2bf", property: "#e06c75",
      atom: "#56b6c2", meta: "#e5c07b",
    }),
  },
  monokai: {
    label: "Monokai",
    dark: true,
    extension: buildTheme({
      background: "#272822", foreground: "#f8f8f2", caret: "#f8f8f0",
      selection: "rgba(73,72,62,0.9)", gutterBackground: "#1e1f1c",
      gutterForeground: "#75715e", activeLine: "rgba(255,255,255,0.05)",
      comment: "#75715e", keyword: "#f92672", string: "#e6db74",
      number: "#ae81ff", func: "#a6e22e", type: "#66d9ef",
      operator: "#f92672", bracket: "#f8f8f2", property: "#66d9ef",
      atom: "#ae81ff", meta: "#fd971f",
    }),
  },
  "solarized-dark": {
    label: "Solarized Dark",
    dark: true,
    extension: buildTheme({
      background: "#002b36", foreground: "#839496", caret: "#268bd2",
      selection: "rgba(38,139,210,0.3)", gutterBackground: "#073642",
      gutterForeground: "#586e75", activeLine: "rgba(255,255,255,0.02)",
      comment: "#586e75", keyword: "#859900", string: "#2aa198",
      number: "#d33682", func: "#268bd2", type: "#b58900",
      operator: "#839496", bracket: "#93a1a1", property: "#2aa198",
      atom: "#6c71c4", meta: "#b58900",
    }),
  },
  nord: {
    label: "Nord",
    dark: true,
    extension: buildTheme({
      background: "#2e3440", foreground: "#d8dee9", caret: "#88c0d0",
      selection: "rgba(136,192,208,0.25)", gutterBackground: "#272c36",
      gutterForeground: "#4c566a", activeLine: "rgba(255,255,255,0.03)",
      comment: "#616e88", keyword: "#81a1c1", string: "#a3be8c",
      number: "#b48ead", func: "#88c0d0", type: "#8fbcbb",
      operator: "#81a1c1", bracket: "#d8dee9", property: "#d08770",
      atom: "#b48ead", meta: "#ebcb8b",
    }),
  },
  dracula: {
    label: "Dracula",
    dark: true,
    extension: buildTheme({
      background: "#282a36", foreground: "#f8f8f2", caret: "#f8f8f2",
      selection: "rgba(68,71,90,0.9)", gutterBackground: "#21222c",
      gutterForeground: "#6272a4", activeLine: "rgba(255,255,255,0.05)",
      comment: "#6272a4", keyword: "#ff79c6", string: "#f1fa8c",
      number: "#bd93f9", func: "#50fa7b", type: "#8be9fd",
      operator: "#ff79c6", bracket: "#f8f8f2", property: "#8be9fd",
      atom: "#bd93f9", meta: "#ffb86c",
    }),
  },
  github: {
    label: "GitHub Light",
    dark: false,
    extension: buildTheme({
      background: "#ffffff", foreground: "#24292f", caret: "#0969da",
      selection: "rgba(9,105,218,0.15)", gutterBackground: "#f6f8fa",
      gutterForeground: "#57606a", activeLine: "rgba(0,0,0,0.03)",
      comment: "#6e7781", keyword: "#cf222e", string: "#0a3069",
      number: "#0550ae", func: "#8250df", type: "#953800",
      operator: "#24292f", bracket: "#24292f", property: "#0550ae",
      atom: "#0a3069", meta: "#116329",
    }),
  },
};

// ── Find-match highlighting (all occurrences in the current file) ──────────
const setFindHighlights = StateEffect.define<EditorFindRange[]>();
const findHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindHighlights)) {
        deco = Decoration.set(
          effect.value.map((r) =>
            Decoration.mark({ class: "cm-find-match" }).range(r.from, r.to)
          )
        );
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const readOnlyCompartment = new Compartment();
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();

export function LatexEditor({
  value,
  onChange,
  readOnly = false,
  className,
  language = "latex",
  theme = "dark",
  highlightRanges = [],
  extensions = [],
  onViewReady,
  onKeyDown,
  onMouseMove,
  onSelectionChange,
  onDragOver,
  onDrop,
}: LatexEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  const onMouseMoveRef = useRef(onMouseMove);
  onMouseMoveRef.current = onMouseMove;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onDragOverRef = useRef(onDragOver);
  onDragOverRef.current = onDragOver;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    const themeExtension =
      EDITOR_THEMES[theme]?.extension ?? EDITOR_THEMES.dark.extension;
    const state = EditorState.create({
      doc: value,
      extensions: [
        languageCompartment.of(languages[language]),
        themeCompartment.of(themeExtension),
        findHighlightField,
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        // VSCode-style multi-cursor: Ctrl/Cmd+D selects the next occurrence,
        // Ctrl/Cmd+Shift+L selects all matches.
        keymap.of([
          { key: "Mod-d", run: selectNextOccurrence },
          { key: "Mod-Shift-l", run: selectSelectionMatches },
        ]),
        bracketMatching(),
        indentOnInput(),
        EditorView.lineWrapping,
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            onSelectionChangeRef.current?.(update.state.selection.main.head);
          }
        }),
        EditorView.domEventHandlers({
          keydown: (event) => {
            onKeyDownRef.current?.(event);
            return event.defaultPrevented;
          },
          mousemove: (event) => {
            onMouseMoveRef.current?.(event);
            return false;
          },
          dragover: (event) => {
            onDragOverRef.current?.(event);
            return false;
          },
          drop: (event) => {
            onDropRef.current?.(event);
            return false;
          },
        }),
        ...extensions,
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current! });
    viewRef.current = view;
    onViewReadyRef.current?.(view);
    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (file switch, collaboration pull, AI edit).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Toggle read-only without recreating the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(
        EditorState.readOnly.of(readOnly)
      ),
    });
  }, [readOnly]);

  // Swap language (LaTeX ↔ Python ↔ C++).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(languages[language]),
    });
  }, [language]);

  // Swap color theme.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const themeExtension =
      EDITOR_THEMES[theme]?.extension ?? EDITOR_THEMES.dark.extension;
    view.dispatch({
      effects: themeCompartment.reconfigure(themeExtension),
    });
  }, [theme]);

  // Update find-match highlights.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setFindHighlights.of(highlightRanges) });
  }, [highlightRanges]);

  return <div ref={containerRef} className={className} />;
}
