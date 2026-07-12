import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

/** Strips every mark (bold, italic, highlight, underline, strikethrough, ...)
 * from the current selection - the toolbar's "Clear formatting" action.
 * No-ops on a collapsed selection, same as most editors' equivalent command:
 * there's no range to clear, and clearing `storedMarks` instead would be a
 * surprising side effect for a click that looks like it did nothing. */
export function clearFormatting(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { from, to, empty } = view.state.selection;
  if (empty) return;
  view.dispatch(view.state.tr.removeMark(from, to));
}
