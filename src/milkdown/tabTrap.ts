import { listItemSchema } from "@milkdown/kit/preset/commonmark";
import type { ResolvedPos } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Plugin } from "@milkdown/kit/prose/state";
import { isInTable } from "@milkdown/kit/prose/tables";
import { $prose } from "@milkdown/kit/utils";

// Non-breaking spaces so the browser doesn't collapse the run down to a
// single visible space the way it would with plain " " characters.
const INDENT_UNIT = "    ";

/** Returns the range of the indent unit immediately before `$from`, if the
 * cursor sits right after one - so Backspace/Shift-Tab can remove a whole
 * indent level in one step (Google Docs-style) instead of one character at
 * a time. */
function indentBefore(state: EditorState, $from: ResolvedPos) {
  const end = $from.pos;
  const start = Math.max($from.start(), end - INDENT_UNIT.length);
  if (end - start !== INDENT_UNIT.length) return null;
  return state.doc.textBetween(start, end) === INDENT_UNIT ? { start, end } : null;
}

/** Milkdown's list-sink and table-next-cell Tab shortcuts only fire when the
 * selection is inside a list item or table cell. Outside those contexts Tab
 * needs its own handling: falling through unhandled sends it to the
 * browser's default behavior, which shifts focus off the contenteditable
 * entirely instead of indenting anything. This plugin inserts/removes one
 * indent unit at the cursor for plain text (Tab/Shift-Tab, and Backspace
 * right after an indent), and only defers to the list and table shortcuts
 * when the selection is actually inside one of those, so it can't shadow
 * them regardless of plugin registration order. */
export const tabTrap = $prose((ctx) => {
  const itemType = listItemSchema.type(ctx);
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Tab" && event.key !== "Backspace") return false;
        const { state } = view;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === itemType) return false;
        }
        if (isInTable(state)) return false;

        if (event.key === "Backspace") {
          if (!state.selection.empty) return false;
          const range = indentBefore(state, $from);
          if (!range) return false;
          event.preventDefault();
          view.dispatch(state.tr.delete(range.start, range.end));
          return true;
        }

        event.preventDefault();
        const { from, to } = state.selection;
        if (event.shiftKey) {
          const range = indentBefore(state, $from);
          if (range) view.dispatch(state.tr.delete(range.start, range.end));
          return true;
        }
        view.dispatch(state.tr.insertText(INDENT_UNIT, from, to));
        return true;
      },
    },
  });
});
