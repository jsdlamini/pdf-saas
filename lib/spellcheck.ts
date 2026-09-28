// Lazy-loaded spell checking for the CodeMirror editor.
//
// The heavy parts (typo-js + the en_US Hunspell dictionary) are only fetched
// when loadSpellcheckExtension() is called, so they stay out of the initial
// bundle. The dictionary files live in public/dictionaries/en_US/.

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";

const setSpell = StateEffect.define<DecorationSet>();

const spellField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSpell)) deco = effect.value;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Matches LaTeX commands (to skip them) or a plain word.
const TOKEN = /\\[A-Za-z@]+|[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

function scan(
  view: EditorView,
  isCorrect: (word: string) => boolean
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(text))) {
    const token = match[0];
    if (token.length >= 3 && !token.startsWith("\\") && !isCorrect(token)) {
      builder.add(
        match.index,
        match.index + token.length,
        Decoration.mark({ class: "cm-spell-error" })
      );
    }
  }
  return builder.finish();
}

export async function loadSpellcheckExtension(): Promise<Extension> {
  const TypoModule = (await import("typo-js")) as unknown as {
    default: new (name: string, aff: string, dic: string) => {
      check(word: string): boolean;
    };
  };
  const Typo = TypoModule.default;

  const [aff, dic] = await Promise.all([
    fetch("/dictionaries/en_US/en_US.aff").then((r) => r.text()),
    fetch("/dictionaries/en_US/en_US.dic").then((r) => r.text()),
  ]);

  const typo = new Typo("en_US", aff, dic);
  let timer: ReturnType<typeof setTimeout> | null = null;

  return [
    spellField,
    ViewPlugin.fromClass(
      class {
        constructor(view: EditorView) {
          this.run(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.run(update.view);
        }
        run(view: EditorView) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            view.dispatch({
              effects: setSpell.of(scan(view, (word) => typo.check(word))),
            });
          }, 400);
        }
      }
    ),
  ];
}
