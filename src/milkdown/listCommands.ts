import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { bulletListSchema, listItemSchema, orderedListSchema } from "@milkdown/kit/preset/commonmark";
import type { NodeType, ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";

/** Walks up from `$from` and returns the depth of the nearest ancestor list
 * node of the given type, or null if `$from` isn't inside one. */
function findListDepth($from: ResolvedPos, listType: NodeType): number | null {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listType) return d;
  }
  return null;
}

type ListKind = "bullet" | "ordered" | "task";

/** Classifies a single list_item node the way the toolbar does: `checked`
 * set (even to `false`) means it reads as a checklist item regardless of
 * which list type it's physically nested in. */
function classifyListItem(node: { attrs: { checked?: boolean | null } }, parentType: NodeType, orderedType: NodeType): ListKind {
  if (node.attrs.checked != null) return "task";
  return parentType === orderedType ? "ordered" : "bullet";
}

/** Returns the list kind the *entire* selection is uniformly formatted as,
 * or null if the selection isn't wholly inside one list, or mixes kinds
 * (e.g. a checklist item selected together with a plain bullet item). Used
 * to decide whether a toolbar click should strip formatting (already
 * uniform) or (re)apply it (not uniform / no list at all). */
function getUniformListKind(view: EditorView, itemType: NodeType, orderedType: NodeType): ListKind | null {
  const { $from, $to } = view.state.selection;
  const range = $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === itemType);
  if (!range) return null;

  let kind: ListKind | null = null;
  for (let i = range.startIndex; i < range.endIndex; i++) {
    const itemKind = classifyListItem(range.parent.child(i), range.parent.type, orderedType);
    if (kind == null) kind = itemKind;
    else if (kind !== itemKind) return null;
  }
  return kind;
}

/** Repeatedly lifts list items out of the selection until none remain in
 * range, so a selection spanning several list items (or nested sub-lists)
 * ends up fully back at plain paragraphs in one toolbar click. */
function liftAllFromSelection(view: EditorView, itemType: NodeType) {
  for (let guard = 0; guard < 50 && liftListItem(itemType)(view.state, view.dispatch); guard++);
}

/** Toggles the selection in/out of a list format, the way Google Docs/Notion
 * do: if the whole selection is already uniformly `kind` -> lift back to
 * plain paragraphs; otherwise -> clear any existing list formatting in the
 * selection and (re)wrap it as `kind`. Operating on the full selection (not
 * just its anchor) means selecting several items of mixed formats and
 * clicking one target format normalizes all of them to it. */
function applyListFormat(ctx: Ctx, kind: ListKind) {
  const view = ctx.get(editorViewCtx);
  const itemType = listItemSchema.type(ctx);
  const bulletType = bulletListSchema.type(ctx);
  const orderedType = orderedListSchema.type(ctx);

  if (getUniformListKind(view, itemType, orderedType) === kind) {
    liftAllFromSelection(view, itemType);
    return;
  }

  liftAllFromSelection(view, itemType);
  wrapInList(kind === "ordered" ? orderedType : bulletType)(view.state, view.dispatch);

  if (kind === "task") {
    const { $from, $to } = view.state.selection;
    const tr = view.state.tr;
    view.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type === itemType) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
    });
    if (tr.docChanged) view.dispatch(tr);
  }
}

export function toggleBulletList(ctx: Ctx) {
  applyListFormat(ctx, "bullet");
}

export function toggleOrderedList(ctx: Ctx) {
  applyListFormat(ctx, "ordered");
}

/** Markdown headings can't nest inside a list item, so applying a heading
 * style from inside a list would otherwise silently no-op. Lift out first,
 * matching how Notion turns a list item into a heading (exits the list). */
export function liftOutOfList(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const itemType = listItemSchema.type(ctx);
  if (findListDepth(view.state.selection.$from, itemType) != null) {
    liftListItem(itemType)(view.state, view.dispatch);
  }
}

/** Toggles the selection into/out of a checklist. Unlike the old
 * implementation (which inserted the literal text "- [ ] "), this sets the
 * real `checked` attr GFM's task-list schema renders as a clickable box. */
export function toggleTaskItem(ctx: Ctx) {
  applyListFormat(ctx, "task");
}

export type ListState = ListKind | null;

export function getListState(ctx: Ctx): ListState {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  const itemType = listItemSchema.type(ctx);
  const itemDepth = findListDepth($from, itemType);
  if (itemDepth != null) {
    const pos = $from.before(itemDepth);
    const node = view.state.doc.nodeAt(pos);
    if (node?.attrs.checked != null) return "task";
  }
  if (findListDepth($from, bulletListSchema.type(ctx)) != null) return "bullet";
  if (findListDepth($from, orderedListSchema.type(ctx)) != null) return "ordered";
  return null;
}
