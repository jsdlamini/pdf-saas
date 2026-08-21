"use client";

// CodeMirror 6 editor for Research Studio. Supports LaTeX, Python, and C++.
// Replaces the textarea + highlight-overlay approach with a real editor:
// proper highlighting, line numbers, history, bracket matching, and (later)
// inline lint. The parent reaches the EditorView through onViewReady.
import { useEffect, useRef, type Ref } from "react";
import {
  EditorState,
  Compartment,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
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

export type LatexEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  language?: EditorLanguage;
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

// LaTeX: commands cyan, math pink, braces amber, options green.
const latexHighlight = HighlightStyle.define([
  { tag: tags.comment, class: "studio-hl-cmt" },
  { tag: tags.keyword, class: "studio-hl-cmd" },
  { tag: tags.function(tags.variableName), class: "studio-hl-cmd" },
  { tag: tags.string, class: "studio-hl-mth" },
  { tag: tags.atom, class: "studio-hl-mth" },
  { tag: tags.bracket, class: "studio-hl-brc" },
  { tag: tags.brace, class: "studio-hl-brc" },
  { tag: tags.squareBracket, class: "studio-hl-opt" },
  { tag: tags.propertyName, class: "studio-hl-opt" },
  { tag: tags.number, class: "studio-hl-num" },
  { tag: tags.operator, class: "studio-hl-brc" },
  { tag: tags.contentSeparator, class: "studio-hl-brc" },
  { tag: tags.meta, class: "studio-hl-cmd" },
]);

// Python/C++: reuse the existing code token classes.
const codeHighlight = HighlightStyle.define([
  { tag: tags.comment, class: "studio-hl-cmt" },
  { tag: tags.keyword, class: "studio-hl-kw" },
  { tag: tags.string, class: "studio-hl-str" },
  { tag: tags.number, class: "studio-hl-num" },
  { tag: tags.function(tags.variableName), class: "studio-hl-fn" },
  { tag: tags.typeName, class: "studio-hl-kw" },
  { tag: tags.definition(tags.variableName), class: "studio-hl-dec" },
  { tag: tags.operator, class: "studio-hl-brc" },
  { tag: tags.bracket, class: "studio-hl-brc" },
  { tag: tags.paren, class: "studio-hl-brc" },
]);

const readOnlyCompartment = new Compartment();
const languageCompartment = new Compartment();

export function LatexEditor({
  value,
  onChange,
  readOnly = false,
  className,
  language = "latex",
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
    const state = EditorState.create({
      doc: value,
      extensions: [
        languageCompartment.of(languages[language]),
        syntaxHighlighting(language === "latex" ? latexHighlight : codeHighlight),
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

  return <div ref={containerRef} className={className} />;
}
