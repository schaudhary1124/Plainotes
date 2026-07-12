import { commonmark, emphasisSchema, headingSchema, strongSchema } from "@milkdown/kit/preset/commonmark";
import { columnResizingPlugin, gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { codeBlockComponent, codeBlockConfig } from "@milkdown/kit/component/code-block";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { MarkType } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { isInTable } from "@milkdown/kit/prose/tables";
import { codeBlockExtensions, codeBlockLanguages } from "./codeBlock";
import { codeBlockGrips } from "./codeBlockGrips";
import { flashcardPlugins } from "./flashcardNode";
import { imageView } from "./imageView";
import { getListState, type ListState } from "./listCommands";
import { taskListToggle } from "./taskListToggle";
import { tabTrap } from "./tabTrap";
import { tableSchemaExtensionPlugins, tableSidecarRemark } from "./tableSchemaExtensions";
import { tableGrips } from "./tableGrips";
import { highlightSchema, strikethroughSchema, textDecorationPlugins, underlineSchema } from "./textDecorationMarks";

export type BlockStyle = "paragraph" | 1 | 2 | 3;

export interface EditorSelectionState {
  bold: boolean;
  italic: boolean;
  highlight: boolean;
  underline: boolean;
  strikethrough: boolean;
  blockStyle: BlockStyle;
  list: ListState;
  inTable: boolean;
}

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

function getBlockStyle(ctx: Ctx, state: EditorState): BlockStyle {
  const node = state.selection.$from.node();
  if (node.type === headingSchema.type(ctx) && [1, 2, 3].includes(node.attrs.level)) {
    return node.attrs.level as 1 | 2 | 3;
  }
  return "paragraph";
}

export function getSelectionState(ctx: Ctx): EditorSelectionState {
  const state = ctx.get(editorViewCtx).state;
  return {
    bold: isMarkActive(state, strongSchema.type(ctx)),
    italic: isMarkActive(state, emphasisSchema.type(ctx)),
    highlight: isMarkActive(state, highlightSchema.type(ctx)),
    underline: isMarkActive(state, underlineSchema.type(ctx)),
    strikethrough: isMarkActive(state, strikethroughSchema.type(ctx)),
    blockStyle: getBlockStyle(ctx, state),
    list: getListState(ctx),
    inTable: isInTable(state),
  };
}

/** Assembles the full Milkdown plugin set used by the note editor: GFM +
 * commonmark formatting, undo/redo, clipboard/paste handling, the resolved
 * image view, and the custom flashcard/MCQ block. */
export function registerMilkdownPlugins(
  editor: Editor,
  onMarkdownUpdated: (markdown: string) => void,
  onSelectionStateChanged?: (state: EditorSelectionState) => void,
) {
  function reportSelectionState(ctx: Ctx) {
    if (!onSelectionStateChanged) return;
    onSelectionStateChanged(getSelectionState(ctx));
  }

  return editor
    .config((ctx) => {
      ctx
        .get(listenerCtx)
        .markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onMarkdownUpdated(markdown);
        })
        .updated((updatedCtx) => reportSelectionState(updatedCtx))
        // selectionUpdated fires from inside the plugin's state.apply, before
        // view.state has been reassigned to the new state - read on the next
        // microtask so editorViewCtx reflects the transaction that just landed.
        .selectionUpdated((updatedCtx) => queueMicrotask(() => reportSelectionState(updatedCtx)));
      ctx.update(codeBlockConfig.key, (prev) => ({
        ...prev,
        languages: codeBlockLanguages,
        extensions: codeBlockExtensions,
      }));
    })
    // flashcardPlugins registers first: Milkdown's markdown parser tries each
    // registered node's `parseMarkdown.match` in registration order and stops
    // at the first hit, and commonmark's `paragraph` schema matches *every*
    // paragraph unconditionally - so flashcard detection has to run before it.
    .use(flashcardPlugins)
    .use(commonmark)
    .use(gfm)
    // Swaps the plain <pre><code> rendering commonmark's codeBlockSchema
    // gives fenced code blocks for a CodeMirror 6 node view - VSCode-style
    // syntax highlighting, a language picker, and a copy button. Depends on
    // codeBlockSchema, which commonmark just registered above.
    .use(codeBlockComponent)
    // Adds the delete affordance the component above doesn't ship - see
    // codeBlockGrips.ts.
    .use(codeBlockGrips)
    // Registered after gfm so these table extensions (background/height
    // attrs, the markdown sidecar comment) override gfm's own node schemas -
    // Milkdown dedups node schemas by id and the last one `.use()`d wins.
    .use(tableSchemaExtensionPlugins)
    // Must also come after gfm: it needs remarkGFM to have already turned
    // raw pipe tables into mdast `table` nodes before it can attach the
    // sidecar comment's data onto them.
    .use(tableSidecarRemark)
    // Same ordering requirement as tableSidecarRemark: needs commonmark's
    // remarkHtmlTransformer and gfm's own remark plugins to have already run
    // so raw `<mark>`/`<u>` HTML nodes are in their final flat shape.
    .use(textDecorationPlugins)
    .use(columnResizingPlugin)
    .use(tableGrips)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(trailing)
    .use(cursor)
    .use(imageView)
    .use(taskListToggle)
    // Registered last so the list-sink and table-next-cell Tab shortcuts
    // above get first chance at the key - see tabTrap.ts.
    .use(tabTrap);
}
