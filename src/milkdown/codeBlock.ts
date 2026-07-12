import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history as codeMirrorHistory, historyKeymap, indentWithTab } from "@codemirror/commands";
import { languages as codeMirrorLanguages } from "@codemirror/language-data";
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";

/** All languages CodeMirror ships language-data for (JS/TS, Python, Rust, Go,
 * Java, C/C++, HTML, CSS, JSON, YAML, SQL, shell, etc.) - each one's tokenizer
 * is lazy-loaded on first use, so listing the full set here doesn't cost
 * anything until a note actually picks that language from the code block's
 * language picker. */
export const codeBlockLanguages = codeMirrorLanguages;

/** Editor chrome for note-embedded code blocks: fixed to a VSCode-style dark
 * theme regardless of the app's own light/midnight theme, the way GitHub,
 * Notion, and Obsidian all treat embedded code - syntax highlighting reads
 * consistently no matter what the surrounding note theme is doing. */
export const codeBlockExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  foldGutter({ openText: "⌄", closedText: "›" }),
  indentUnit.of("  "),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  codeMirrorHistory(),
  keymap.of([...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
  oneDark,
  EditorView.theme({
    // Fills whatever height `.milkdown-code-block` currently has (see
    // index.css) - that wrapper is what's actually `resize: both`, so this
    // just needs to track it rather than impose its own fixed size.
    "&": { fontSize: "13px", height: "100%" },
    // Long blocks (e.g. a pasted file) scroll inside the block instead of
    // pushing the rest of the note down indefinitely.
    ".cm-scroller": { lineHeight: "1.5", overflowY: "auto" },
    ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)", padding: "0.85em 0" },
    ".cm-gutters": { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
  }),
];
