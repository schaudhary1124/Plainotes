import { Plugin } from "@milkdown/kit/prose/state";
import type { PluginView } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** Walks up from a position inside a code block's CodeMirror content to the
 * `code_block` node itself, the way tableGrips.ts's resolveRowInfo walks up
 * from a cell to its row. */
function resolveCodeBlockInfo(view: EditorView, blockDom: HTMLElement): { pos: number; node: Node } | null {
  let domPos: number;
  try {
    domPos = view.posAtDOM(blockDom, 0);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(domPos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "code_block") {
      const pos = depth === 0 ? 0 : $pos.before(depth);
      return { pos, node };
    }
  }
  return null;
}

/** Deletes the whole code block. The built-in CodeMirror node view only ever
 * lets Backspace merge a single-line block back into a paragraph (see
 * @milkdown/components' node-view.ts) - there's otherwise no way to remove a
 * code block, especially a multi-line one, since its `stopEvent()` swallows
 * every keyboard event before ProseMirror's own node-selection delete
 * shortcuts ever see it. If this is the document's only block, it's replaced
 * with an empty paragraph instead of deleted outright, since `doc` requires
 * at least one child. */
function deleteCodeBlock(view: EditorView, blockDom: HTMLElement) {
  const info = resolveCodeBlockInfo(view, blockDom);
  if (!info) return;
  const { pos, node } = info;
  const { state } = view;
  const tr =
    state.doc.childCount === 1
      ? state.tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph!.createChecked({}))
      : state.tr.delete(pos, pos + node.nodeSize);
  view.dispatch(tr);
  view.focus();
}

/** Per-editor overlay: one delete button per code block, floated in place of
 * the tools bar's Copy button (hidden via CSS - see index.css). Lives in the
 * Milkdown mount div (a sibling of `editorView.dom`, not a child of it)
 * rather than actually replacing the Copy button in the DOM, because that
 * button belongs to the vendored `codeBlockComponent`'s own Vue tree, which
 * would just re-render over any node inserted into it directly - same
 * reasoning as TableOverlay in tableGrips.ts. */
class CodeBlockGripsView implements PluginView {
  private view: EditorView;
  private host: HTMLElement | null = null;
  private buttons = new Map<HTMLElement, HTMLButtonElement>();
  private resizeObserver = new ResizeObserver(() => this.repositionAll());
  // The tools bar this positions against doesn't exist yet at mount time -
  // CodeMirror (and the Vue-rendered `.tools` bar inside it) only
  // initializes once the block scrolls into view (see node-view.ts's
  // IntersectionObserver), asynchronously and after this view's first
  // repositionAll() call. A block's own outer size never changes when that
  // happens (its height is fixed by CSS), so ResizeObserver never fires for
  // it - this instead watches the block's subtree directly for that mount.
  private mutationObserver = new MutationObserver(() => this.repositionAll());

  constructor(view: EditorView) {
    this.view = view;
    this.sync();
  }

  update(view: EditorView, prevState: EditorView["state"]) {
    this.view = view;
    if (view.state.doc !== prevState.doc) this.sync();
    else this.repositionAll();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.buttons.forEach((btn) => btn.remove());
    this.buttons.clear();
  }

  private sync() {
    const host = this.view.dom.parentElement;
    if (!host) return;
    if (host !== this.host) {
      this.host = host;
      if (!host.style.position) host.style.position = "relative";
    }

    const current = new Set(Array.from(this.view.dom.querySelectorAll(".milkdown-code-block")) as HTMLElement[]);
    for (const [block, btn] of this.buttons) {
      if (!current.has(block)) {
        btn.remove();
        this.resizeObserver.unobserve(block);
        this.buttons.delete(block);
      }
    }
    current.forEach((block) => {
      if (this.buttons.has(block)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-block-delete-btn";
      btn.title = "Remove";
      btn.setAttribute("aria-label", "Remove code block");
      btn.textContent = "×";
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => deleteCodeBlock(this.view, block));
      host.append(btn);
      this.buttons.set(block, btn);
      this.resizeObserver.observe(block);
      this.mutationObserver.observe(block, { childList: true, subtree: true });
    });

    this.repositionAll();
  }

  private repositionAll() {
    if (!this.host) return;
    const hostRect = this.host.getBoundingClientRect();
    this.buttons.forEach((btn, block) => {
      // Anchor to the tools bar itself (not the block) so the button lands
      // exactly in the Copy button's old slot regardless of the tools bar's
      // padding/height, which are set in CSS rather than known here.
      const toolsRect = (block.querySelector(".tools") ?? block).getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      btn.style.top = `${toolsRect.top - hostRect.top + (toolsRect.height - btnRect.height) / 2}px`;
      btn.style.left = `${toolsRect.right - hostRect.left - btnRect.width - 10}px`;
    });
  }
}

export const codeBlockGrips = $prose(() => new Plugin({ view: (view) => new CodeBlockGripsView(view) }));
