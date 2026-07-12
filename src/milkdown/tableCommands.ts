import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { callCommand } from "@milkdown/kit/utils";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  setCellAttr,
} from "@milkdown/kit/prose/tables";

/** `row` includes the header row, e.g. row=3 col=2 makes a 1-header + 2-body-row,
 * 2-column table - matching what the grid picker's "3 x 2" preview shows. */
export function insertTable(ctx: Ctx, row: number, col: number) {
  callCommand(insertTableCommand.key, { row, col })(ctx);
}

export function isCursorInTable(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx);
  return isInTable(view.state);
}

export function addTableRow(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  addRowAfter(view.state, view.dispatch);
}

export function addTableColumn(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  addColumnAfter(view.state, view.dispatch);
}

export function deleteTableRow(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  deleteRow(view.state, view.dispatch);
}

export function deleteTableColumn(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  deleteColumn(view.state, view.dispatch);
}

export function deleteCurrentTable(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  deleteTable(view.state, view.dispatch);
  view.focus();
}

/** Fills the selected cell(s) with `color`, or clears the fill when `color`
 * is null. Works against a single cursor-in-cell as well as a CellSelection
 * spanning a whole row/column/range, so one call handles both cases. */
export function setTableCellBackground(ctx: Ctx, color: string | null) {
  const view = ctx.get(editorViewCtx);
  setCellAttr("background", color)(view.state, view.dispatch);
  view.focus();
}
