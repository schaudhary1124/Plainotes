import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { MarkType } from "@milkdown/kit/prose/model";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $markSchema, $remark } from "@milkdown/kit/utils";

/** Loose shape for the mdast nodes remark hands us - mirrors the same escape
 * hatch already used in tableSchemaExtensions.ts. */
interface MdastNode {
  type: string;
  value?: string;
  color?: string;
  children?: MdastNode[];
  [key: string]: unknown;
}

export const DEFAULT_HIGHLIGHT_COLOR = "#eab308";
/** Default line color for underline/strikethrough when a mark has no color
 * attr (hand-typed markdown, or content pasted without an inline style) -
 * gesture-created marks always pass an explicit color from the sketch
 * toolbar's current color instead of relying on this. */
export const DEFAULT_DECORATION_COLOR = "#1c1c1e";

function colorAttrPattern(tag: string): RegExp {
  return new RegExp(`^<${tag}(?:\\s+data-color="([^"]*)")?\\s*>$`, "i");
}

/** A tag pair we recognize when pairing raw inline HTML nodes back into a
 * structured mdast node (see `pairTagsOnce` below). */
interface TagSpec {
  /** The synthetic mdast node type the pair collapses into. */
  nodeType: string;
  /** Matches the *trimmed* value of an opening `html` mdast node. */
  openPattern: RegExp;
  /** Exact trimmed value of the matching closing `html` mdast node. */
  closeText: string;
  attrsFromMatch: (match: RegExpMatchArray) => Record<string, unknown>;
}

const TAG_SPECS: TagSpec[] = [
  {
    nodeType: "highlightMark",
    openPattern: colorAttrPattern("mark"),
    closeText: "</mark>",
    attrsFromMatch: (match) => ({ color: match[1] || DEFAULT_HIGHLIGHT_COLOR }),
  },
  {
    nodeType: "underlineMark",
    openPattern: colorAttrPattern("u"),
    closeText: "</u>",
    attrsFromMatch: (match) => ({ color: match[1] || DEFAULT_DECORATION_COLOR }),
  },
  {
    nodeType: "strikethroughMark",
    openPattern: colorAttrPattern("s"),
    closeText: "</s>",
    attrsFromMatch: (match) => ({ color: match[1] || DEFAULT_DECORATION_COLOR }),
  },
];

/** Scans one `children` array for the first complete open/close pair from
 * `TAG_SPECS` and collapses it into a single nested node in place. Handles
 * same-tag nesting via a depth counter (defensive - our own gestures never
 * produce nested same-type marks, but hand-typed markdown could). Returns
 * true if it made a change, so the caller can restart the scan (indices
 * shift after a splice). */
function pairTagsOnce(children: MdastNode[]): boolean {
  for (const spec of TAG_SPECS) {
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.type !== "html" || typeof node.value !== "string") continue;
      const match = spec.openPattern.exec(node.value.trim());
      if (!match) continue;

      let depth = 1;
      let closeIndex = -1;
      for (let j = i + 1; j < children.length; j++) {
        const sibling = children[j];
        if (sibling.type !== "html" || typeof sibling.value !== "string") continue;
        const value = sibling.value.trim();
        if (spec.openPattern.test(value)) depth++;
        else if (value === spec.closeText && --depth === 0) {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex === -1) continue;

      const wrapped: MdastNode = {
        type: spec.nodeType,
        ...spec.attrsFromMatch(match),
        children: children.slice(i + 1, closeIndex),
      };
      children.splice(i, closeIndex - i + 1, wrapped);
      return true;
    }
  }
  return false;
}

/** Recursively pairs raw inline HTML tags into structured mark nodes,
 * everywhere phrasing content can appear (paragraphs, headings, table
 * cells, list items, ...). */
function pairTags(children: MdastNode[] | undefined) {
  if (!children) return;
  while (pairTagsOnce(children)) {
    /* keep collapsing pairs at this level */
  }
  for (const child of children) pairTags(child.children);
}

interface ToMarkdownTracker {
  move: (value: string) => string;
  current: () => Record<string, unknown>;
}
interface ToMarkdownState {
  enter: (name: string) => () => void;
  createTracker: (info: unknown) => ToMarkdownTracker;
  containerPhrasing: (node: unknown, info: Record<string, unknown>) => string;
}

/** Renders a paired mark node (`{type: "highlightMark" | "underlineMark" |
 * "strikethroughMark", color, children}`) back into its literal
 * `<tag data-color="...">...</tag>` markdown text. Mirrors the shape of
 * mdast-util-gfm-strikethrough's `handleDelete`. */
function makeTagHandler(tag: string) {
  const closeTag = `</${tag}>`;
  return (node: MdastNode, _parent: unknown, state: ToMarkdownState, info: unknown) => {
    const tracker = state.createTracker(info);
    const exit = state.enter(node.type);
    let value = tracker.move(`<${tag} data-color="${node.color}">`);
    value += state.containerPhrasing(node, { ...tracker.current(), before: value, after: closeTag });
    value += tracker.move(closeTag);
    exit();
    return value;
  };
}

interface RemarkProcessorLike {
  data(key: "toMarkdownExtensions"): unknown[] | undefined;
  data(key: "toMarkdownExtensions", value: unknown[]): void;
}

/** Registers the mdast <-> markdown-text bridge for the highlight/underline/
 * strikethrough marks: a tree transform (parse direction) that collapses raw
 * inline HTML tag pairs into structured nodes, plus a `mdast-util-to-markdown`
 * handler extension (stringify direction) that renders those nodes back to
 * literal HTML text - same two-sided registration `remark-gfm` uses for its
 * own `delete` node, just hand-rolled instead of pulling in a package for
 * three tags. Must run after `.use(gfm)`/commonmark's html transformer so
 * raw HTML nodes are in their final flat shape by the time this walks the
 * tree (see tableSidecarRemark for the same ordering requirement). */
export const textDecorationRemark = $remark("plainotesTextDecorations", () => {
  return function attachTextDecorations(this: RemarkProcessorLike) {
    const extensions = this.data("toMarkdownExtensions") ?? [];
    this.data("toMarkdownExtensions", [
      ...extensions,
      {
        handlers: {
          highlightMark: makeTagHandler("mark"),
          underlineMark: makeTagHandler("u"),
          strikethroughMark: makeTagHandler("s"),
        },
      },
    ]);

    return (tree: unknown) => {
      pairTags((tree as MdastNode).children);
    };
  };
});

export const highlightSchema = $markSchema("highlight", () => ({
  attrs: { color: { default: DEFAULT_HIGHLIGHT_COLOR } },
  parseDOM: [
    {
      tag: "mark",
      getAttrs: (dom) => ({
        color: (dom instanceof HTMLElement && dom.dataset.color) || DEFAULT_HIGHLIGHT_COLOR,
      }),
    },
  ],
  toDOM: (mark) => ["mark", { "data-color": mark.attrs.color as string }, 0],
  parseMarkdown: {
    match: (node) => node.type === "highlightMark",
    runner: (state, node, markType) => {
      const mdastNode = node as MdastNode;
      state.openMark(markType, { color: mdastNode.color ?? DEFAULT_HIGHLIGHT_COLOR });
      state.next(mdastNode.children ?? []);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      state.withMark(mark, "highlightMark", undefined, { color: mark.attrs.color });
    },
  },
}));

/** Matches SketchToolbar's thinnest pen width (SKETCH_TOOL_SIZES.pen[0]) so
 * a gesture-created underline/strikethrough reads with the same visual
 * weight as the ink it replaced, instead of the browser's default hairline
 * text-decoration. */
const MIN_LINE_THICKNESS_PX = 3;

/** Shared shape for underline/strikethrough: both are a single-colored line
 * drawn via `text-decoration-color`/`text-decoration-thickness`, tinting the
 * line without recoloring the text itself (matching how highlight only
 * tints the background). */
function lineMarkSchema(id: "underline" | "strikethrough", tag: "u" | "s", nodeType: string) {
  return $markSchema(id, () => ({
    attrs: { color: { default: DEFAULT_DECORATION_COLOR } },
    parseDOM: [
      {
        tag,
        getAttrs: (dom) => ({
          color: (dom instanceof HTMLElement && dom.style.textDecorationColor) || DEFAULT_DECORATION_COLOR,
        }),
      },
    ],
    toDOM: (mark) => [
      tag,
      {
        style: `text-decoration-color: ${mark.attrs.color as string}; text-decoration-thickness: ${MIN_LINE_THICKNESS_PX}px;`,
      },
      0,
    ],
    parseMarkdown: {
      match: (node) => node.type === nodeType,
      runner: (state, node, markType) => {
        const mdastNode = node as MdastNode;
        state.openMark(markType, { color: mdastNode.color ?? DEFAULT_DECORATION_COLOR });
        state.next(mdastNode.children ?? []);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, nodeType, undefined, { color: mark.attrs.color });
      },
    },
  }));
}

export const underlineSchema = lineMarkSchema("underline", "u", "underlineMark");
export const strikethroughSchema = lineMarkSchema("strikethrough", "s", "strikethroughMark");

export const textDecorationPlugins = [textDecorationRemark, highlightSchema, underlineSchema, strikethroughSchema].flat();

/** Toggles a text decoration mark over the current selection - the normal
 * edit-mode toolbar's equivalent of the sketch gesture classifier, for
 * highlight/underline/strikethrough alike. Plain `toggleMark` (same command
 * `toggleStrongCommand`/`toggleEmphasisCommand` wrap for bold/italic): if the
 * mark is already active anywhere in the selection it's removed, otherwise
 * it's added with `attrs`. No-ops on a collapsed selection, same as the
 * built-in bold/italic toolbar buttons. */
export function toggleTextDecoration(ctx: Ctx, markType: MarkType, attrs?: Record<string, unknown>) {
  const view = ctx.get(editorViewCtx);
  toggleMark(markType, attrs)(view.state, view.dispatch);
}
