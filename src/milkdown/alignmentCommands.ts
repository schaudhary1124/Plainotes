import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/kit/prose/model";
import type { BlockAlign } from "./alignmentSchemaExtensions";

const ALIGNABLE_BLOCK_TYPES = new Set(["paragraph", "heading"]);
const TABLE_CELL_TYPES = new Set(["table_cell", "table_header"]);

/** Sets text alignment on every paragraph/heading the selection touches, the
 * way Google Docs/Notion apply it to a whole selected range at once. Skips
 * any of those blocks that live inside a table cell: cell content can't
 * carry its own `<!--plainotes-align:...-->` sidecar comment (a pipe-table
 * cell's markdown is inline-only - see tableSchemaExtensions.ts) without
 * corrupting the row it lives in. Table cells use column alignment instead -
 * see setTableColumnAlign below. */
export function setBlockAlign(ctx: Ctx, align: BlockAlign) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { from, to } = state.selection;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!ALIGNABLE_BLOCK_TYPES.has(node.type.name)) return true;
    if (parent && TABLE_CELL_TYPES.has(parent.type.name)) return false;
    if (node.attrs.align !== align) tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
    return false;
  });
  if (tr.docChanged) view.dispatch(tr);
}

export function getBlockAlign(ctx: Ctx): BlockAlign {
  const view = ctx.get(editorViewCtx);
  const node = view.state.selection.$from.parent;
  if (ALIGNABLE_BLOCK_TYPES.has(node.type.name)) return (node.attrs.align as BlockAlign | undefined) ?? "left";
  return "left";
}

function childIndex(node: ProseNode, parent: ProseNode): number {
  let index = 0;
  parent.forEach((child, _offset, i) => {
    if (child === node) index = i;
  });
  return index;
}

function findCellDepth($from: ResolvedPos): number | null {
  for (let d = $from.depth; d > 0; d--) {
    if (TABLE_CELL_TYPES.has($from.node(d).type.name)) return d;
  }
  return null;
}

/** GFM table alignment is per-column, defined by the header cell - Milkdown's
 * own keepTableAlignPlugin (bundled with the `gfm` preset) overwrites any
 * body cell's `alignment` attr back to match its column's header cell on the
 * very next transaction. Setting the attr on whatever cell the cursor
 * happens to be in would therefore just silently revert a moment later, so
 * this resolves the header cell for that column instead and sets it there,
 * letting keepTableAlignPlugin cascade the change down to the rest of the
 * column on its own. */
export function setTableColumnAlign(ctx: Ctx, align: BlockAlign) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from } = state.selection;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null || cellDepth < 3) return;

  const cell = $from.node(cellDepth);
  const row = $from.node(cellDepth - 1);
  const table = $from.node(cellDepth - 2);
  const colIndex = childIndex(cell, row);
  const headerRow = table.firstChild;
  const headerCell = headerRow?.maybeChild(colIndex);
  if (!headerCell || headerCell.attrs.alignment === align) return;

  let pos = $from.before(cellDepth - 2) + 2;
  for (let i = 0; i < colIndex; i++) pos += headerRow!.child(i).nodeSize;

  view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...headerCell.attrs, alignment: align }));
}

export function getTableCellAlign(ctx: Ctx): BlockAlign {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  const cellDepth = findCellDepth($from);
  if (cellDepth == null) return "left";
  return ($from.node(cellDepth).attrs.alignment as BlockAlign | undefined) ?? "left";
}
