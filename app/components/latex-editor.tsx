"use client";

// CodeMirror 6 LaTeX editor. This replaces the textarea + highlight-overlay
// approach in Research Studio with a real editor: proper LaTeX highlighting,
// line numbers, history, bracket matching, and (later) inline lint. The parent
// reaches the underlying EditorView through the imperative handle.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
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
import { tags } from "@lezer/highlight";

export type LatexEditorHandle = {
  view: () => EditorView | null;
};

type LatexEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  extensions?: Extension[];
};

const latexLanguage = StreamLanguage.define(stex);

// Map CodeMirror token tags to the existing studio-hl-* classes so the editor
// keeps the Research Studio's established dark/light palette.
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

const readOnlyCompartment = new Compartment();

export const LatexEditor = forwardRef<LatexEditorHandle, LatexEditorProps>(
  function LatexEditor(
    { value, onChange, readOnly = false, className, extensions = [] },
    ref: Ref<LatexEditorHandle>
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useImperativeHandle(
      ref,
      () => ({ view: () => viewRef.current }),
      []
    );

    useEffect(() => {
      const state = EditorState.create({
        doc: value,
        extensions: [
          latexLanguage,
          syntaxHighlighting(latexHighlight),
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          bracketMatching(),
          indentOnInput(),
          EditorView.lineWrapping,
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          ...extensions,
        ],
      });
      const view = new EditorView({ state, parent: containerRef.current! });
      viewRef.current = view;
      return () => {
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

    return <div ref={containerRef} className={className} />;
  }
);
