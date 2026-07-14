import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  ChevronDown,
  Code,
  HelpCircle,
  Highlighter,
  ImagePlus,
  Italic,
  Layers,
  List,
  ListChecks,
  ListOrdered,
  Minus as DividerIcon,
  RemoveFormatting,
  Strikethrough,
  Table2,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  Underline,
} from "lucide-react";
import { Editor as MilkdownEditor, defaultValueCtx, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { callCommand } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { readSketch, writeAttachment, writeSketch } from "../utils/fsNotes";
import type { BlockStyle, EditorSelectionState } from "../milkdown/setup";
import { getSelectionState, registerMilkdownPlugins } from "../milkdown/setup";
import { setBlockAlign, setTableColumnAlign } from "../milkdown/alignmentCommands";
import type { BlockAlign } from "../milkdown/alignmentSchemaExtensions";
import { liftOutOfList, toggleBulletList, toggleOrderedList, toggleTaskItem } from "../milkdown/listCommands";
import {
  addTableColumn,
  addTableRow,
  deleteCurrentTable,
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  setTableCellBackground,
} from "../milkdown/tableCommands";
import {
  DEFAULT_DECORATION_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  highlightSchema,
  strikethroughSchema,
  toggleTextDecoration,
  underlineSchema,
} from "../milkdown/textDecorationMarks";
import {
  applyMarkToRange,
  classifyGesture,
  expandToWordBoundaries,
  resolveGestureRange,
} from "../milkdown/sketchDecorations";
import { clearFormatting } from "../milkdown/formatCommands";
import { insertFlashcard } from "../milkdown/flashcardNode";
import { SketchLayer } from "./SketchLayer";
import { DEFAULT_SKETCH_COLOR, SKETCH_TOOL_SIZES, SketchToolbar } from "./SketchToolbar";
import type { SketchStroke, SketchTool } from "../types";

type SaveStatus = "idle" | "pending" | "saving" | "saved";

interface EditorProps {
  notePath: string;
  initialContent: string;
  onChange: (content: string) => void;
  onSave: (content: string) => Promise<void>;
  toolbarVisible: boolean;
  sketchMode: boolean;
}

const AUTOSAVE_DELAY_MS = 1000;

const CELL_COLORS: { label: string; value: string }[] = [
  { label: "Red", value: "rgba(248, 113, 113, 0.35)" },
  { label: "Orange", value: "rgba(251, 146, 60, 0.35)" },
  { label: "Yellow", value: "rgba(250, 204, 21, 0.35)" },
  { label: "Green", value: "rgba(74, 222, 128, 0.3)" },
  { label: "Blue", value: "rgba(96, 165, 250, 0.3)" },
  { label: "Purple", value: "rgba(192, 132, 252, 0.3)" },
  { label: "Gray", value: "rgba(148, 163, 184, 0.3)" },
];

const ALIGN_OPTIONS: { align: BlockAlign; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { align: "left", label: "Align left", icon: TextAlignStart },
  { align: "center", label: "Align center", icon: TextAlignCenter },
  { align: "right", label: "Align right", icon: TextAlignEnd },
];

const TEXT_STYLES: { style: BlockStyle; label: string; className: string }[] = [
  { style: "paragraph", label: "Normal text", className: "text-sm" },
  { style: 3, label: "Subheading", className: "text-base font-semibold" },
  { style: 2, label: "Heading", className: "text-lg font-bold" },
  { style: 1, label: "Title", className: "text-xl font-bold" },
];

/** Closes a popover when the user clicks anywhere outside all of `refs`. */
function useClickOutside(refs: React.RefObject<HTMLElement | null>[], onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [refs, onOutside, active]);
}

/** Toolbar popovers can't be plain `absolute` children of the toolbar: the
 * toolbar scrolls horizontally (`overflow-x-auto`), and per the CSS overflow
 * spec setting only one axis to `auto` forces the other to `auto` too - so
 * the toolbar clips anything positioned below its own height, leaving the
 * popover in the DOM (clickable via coordinates) but invisible. Portaling to
 * `document.body` with `position: fixed` escapes that clipping box. */
function ToolbarPopover({
  anchorRef,
  onClose,
  className,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden" });

  useEffect(() => {
    function place() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setStyle({ position: "fixed", top: rect.bottom + 4, left: rect.left, zIndex: 50 });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useClickOutside([anchorRef, menuRef], onClose, true);

  return createPortal(
    <div ref={menuRef} style={style} className={className}>
      {children}
    </div>,
    document.body,
  );
}

function TextStyleDropdown({
  blockStyle,
  onSelect,
}: {
  blockStyle: BlockStyle;
  onSelect: (style: BlockStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const current = TEXT_STYLES.find((s) => s.style === blockStyle) ?? TEXT_STYLES[0];

  return (
    <div className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Text style"
        aria-label="Text style"
        aria-expanded={open}
        className="btn-ghost hover:bg-surface-hover flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs"
      >
        <Type size={13} />
        <span className="max-w-20 truncate">{current.label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <ToolbarPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          className="glass-panel shadow-app-lg border-subtle w-40 overflow-hidden rounded-lg border py-1"
        >
          {TEXT_STYLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                onSelect(s.style);
                setOpen(false);
              }}
              className={`hover:bg-surface-hover flex w-full items-center px-3 py-1.5 text-left ${s.className} ${
                s.style === blockStyle ? "text-accent bg-accent-soft" : "text-primary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </ToolbarPopover>
      )}
    </div>
  );
}

type ToolbarAction = {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  action: () => void;
  isActive?: boolean;
};

/** Combines related actions (e.g. Bold/Italic) into a single button: clicking
 * it runs the currently-active (or last-picked) action, and hovering reveals
 * the full set so the user can switch to a different one. */
function ToolbarButtonGroup({ items }: { items: ToolbarAction[] }) {
  const [open, setOpen] = useState(false);
  const [lastIndex, setLastIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeIndex = items.findIndex((item) => item.isActive);
  const current = items[activeIndex >= 0 ? activeIndex : lastIndex];

  const openNow = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const closeSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div ref={anchorRef} className="relative flex shrink-0" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        onClick={() => {
          setLastIndex(items.indexOf(current));
          current.action();
        }}
        title={current.label}
        aria-label={current.label}
        aria-pressed={activeIndex >= 0}
        className={`btn-ghost relative h-7 w-7 shrink-0 ${activeIndex >= 0 ? "bg-accent-soft text-accent" : ""}`}
      >
        <current.icon size={14} />
        <ChevronDown size={8} className="absolute bottom-0 right-0 opacity-50" />
      </button>
      {open && (
        <ToolbarPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          className="glass-panel shadow-app-lg border-subtle inline-flex overflow-hidden rounded-lg border p-1"
        >
          <div className="flex items-center gap-0.5" onMouseEnter={openNow} onMouseLeave={closeSoon}>
            {items.map((item, idx) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setLastIndex(idx);
                  item.action();
                  setOpen(false);
                }}
                title={item.label}
                aria-label={item.label}
                aria-pressed={item.isActive}
                className={`btn-ghost h-7 w-7 shrink-0 ${item.isActive ? "bg-accent-soft text-accent" : ""}`}
              >
                <item.icon size={14} />
              </button>
            ))}
          </div>
        </ToolbarPopover>
      )}
    </div>
  );
}

function TableMenu({
  inTable,
  cellAlign,
  onInsert,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onDeleteColumn,
  onDeleteTable,
  onSetCellColor,
  onSetCellAlign,
}: {
  inTable: boolean;
  cellAlign: BlockAlign;
  onInsert: (row: number, col: number) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDeleteRow: () => void;
  onDeleteColumn: () => void;
  onDeleteTable: () => void;
  onSetCellColor: (color: string | null) => void;
  onSetCellAlign: (align: BlockAlign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ row: 3, col: 3 });
  const anchorRef = useRef<HTMLButtonElement>(null);
  const GRID = 6;

  return (
    <div className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Table"
        aria-label="Table"
        aria-expanded={open}
        aria-pressed={inTable}
        className={`btn-ghost h-7 w-7 shrink-0 ${inTable ? "bg-accent-soft text-accent" : ""}`}
      >
        <Table2 size={14} />
      </button>
      {open && !inTable && (
        <ToolbarPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          className="glass-panel shadow-app-lg border-subtle rounded-lg border p-2.5"
        >
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${GRID}, 16px)` }}
            onMouseLeave={() => setHover({ row: 3, col: 3 })}
          >
            {Array.from({ length: GRID * GRID }).map((_, i) => {
              const row = Math.floor(i / GRID) + 1;
              const col = (i % GRID) + 1;
              const active = row <= hover.row && col <= hover.col;
              return (
                <button
                  key={i}
                  type="button"
                  onMouseEnter={() => setHover({ row, col })}
                  onClick={() => {
                    onInsert(row, col);
                    setOpen(false);
                  }}
                  className={`h-4 w-4 rounded-sm border ${
                    active ? "bg-accent-solid border-accent-soft" : "border-subtle-strong"
                  }`}
                />
              );
            })}
          </div>
          <div className="text-tertiary mt-1.5 text-center text-xs">
            {hover.row} × {hover.col}
          </div>
        </ToolbarPopover>
      )}
      {open && inTable && (
        <ToolbarPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          className="glass-panel shadow-app-lg border-subtle w-44 overflow-hidden rounded-lg border py-1 text-sm"
        >
          <button
            type="button"
            className="hover:bg-surface-hover text-primary w-full px-3 py-1.5 text-left"
            onClick={() => {
              onAddRow();
              setOpen(false);
            }}
          >
            Insert row below
          </button>
          <button
            type="button"
            className="hover:bg-surface-hover text-primary w-full px-3 py-1.5 text-left"
            onClick={() => {
              onAddColumn();
              setOpen(false);
            }}
          >
            Insert column right
          </button>
          <button
            type="button"
            className="hover:bg-surface-hover text-primary w-full px-3 py-1.5 text-left"
            onClick={() => {
              onDeleteRow();
              setOpen(false);
            }}
          >
            Delete row
          </button>
          <button
            type="button"
            className="hover:bg-surface-hover text-primary w-full px-3 py-1.5 text-left"
            onClick={() => {
              onDeleteColumn();
              setOpen(false);
            }}
          >
            Delete column
          </button>
          <div className="border-subtle my-1 border-t" />
          <div className="text-tertiary px-3 pb-1 pt-0.5 text-xs">Column align</div>
          <div className="flex items-center gap-1 px-3 pb-1.5">
            {ALIGN_OPTIONS.map(({ align, label, icon: Icon }) => (
              <button
                key={align}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={cellAlign === align}
                className={`btn-ghost h-6 w-6 shrink-0 ${cellAlign === align ? "bg-accent-soft text-accent" : ""}`}
                onClick={() => onSetCellAlign(align)}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
          <div className="border-subtle my-1 border-t" />
          <div className="text-tertiary px-3 pb-1 pt-0.5 text-xs">Fill color</div>
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
            {CELL_COLORS.map((color) => (
              <button
                key={color.label}
                type="button"
                title={color.label}
                aria-label={color.label}
                className="border-subtle-strong h-5 w-5 shrink-0 rounded-full border"
                style={{ background: color.value }}
                onClick={() => {
                  onSetCellColor(color.value);
                  setOpen(false);
                }}
              />
            ))}
            <button
              type="button"
              title="Clear color"
              aria-label="Clear color"
              className="border-subtle-strong text-tertiary hover:text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs"
              onClick={() => {
                onSetCellColor(null);
                setOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="border-subtle my-1 border-t" />
          <button
            type="button"
            className="hover:bg-danger-soft text-danger flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
            onClick={() => {
              onDeleteTable();
              setOpen(false);
            }}
          >
            <Trash2 size={13} />
            Delete table
          </button>
        </ToolbarPopover>
      )}
    </div>
  );
}

function NoteEditor({
  notePath,
  initialContent,
  onChange,
  onSave,
  toolbarVisible,
  sketchMode,
}: EditorProps) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectionState, setSelectionState] = useState<EditorSelectionState>({
    bold: false,
    italic: false,
    highlight: false,
    underline: false,
    strikethrough: false,
    blockStyle: "paragraph",
    list: null,
    inTable: false,
    align: "left",
    cellAlign: "left",
  });
  const latestContentRef = useRef(initialContent);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debouncedSave = useDebouncedCallback(async (value: string) => {
    setStatus("saving");
    await onSave(value);
    if (latestContentRef.current === value) {
      setStatus("saved");
    }
  }, AUTOSAVE_DELAY_MS);

  function handleChange(value: string) {
    latestContentRef.current = value;
    onChange(value);
    setStatus("pending");
    debouncedSave(value);
  }

  const { get } = useEditor((root) => {
    const editor = MilkdownEditor.make();
    editor.config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, initialContent);
    });
    registerMilkdownPlugins(editor, handleChange, setSelectionState);
    return editor;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(
    (action: (ctx: Ctx) => unknown) => {
      get()?.action(action);
    },
    [get],
  );

  // --- Sketch mode: ink layer state -----------------------------------
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [sketchTool, setSketchTool] = useState<SketchTool>("pen");
  const [sketchColor, setSketchColor] = useState(DEFAULT_SKETCH_COLOR);
  const [sketchSizeIndex, setSketchSizeIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // A stroke either becomes freeform ink (undo/redo by snapshotting `strokes`)
  // or gets classified into a text decoration mark (undo/redo by delegating
  // to ProseMirror's own history, since that's what actually applied the
  // change - see handleAddStroke). The sketch toolbar's undo button needs to
  // reverse either kind of action in the order they happened, so both share
  // one stack tagged by which mechanism undoes them. Note this only tracks
  // actions taken while sketch mode is on - a text edit made in between two
  // sketch actions (only possible by leaving and re-entering sketch mode,
  // since editing is disabled while it's active) isn't in this stack, and
  // undoing a "mark" entry after one would undo that edit instead via
  // ProseMirror's history. Accepted as a narrow edge case.
  type SketchAction = { kind: "ink"; strokes: SketchStroke[] } | { kind: "mark" };
  const undoStackRef = useRef<SketchAction[]>([]);
  const redoStackRef = useRef<SketchAction[]>([]);
  // Guards against the async sketch load clobbering ink the user has
  // already drawn in the (rare) case they start drawing before it resolves.
  const hasUserEditedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await readSketch(notePath);
      if (cancelled || hasUserEditedRef.current) return;
      setStrokes(data?.strokes ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // notePath is stable for the lifetime of this component (Editor is
    // remounted per-note via a `key` prop in App), so this only runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedSaveSketch = useDebouncedCallback((next: SketchStroke[]) => {
    writeSketch(notePath, { version: 1, strokes: next });
  }, AUTOSAVE_DELAY_MS);

  function commitStrokes(next: SketchStroke[]) {
    hasUserEditedRef.current = true;
    undoStackRef.current.push({ kind: "ink", strokes });
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setStrokes(next);
    debouncedSaveSketch(next);
  }

  const sketchWidth = SKETCH_TOOL_SIZES[sketchTool][sketchSizeIndex];

  // The canvas (SketchLayer) is an `absolute inset-0` child of this same
  // wrapper, so its rect shares the exact origin this ref measures - no
  // separate ref/imperative handle into SketchLayer needed.
  const sketchWrapperRef = useRef<HTMLDivElement>(null);

  // Tier A (see textDecorationMarks.ts/sketchDecorations.ts): a gesture that
  // geometrically reads as a highlight/underline over real text becomes a
  // real ProseMirror mark instead of raster ink, so it reflows with the text
  // forever. Anything that doesn't pass the geometry check - or that misses
  // the classifier's `wrapperRect`/`resolveGestureRange` preconditions -
  // falls through unchanged to today's freeform ink. Strikethrough isn't a
  // gesture here (mid-line pen strokes were too easily confused with plain
  // ink) - it's a normal edit-mode toolbar toggle instead, alongside manual
  // highlight/underline toggles for text that isn't sketched over at all.
  function handleAddStroke(stroke: SketchStroke) {
    const wrapperRect = sketchWrapperRef.current?.getBoundingClientRect();
    if (wrapperRect) {
      let handledAsDecoration = false;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const resolved = resolveGestureRange(view, stroke.points, wrapperRect.left, wrapperRect.top);
        if (!resolved) return;
        const kind = classifyGesture(stroke.points, stroke.tool, resolved.line);
        if (kind === "freeform") return;

        // Word-boundary snapping only makes sense for underline - see
        // expandToWordBoundaries's doc comment for why highlight keeps the
        // raw resolved range (partial-word highlights are intentional).
        const { from, to } =
          kind === "underline" ? expandToWordBoundaries(view.state.doc, resolved.from, resolved.to) : resolved;
        const markType = kind === "highlight" ? highlightSchema.type(ctx) : underlineSchema.type(ctx);
        applyMarkToRange(ctx, from, to, markType, { color: stroke.color });
        handledAsDecoration = true;
      });
      if (handledAsDecoration) {
        undoStackRef.current.push({ kind: "mark" });
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        return;
      }
    }
    commitStrokes([...strokes, stroke]);
  }

  function handleEraseStrokes(ids: string[]) {
    const idSet = new Set(ids);
    commitStrokes(strokes.filter((s) => !idSet.has(s.id)));
  }

  function handleClearSketch() {
    commitStrokes([]);
  }

  function handleUndo() {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    if (entry.kind === "ink") {
      redoStackRef.current.push({ kind: "ink", strokes });
      setStrokes(entry.strokes);
      debouncedSaveSketch(entry.strokes);
    } else {
      redoStackRef.current.push({ kind: "mark" });
      run((ctx) => callCommand(undoCommand.key)(ctx));
    }
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }

  function handleRedo() {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    if (entry.kind === "ink") {
      undoStackRef.current.push({ kind: "ink", strokes });
      setStrokes(entry.strokes);
      debouncedSaveSketch(entry.strokes);
    } else {
      undoStackRef.current.push({ kind: "mark" });
      run((ctx) => callCommand(redoCommand.key)(ctx));
    }
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }

  // Freeze text editing while sketch mode is active - the ink canvas already
  // sits above the editor and captures pointer events, this is defense in
  // depth so keyboard input can't sneak through while drawing. `editable`
  // only blocks *editing* though, not native text selection - a stray
  // click-drag (e.g. starting on the toolbar and dragging in, or landing in
  // the note's own padding just outside the canvas) could still leave a
  // native selection behind that sketch mode's own pointer handling has no
  // way to clear, since `window.getSelection()` is independent of it. The
  // `select-none` class below stops new ones; this clears anything already
  // selected the moment sketch mode turns on.
  useEffect(() => {
    run((ctx) => {
      ctx.get(editorViewCtx).setProps({ editable: () => !sketchMode });
    });
    if (sketchMode) window.getSelection()?.removeAllRanges();
  }, [sketchMode, run]);

  // Most toolbar actions dispatch a transaction directly against the editor
  // view rather than through Milkdown's command layer, which doesn't fire the
  // listener plugin's update hooks - so selectionState has to be refreshed
  // manually right after, the same way the old runMarkCommand did for marks.
  const runAndSync = useCallback(
    (action: (ctx: Ctx) => unknown, focus = true) => {
      run((ctx) => {
        action(ctx);
        setSelectionState(getSelectionState(ctx));
        if (focus) ctx.get(editorViewCtx).focus();
      });
    },
    [run],
  );

  // Clicking below/around the last line should focus the editor and place the
  // cursor at the nearest valid position, the way Google Docs does, instead of
  // requiring a precise click directly on a line of text.
  const focusNearestPosition = useCallback(
    (clientX: number, clientY: number) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const rect = view.dom.getBoundingClientRect();
        if (rect.height === 0) return;
        const x = Math.min(Math.max(clientX, rect.left + 1), rect.right - 1);
        const y = Math.min(Math.max(clientY, rect.top + 1), rect.bottom - 1);
        const coords = view.posAtCoords({ left: x, top: y });
        const pos = coords ? coords.pos : view.state.doc.content.size;
        const selection = TextSelection.near(view.state.doc.resolve(pos), -1);
        view.dispatch(view.state.tr.setSelection(selection));
        view.focus();
      });
    },
    [run],
  );

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const relPath = await writeAttachment(notePath, file.name, bytes);
      run(callCommand(insertImageCommand.key, { src: relPath, alt: file.name }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't attach that image");
      setTimeout(() => setUploadError(null), 4000);
    }
  }

  const emphasisGroup: ToolbarAction[] = [
    {
      icon: Bold,
      label: "Bold",
      action: () => runAndSync((ctx) => callCommand(toggleStrongCommand.key)(ctx)),
      isActive: selectionState.bold,
    },
    {
      icon: Italic,
      label: "Italic",
      action: () => runAndSync((ctx) => callCommand(toggleEmphasisCommand.key)(ctx)),
      isActive: selectionState.italic,
    },
  ];

  const decorationGroup: ToolbarAction[] = [
    {
      icon: Highlighter,
      label: "Highlight",
      action: () =>
        runAndSync((ctx) => toggleTextDecoration(ctx, highlightSchema.type(ctx), { color: DEFAULT_HIGHLIGHT_COLOR })),
      isActive: selectionState.highlight,
    },
    {
      icon: Underline,
      label: "Underline",
      action: () =>
        runAndSync((ctx) => toggleTextDecoration(ctx, underlineSchema.type(ctx), { color: DEFAULT_DECORATION_COLOR })),
      isActive: selectionState.underline,
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      action: () =>
        runAndSync((ctx) =>
          toggleTextDecoration(ctx, strikethroughSchema.type(ctx), { color: DEFAULT_DECORATION_COLOR }),
        ),
      isActive: selectionState.strikethrough,
    },
  ];

  const clearFormattingButton: ToolbarAction = {
    icon: RemoveFormatting,
    label: "Clear formatting",
    action: () => runAndSync((ctx) => clearFormatting(ctx)),
  };

  const listGroup: ToolbarAction[] = [
    {
      icon: List,
      label: "Bullet list",
      action: () => runAndSync(toggleBulletList),
      isActive: selectionState.list === "bullet",
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      action: () => runAndSync(toggleOrderedList),
      isActive: selectionState.list === "ordered",
    },
    {
      icon: ListChecks,
      label: "Checklist",
      action: () => runAndSync(toggleTaskItem),
      isActive: selectionState.list === "task",
    },
  ];

  const alignGroup: ToolbarAction[] = ALIGN_OPTIONS.map(({ align, label, icon }) => ({
    icon,
    label,
    action: () => runAndSync((ctx) => setBlockAlign(ctx, align)),
    isActive: selectionState.align === align,
  }));

  const trailingButtons: ToolbarAction[] = [
    {
      icon: DividerIcon,
      label: "Divider",
      action: () => runAndSync((ctx) => callCommand(insertHrCommand.key)(ctx)),
    },
    {
      icon: ImagePlus,
      label: "Insert image",
      action: () => fileInputRef.current?.click(),
    },
    {
      icon: Code,
      label: "Code block",
      action: () => runAndSync((ctx) => callCommand(createCodeBlockCommand.key)(ctx)),
    },
    {
      icon: Layers,
      label: "Flashcard",
      action: () => run((ctx) => insertFlashcard(ctx, "qa")),
    },
    {
      icon: HelpCircle,
      label: "Multiple choice",
      action: () => run((ctx) => insertFlashcard(ctx, "mcq")),
    },
  ];

  return (
    <div className="relative flex h-full flex-col">
      {toolbarVisible && sketchMode && (
        <SketchToolbar
          tool={sketchTool}
          onToolChange={setSketchTool}
          color={sketchColor}
          onColorChange={setSketchColor}
          sizeIndex={sketchSizeIndex}
          onSizeIndexChange={setSketchSizeIndex}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClearSketch}
        />
      )}
      {toolbarVisible && !sketchMode && (
        <div className="border-subtle flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
          <TextStyleDropdown
            blockStyle={selectionState.blockStyle}
            onSelect={(style) =>
              runAndSync((ctx) => {
                liftOutOfList(ctx);
                callCommand(wrapInHeadingCommand.key, style === "paragraph" ? 0 : style)(ctx);
              })
            }
          />
          <div className="divider mx-1 h-5 w-px shrink-0" />
          <ToolbarButtonGroup items={emphasisGroup} />
          <ToolbarButtonGroup items={decorationGroup} />
          <ToolbarButtonGroup items={listGroup} />
          <ToolbarButtonGroup items={alignGroup} />
          <button
            type="button"
            onClick={clearFormattingButton.action}
            title={clearFormattingButton.label}
            aria-label={clearFormattingButton.label}
            className="btn-ghost h-7 w-7 shrink-0"
          >
            <clearFormattingButton.icon size={14} />
          </button>
          <TableMenu
            inTable={selectionState.inTable}
            cellAlign={selectionState.cellAlign}
            onInsert={(row, col) => runAndSync((ctx) => insertTable(ctx, row, col))}
            onAddRow={() => runAndSync(addTableRow)}
            onAddColumn={() => runAndSync(addTableColumn)}
            onDeleteRow={() => runAndSync(deleteTableRow)}
            onDeleteColumn={() => runAndSync(deleteTableColumn)}
            onDeleteTable={() => runAndSync(deleteCurrentTable)}
            onSetCellColor={(color) => runAndSync((ctx) => setTableCellBackground(ctx, color))}
            onSetCellAlign={(align) => runAndSync((ctx) => setTableColumnAlign(ctx, align))}
          />
          {trailingButtons.map(({ icon: Icon, label, action, isActive }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              title={label}
              aria-label={label}
              aria-pressed={isActive}
              className={`btn-ghost h-7 w-7 shrink-0 ${isActive ? "bg-accent-soft text-accent" : ""}`}
            >
              <Icon size={14} />
            </button>
          ))}
          {uploadError && <span className="text-danger ml-2 shrink-0 text-xs">{uploadError}</span>}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        className="hidden"
      />

      <div
        className={`prose-note milkdown-scroll h-full flex-1 overflow-y-auto px-12 py-8 @max-lg:px-6 @max-lg:py-5 @max-sm:px-3 @max-sm:py-3 ${sketchMode ? "select-none" : ""}`}
      >
        <div
          ref={sketchWrapperRef}
          className="relative min-h-full"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            focusNearestPosition(e.clientX, e.clientY);
          }}
        >
          <Milkdown />
          <SketchLayer
            className="absolute inset-0"
            active={sketchMode}
            strokes={strokes}
            tool={sketchTool}
            color={sketchColor}
            width={sketchWidth}
            onAddStroke={handleAddStroke}
            onEraseStrokes={handleEraseStrokes}
          />
        </div>
      </div>

      <div className="text-tertiary pointer-events-none absolute bottom-5 right-7 text-xs transition-opacity duration-300 @max-sm:bottom-2 @max-sm:right-3">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "pending" && "Editing…"}
      </div>
    </div>
  );
}

export function Editor(props: EditorProps) {
  return (
    <MilkdownProvider>
      <NoteEditor {...props} />
    </MilkdownProvider>
  );
}
