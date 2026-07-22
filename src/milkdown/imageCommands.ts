import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { findSelectedNodeOfType } from "@milkdown/kit/prose";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { IMAGE_CROP_TOGGLE_EVENT } from "./imageView";
import type { ImageWrap } from "./imageSchemaExtensions";

/** Only meaningful while the image itself is the current NodeSelection (the
 * user clicked directly on it) - `atom: true` in the base schema means
 * there's no way to have a text cursor "inside" an image, so this is the
 * only selection shape that can target one. */
export function setSelectedImageWrap(ctx: Ctx, wrap: ImageWrap) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const found = findSelectedNodeOfType(state.selection, imageSchema.type(ctx));
  if (!found || found.node.attrs.wrap === wrap) return;
  const tr = state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, wrap });
  // setNodeMarkup replaces the node outright (a structural step), so the
  // default selection mapping can't tell it apart from a delete-and-insert
  // at the same spot and drops the NodeSelection for a nearby TextSelection -
  // re-pin it explicitly so the image (and the floating wrap/crop popover
  // anchored to it in Editor.tsx) stays selected across a wrap-mode change.
  tr.setSelection(NodeSelection.create(tr.doc, found.pos));
  view.dispatch(tr);
}

/** Null when the selection isn't an image, so the toolbar can tell "no image
 * selected" apart from "image selected, wrap is inline" (the default). */
export function getSelectedImageWrap(ctx: Ctx): ImageWrap | null {
  const view = ctx.get(editorViewCtx);
  const found = findSelectedNodeOfType(view.state.selection, imageSchema.type(ctx));
  if (!found) return null;
  return (found.node.attrs.wrap as ImageWrap | undefined) ?? "inline";
}

/** Crop-mode-active is transient UI state owned by the selected image's
 * NodeView, not a node attr - so unlike the wrap setter above, this can't
 * dispatch a transaction directly. It broadcasts on the view's DOM instead;
 * the NodeView (see imageView.ts) is what actually gates this to the
 * currently-selected image and flips its own crop mode. */
export function toggleSelectedImageCrop(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  if (!findSelectedNodeOfType(view.state.selection, imageSchema.type(ctx))) return;
  view.dom.dispatchEvent(new CustomEvent(IMAGE_CROP_TOGGLE_EVENT));
}
