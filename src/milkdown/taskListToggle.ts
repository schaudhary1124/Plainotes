import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/** GFM's task-list `<li data-item-type="task">` only carries the checked
 * state as a data attribute — the checkbox square is drawn with a CSS
 * `::before` (see index.css), which can't dispatch its own click events.
 * This plugin toggles `checked` when a click lands in that box's area. */
export const taskListToggle = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn(view, _pos, node, nodePos, event) {
          if (node.type.name !== "list_item" || node.attrs.checked == null) return false;
          const target = event.target as HTMLElement;
          const li = target.closest('li[data-item-type="task"]') as HTMLElement | null;
          if (!li) return false;
          const rect = li.getBoundingClientRect();
          if (event.clientX - rect.left > 24) return false;

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          );
          return true;
        },
      },
    }),
);
