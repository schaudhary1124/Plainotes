import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { MarkType } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { SketchPoint, SketchTool } from "../types";

/** Applies `markType` to a plain document range - not tied to the user's
 * current selection, unlike Milkdown's built-in toggle commands. Follows the
 * listCommands.ts/tableCommands.ts pattern: pull the view out of ctx and
 * dispatch a transaction directly. */
export function applyMarkToRange(
  ctx: Ctx,
  from: number,
  to: number,
  markType: MarkType,
  attrs?: Record<string, unknown>,
) {
  const view = ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.addMark(from, to, markType.create(attrs)));
}

/** Removes `markType` from a plain document range - the eraser-parity
 * counterpart to `applyMarkToRange`. */
export function removeMarkFromRange(ctx: Ctx, from: number, to: number, markType: MarkType) {
  const view = ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.removeMark(from, to, markType));
}

export type GestureKind = "highlight" | "underline" | "freeform";

/** Geometry of the text line under a gesture, in the same local (canvas)
 * coordinate space as the gesture's own points - see `resolveLineGeometry`. */
export interface LineGeometry {
  top: number;
  bottom: number;
  /** Does the resolved document range actually contain non-whitespace text? */
  hasText: boolean;
  /** Do the gesture's start and end resolve inside the same block node? */
  sameBlock: boolean;
}

const MIN_DECORATION_WIDTH = 12;
/** Max height-to-width ratio for a stroke to still read as "a line", not a
 * doodle - e.g. a 100px-wide stroke can wander up to 45px tall. Hand/mouse-
 * drawn "straight" lines wobble more than you'd think; these were tuned down
 * twice already after real strokes kept getting rejected as freeform
 * (silently falling through to plain ink) far more often than intended. Now
 * that strikethrough no longer competes for the mid-line zone (see below),
 * underline is the only shape pen gestures classify into, so erring further
 * toward "detect it" costs less in false positives than it used to. */
const MAX_HEIGHT_RATIO = 0.45;
const MAX_HEIGHT_ABSOLUTE = 14;
const MAX_Y_STDDEV = 9;
/** Fraction of points allowed to backtrack in x before a stroke reads as a
 * loop/zigzag rather than a left-to-right line. */
const MAX_BACKTRACK_RATIO = 0.25;

/** Pure geometry classifier: given a gesture's points, which tool drew it,
 * and where the underlying text line sits, decides whether the gesture
 * should become a text decoration mark or fall through to freeform ink.
 * Deliberately DOM-free so it stays unit-testable - callers resolve
 * `LineGeometry` from the editor view first (see `resolveLineGeometry`). */
export function classifyGesture(points: SketchPoint[], tool: SketchTool, line: LineGeometry): GestureKind {
  if (tool === "eraser") return "freeform";
  if (points.length < 2) return "freeform";
  if (!line.hasText || !line.sameBlock) return "freeform";

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < MIN_DECORATION_WIDTH) return "freeform";
  if (height > Math.max(MAX_HEIGHT_ABSOLUTE, width * MAX_HEIGHT_RATIO)) return "freeform";

  let backtrack = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xs[i - 1] - 1) backtrack++;
  }
  if (backtrack > xs.length * MAX_BACKTRACK_RATIO) return "freeform";

  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const variance = ys.reduce((a, y) => a + (y - meanY) ** 2, 0) / ys.length;
  if (Math.sqrt(variance) > MAX_Y_STDDEV) return "freeform";

  if (tool === "highlighter") return "highlight";

  // Strikethrough used to live here too (a pen stroke through the vertical
  // middle of the line), but the mid-line position was too easily confused
  // with a plain doodle/word-underline drawn a bit high - it's a toolbar
  // toggle in normal edit mode instead now (see Editor.tsx). With that band
  // no longer reserved, a pen stroke anywhere from the vertical middle of
  // the line on down reads as an underline - hand-drawn underlines land all
  // over that range depending on how carefully someone's aiming for the
  // baseline.
  const lineHeight = line.bottom - line.top;
  if (lineHeight <= 0) return "freeform";
  const relativeY = (meanY - line.top) / lineHeight;
  if (relativeY > 0.4 && relativeY <= 1.4) return "underline";
  return "freeform";
}

export interface ResolvedGestureRange {
  from: number;
  to: number;
  line: LineGeometry;
}

/** Grows [from, to) outward to the nearest whitespace on either side, so a
 * gesture that lands a couple pixels short of a word's edge (very easy to do
 * hand-drawing an underline) still decorates the whole word instead of
 * clipping a letter or two off one end. Stops at a block boundary (the "\0"
 * separator `textBetween` inserts between block nodes can never match
 * `/\S/`) so it can't run into a neighboring paragraph.
 *
 * Deliberately NOT applied to highlight: underlines are near-universally
 * drawn under whole words (hard to aim precisely at sub-word pixel
 * boundaries by hand, and there's no real use case for underlining half a
 * word), whereas highlighting part of a word - a suffix, a substring inside
 * a long identifier - is common and the highlighter tool is drawn directly
 * over the glyphs (more precise than a line drawn below them), so its raw
 * resolved range is trusted as-is. Applying this to highlight too used to
 * silently expand a deliberate partial-word highlight to the whole word. */
export function expandToWordBoundaries(doc: EditorView["state"]["doc"], from: number, to: number) {
  let start = from;
  while (start > 0 && /\S/.test(doc.textBetween(start - 1, start, "\0"))) start--;
  let end = to;
  const max = doc.content.size;
  while (end < max && /\S/.test(doc.textBetween(end, end + 1, "\0"))) end++;
  return { from: start, to: end };
}

/** Resolves a gesture's local (canvas-relative) points against the live
 * ProseMirror view: the document range its start/end points land on, plus
 * the line geometry `classifyGesture` needs. `originX`/`originY` are the
 * canvas's viewport offset (its wrapper's `getBoundingClientRect()`), used
 * to convert local points to the viewport coordinates `posAtCoords`/
 * `coordsAtPos` expect - and back again, so the returned `line` stays in the
 * same local space as the gesture's own points. Returns null when either
 * endpoint doesn't land inside the document (e.g. drawn in the margin).
 *
 * Underline/strikethrough gestures are drawn AT or BELOW the text they
 * decorate, sometimes close enough to the next line that resolving each
 * endpoint's x/y independently could snap either one onto the wrong line
 * (this bit users in practice: a gesture under the last line of a paragraph
 * would sometimes underline the first line of the next one instead). To
 * avoid that, the line is identified once - from the gesture's topmost point,
 * which sits closest to the actual glyphs - and both the start and end
 * positions are then re-resolved at that SAME clamped y, so a gesture can't
 * straddle two lines even if it was drawn sloppily. */
export function resolveGestureRange(
  view: EditorView,
  points: SketchPoint[],
  originX: number,
  originY: number,
): ResolvedGestureRange | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const topY = Math.min(...points.map((p) => p.y));

  const anchorCoords = view.posAtCoords({ left: originX + first.x, top: originY + topY });
  if (!anchorCoords) return null;
  const anchorRect = view.coordsAtPos(anchorCoords.pos);
  const lineMidY = (anchorRect.top + anchorRect.bottom) / 2;

  const startCoords = view.posAtCoords({ left: originX + first.x, top: lineMidY });
  const endCoords = view.posAtCoords({ left: originX + last.x, top: lineMidY });
  if (!startCoords || !endCoords) return null;

  let from = Math.min(startCoords.pos, endCoords.pos);
  let to = Math.max(startCoords.pos, endCoords.pos);
  if (from === to) return null;

  // Trim leading/trailing whitespace the point-to-position mapping picked up
  // past the intended word boundary, so a gesture that starts/ends a couple
  // pixels short of the glyphs doesn't decorate an extra leading/trailing
  // space along with the intended text.
  const text = view.state.doc.textBetween(from, to, " ");
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  from += leading;
  to -= trailing;
  if (from >= to) return null;

  const $from = view.state.doc.resolve(from);
  const $to = view.state.doc.resolve(to);
  const sameBlock = $from.sameParent($to);
  const hasText = view.state.doc.textBetween(from, to, " ").trim().length > 0;

  return {
    from,
    to,
    line: { top: anchorRect.top - originY, bottom: anchorRect.bottom - originY, hasText, sameBlock },
  };
}
