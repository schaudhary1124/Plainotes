import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $nodeSchema, $view } from "@milkdown/kit/utils";
import { FLASHCARD_PATTERN, MCQ_PATTERN } from "../utils/markdownParser";

type ItemKind = "qa" | "mcq";

interface FlashcardAttrs {
  itemKind: ItemKind;
  question: string;
  answer: string;
  options: string[];
}

/** Milkdown's remarkLineBreak plugin splits every physical line boundary
 * within a paragraph into `text, {type:"break"}, text` (see
 * @milkdown/preset-commonmark's remark-line-break.ts) rather than keeping a
 * literal "\n" in one text node - so a `break` node has to be flattened back
 * into "\n" or multi-line study syntax silently merges into one giant line. */
function flattenText(node: { type: string; value?: string; children?: unknown[] }): string {
  if (node.type === "text" && typeof node.value === "string") return node.value;
  if (node.type === "break") return "\n";
  const children = (node.children ?? []) as { type: string; value?: string; children?: unknown[] }[];
  return children.map(flattenText).join("");
}

function isStudyLine(line: string): boolean {
  return line.length > 0 && (FLASHCARD_PATTERN.test(line) || MCQ_PATTERN.test(line));
}

function splitOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Rebuilds the exact `Q: ... -> A: ...` / `MCQ: ... | a, b | answer` line the
 * node was parsed from, so the file on disk stays identical to what
 * markdownParser.ts / Study mode already understand. */
function serializeFlashcard(attrs: FlashcardAttrs): string {
  if (attrs.itemKind === "mcq") {
    return `MCQ: ${attrs.question} | ${attrs.options.join(", ")} | ${attrs.answer}`;
  }
  return `Q: ${attrs.question} -> A: ${attrs.answer}`;
}

export const flashcardSchema = $nodeSchema("flashcard", () => ({
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: false,
  // No `default` on these attrs is deliberate: ProseMirror's ContentMatch.defaultType
  // (used to auto-fill required content, e.g. when the doc becomes fully empty after
  // select-all-delete) picks the first block-group node type whose attrs are all
  // optional. flashcardSchema is registered before paragraph (see setup.ts) so that
  // its parseMarkdown.match runs first - but that same ordering would make ProseMirror
  // insert an empty flashcard instead of a paragraph on an empty doc, unless flashcard
  // is disqualified via hasRequiredAttrs(). Every call site that creates a flashcard
  // node (parseMarkdown runners below) already supplies all four attrs explicitly.
  attrs: {
    itemKind: {},
    question: {},
    answer: {},
    options: {},
  },
  parseDOM: [
    {
      tag: 'div[data-type="flashcard"]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return false;
        return {
          itemKind: dom.getAttribute("data-kind") === "mcq" ? "mcq" : "qa",
          question: dom.getAttribute("data-question") ?? "",
          answer: dom.getAttribute("data-answer") ?? "",
          options: JSON.parse(dom.getAttribute("data-options") ?? "[]"),
        };
      },
    },
  ],
  toDOM: (node) => {
    const attrs = node.attrs as FlashcardAttrs;
    return [
      "div",
      {
        "data-type": "flashcard",
        "data-kind": attrs.itemKind,
        "data-question": attrs.question,
        "data-answer": attrs.answer,
        "data-options": JSON.stringify(attrs.options),
      },
      serializeFlashcard(attrs),
    ];
  },
  parseMarkdown: {
    // A paragraph without a blank line between two study-syntax lines parses
    // as ONE paragraph with an embedded "\n" (a soft break), not two - so we
    // match/split per physical line, same granularity markdownParser.ts uses.
    match: (node) => {
      if (node.type !== "paragraph") return false;
      const lines = flattenText(node as never).trim().split("\n");
      return lines.length > 0 && lines.every((line) => isStudyLine(line.trim()));
    },
    runner: (state, node, type) => {
      const lines = flattenText(node as never).trim().split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        const mcqMatch = line.match(MCQ_PATTERN);
        if (mcqMatch) {
          const [, question, rawOptions, answer] = mcqMatch;
          state.addNode(type, {
            itemKind: "mcq",
            question: question.trim(),
            answer: answer.trim(),
            options: splitOptions(rawOptions),
          });
          continue;
        }
        const qaMatch = line.match(FLASHCARD_PATTERN);
        if (qaMatch) {
          const [, question, answer] = qaMatch;
          state.addNode(type, {
            itemKind: "qa",
            question: question.trim(),
            answer: answer.trim(),
            options: [],
          });
        }
      }
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "flashcard",
    runner: (state, node) => {
      state.addNode("paragraph", [{ type: "text", value: serializeFlashcard(node.attrs as FlashcardAttrs) }]);
    },
  },
}));

/** Inserts a flashcard node with blank attrs directly via ProseMirror, rather
 * than going through `insert("Q: Question -> A: Answer")` markdown text -
 * that would round-trip fine (the parseMarkdown regexes above accept empty
 * capture groups), but it's simpler to construct the node in one shot than
 * to insert text and wait for the markdown parser to turn it back into a
 * node, and it previously left literal "Question"/"Answer" placeholder text
 * for the user to delete first. */
export function insertFlashcard(ctx: Ctx, itemKind: ItemKind) {
  const view = ctx.get(editorViewCtx);
  const type = flashcardSchema.type(ctx);
  const node = type.create({
    itemKind,
    question: "",
    answer: "",
    options: itemKind === "mcq" ? ["", ""] : [],
  });
  // Where exactly the new node lands (and whether it ends up a NodeSelection
  // vs. a nearby TextSelection) depends on what was selected beforehand - a
  // cursor mid-paragraph forces a block split, and ProseMirror's
  // Selection.near() then picks whatever's nearest, which isn't reliably our
  // node. So instead of trying to relocate it via position/selection after
  // the fact, grab the node view's own instance: `dispatch` synchronously
  // constructs it before returning, so it's the last one set.
  resetLastCreatedNodeView();
  view.dispatch(view.state.tr.replaceSelectionWith(node));
  // The nested question textarea is a plain form control outside
  // contentEditable, so the browser won't put focus inside it on its own -
  // without this the user lands on an inert, unfocused field they can't type
  // into (and some engines don't paint ::placeholder correctly on a textarea
  // that's never been focused).
  getLastCreatedNodeView()?.focusQuestion();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Set by the most recently constructed node view, read once by
 * `insertFlashcard` right after its dispatch to grab a handle on the exact
 * node view it just created - see the comment there for why. */
let lastCreatedNodeView: FlashcardNodeView | null = null;
// Read/write through functions rather than the module variable directly -
// TypeScript can't see that `view.dispatch` mutates `lastCreatedNodeView` (via
// the constructor below) and would otherwise narrow it to `null` for the rest
// of the calling function after a direct `= null` reset.
function resetLastCreatedNodeView() {
  lastCreatedNodeView = null;
}
function getLastCreatedNodeView() {
  return lastCreatedNodeView;
}

class FlashcardNodeView implements NodeView {
  dom: HTMLElement;
  private node: ProseNode;
  private badge!: HTMLSpanElement;
  private questionInput!: HTMLTextAreaElement;
  private optionsList!: HTMLDivElement;
  private answerInput?: HTMLInputElement;

  constructor(
    node: ProseNode,
    private view: import("@milkdown/kit/prose/view").EditorView,
    private getPos: () => number | undefined,
  ) {
    this.node = node;
    this.dom = el("div", "flashcard-node");
    this.build();
    this.sync();
    lastCreatedNodeView = this;
  }

  focusQuestion() {
    this.questionInput.focus();
  }

  private setAttr(patch: Partial<FlashcardAttrs>) {
    const pos = this.getPos();
    if (pos == null) return;
    const attrs = { ...(this.node.attrs as FlashcardAttrs), ...patch };
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, attrs));
  }

  private removeSelf() {
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    this.view.dispatch(tr);
  }

  /** Builds the DOM structure once. `itemKind` never changes on an existing
   * node, so the shape built here (qa vs. mcq) is stable for the node view's
   * lifetime - only `sync()` needs to run on subsequent updates. Recreating
   * inputs on every keystroke (as a full re-render would) destroys the
   * focused element and drops focus/cursor after each character typed. */
  private build() {
    const attrs = this.node.attrs as FlashcardAttrs;
    this.dom.contentEditable = "false";

    const header = el("div", "flashcard-node-header");
    this.badge = el("span", "flashcard-node-badge");
    const remove = el("button", "flashcard-node-remove", "×");
    remove.type = "button";
    remove.title = "Remove";
    remove.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.removeSelf();
    });
    header.append(this.badge, remove);

    this.questionInput = el("textarea", "flashcard-node-question") as HTMLTextAreaElement;
    this.questionInput.rows = 1;
    this.questionInput.placeholder = "Question";
    this.questionInput.addEventListener("input", () => this.setAttr({ question: this.questionInput.value }));

    this.dom.append(header, this.questionInput);

    if (attrs.itemKind === "mcq") {
      this.optionsList = el("div", "flashcard-node-options");
      this.dom.append(this.optionsList);

      const addOption = el("button", "flashcard-node-add", "+ Add option");
      addOption.type = "button";
      addOption.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const current = this.node.attrs as FlashcardAttrs;
        this.setAttr({ options: [...current.options, ""] });
      });
      this.dom.append(addOption);
    } else {
      this.answerInput = el("input", "flashcard-node-answer") as HTMLInputElement;
      this.answerInput.placeholder = "Answer";
      this.answerInput.addEventListener("input", () => this.setAttr({ answer: this.answerInput!.value }));
      this.dom.append(this.answerInput);
    }
  }

  /** Patches existing DOM elements in place instead of recreating them, and
   * only writes `.value` when it actually differs so an in-progress edit's
   * own input element is left untouched (preserving focus/cursor). */
  private sync() {
    const attrs = this.node.attrs as FlashcardAttrs;
    this.badge.textContent = attrs.itemKind === "mcq" ? "Multiple choice" : "Flashcard";
    if (this.questionInput.value !== attrs.question) this.questionInput.value = attrs.question;

    if (attrs.itemKind === "mcq") {
      this.syncOptions(attrs);
    } else if (this.answerInput && this.answerInput.value !== attrs.answer) {
      this.answerInput.value = attrs.answer;
    }
  }

  private syncOptions(attrs: FlashcardAttrs) {
    const rows = Array.from(this.optionsList.children) as HTMLDivElement[];
    while (rows.length > attrs.options.length) {
      rows.pop()!.remove();
    }
    while (rows.length < attrs.options.length) {
      const row = this.createOptionRow();
      this.optionsList.append(row);
      rows.push(row);
    }
    attrs.options.forEach((option, index) => {
      const row = rows[index];
      const radio = row.querySelector('input[type="radio"]') as HTMLInputElement;
      const input = row.querySelector(".flashcard-node-option-input") as HTMLInputElement;
      const checked = option !== "" && option.toLowerCase() === attrs.answer.toLowerCase();
      if (radio.checked !== checked) radio.checked = checked;
      if (input.value !== option) input.value = option;
      input.placeholder = `Option ${index + 1}`;
    });
  }

  /** Row's logical index is looked up dynamically (rather than captured in a
   * closure) because rows are reused positionally across add/remove, so a
   * given DOM row can end up representing a different index over time. */
  private createOptionRow(): HTMLDivElement {
    const row = el("div", "flashcard-node-option-row");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `flashcard-answer-${this.getPos() ?? "x"}`;
    radio.addEventListener("change", () => {
      const attrs = this.node.attrs as FlashcardAttrs;
      const index = Array.from(this.optionsList.children).indexOf(row);
      this.setAttr({ answer: attrs.options[index] });
    });

    const input = el("input", "flashcard-node-option-input") as HTMLInputElement;
    input.addEventListener("input", () => {
      const attrs = this.node.attrs as FlashcardAttrs;
      const index = Array.from(this.optionsList.children).indexOf(row);
      const options = [...attrs.options];
      const wasAnswer = options[index].toLowerCase() === attrs.answer.toLowerCase();
      options[index] = input.value;
      this.setAttr({ options, ...(wasAnswer ? { answer: input.value } : {}) });
    });

    const remove = el("button", "flashcard-node-option-remove", "×");
    remove.type = "button";
    remove.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const attrs = this.node.attrs as FlashcardAttrs;
      const index = Array.from(this.optionsList.children).indexOf(row);
      const options = attrs.options.filter((_, i) => i !== index);
      this.setAttr({ options });
    });

    row.append(radio, input, remove);
    return row;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    if ((node.attrs as FlashcardAttrs).itemKind !== (this.node.attrs as FlashcardAttrs).itemKind) return false;
    this.node = node;
    this.sync();
    return true;
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export const flashcardView = $view(flashcardSchema.node, () => {
  return ((node, view, getPos) => new FlashcardNodeView(node, view, getPos)) as NodeViewConstructor;
});

export const flashcardPlugins = [flashcardSchema, flashcardView].flat();
