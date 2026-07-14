import { hardbreakSchema } from "@milkdown/kit/preset/commonmark";
import { isInTable } from "@milkdown/kit/prose/tables";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/** Plain Enter inside a table cell isn't a no-op today - it's bound (by gfm's
 * own tableKeymap, "ExitTable") to jumping the cursor out of the whole table
 * into a new paragraph below it, regardless of which cell the cursor is in.
 * That reads as "nothing happened" to anyone trying to just start a new line
 * of cell content, which every other block-based editor (Notion, Google
 * Docs, ...) allows. This intercepts plain Enter first and inserts a
 * hardbreak instead - the same inline node Shift-Enter inserts elsewhere in
 * the document (see also setup.ts's hardbreakFilterNodes override, without
 * which this would silently no-op inside tables).
 *
 * Deliberately not just `callCommand(insertHardbreakCommand.key)`:  that
 * command has a second branch - pressing Enter again right after an
 * existing trailing hardbreak collapses it into a real paragraph break
 * instead of adding another line. Table cells only ever hold a single
 * paragraph (see tableSchemaExtensions.ts), so there's no valid paragraph
 * break to collapse into there; ProseMirror instead satisfies the schema by
 * splitting the cell/row/table apart, which reproduces the exact "Enter
 * exits the table" bug this plugin exists to fix. Always inserting a plain
 * hardbreak - regardless of what precedes the cursor - keeps repeated Enters
 * inside a cell doing the one sane thing: adding another line.
 *
 * Registered ahead of `.use(gfm)` in setup.ts so this plugin's handleKeyDown
 * runs before tableKeymap's ever sees the event. */
export const tableLineBreak = $prose((ctx) => {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
        if (!isInTable(view.state)) return false;
        const { selection } = view.state;
        if (!(selection instanceof TextSelection)) return false;
        event.preventDefault();
        const tr = view.state.tr
          .setMeta("hardbreak", true)
          .replaceSelectionWith(hardbreakSchema.type(ctx).create())
          .scrollIntoView();
        view.dispatch(tr);
        return true;
      },
    },
  });
});
