import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Copy,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Star,
} from "lucide-react";
import { FOLDER_COLORS, FOLDER_COLOR_HEX } from "../utils/folderColors";
import type { TreeEntry } from "../types";

interface NoteTreeProps {
  tree: TreeEntry[];
  onOpenNote: (path: string) => void;
  onDuplicateNote: (path: string) => void;
  /** Opens the "new note" dialog scoped to `parentPath` (see App.tsx's promptNewNote). */
  onCreateNote: (parentPath: string) => void;
  /** Opens the "new folder" dialog scoped to `parentPath` (see App.tsx's promptNewFolder). */
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string, isFolder: boolean, newTitle: string) => void;
  onDeleteEntry: (path: string, isFolder: boolean) => void;
  onMove: (path: string, targetParentPath: string) => void;
  onSetFolderColor: (path: string, color: string | null) => void;
  onSetStarred: (path: string, value: boolean) => void;
}

interface MenuState {
  path: string;
  title: string;
  type: "note" | "folder";
  color?: string;
  x: number;
  y: number;
}

interface DragEntry {
  path: string;
  title: string;
  type: "note" | "folder";
  parentPath: string;
}

const DRAG_THRESHOLD = 4;
/** Matches EntryMenu's `w-40` class, used to keep the menu inside the container. */
const MENU_WIDTH = 160;

function resolveDropTarget(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const target = el.closest("[data-drop-target]") as HTMLElement | null;
  return target ? (target.dataset.path ?? null) : null;
}

function isValidDropTarget(source: DragEntry, target: string): boolean {
  if (target === source.parentPath) return false;
  if (source.type === "folder") {
    if (target === source.path) return false;
    if (target.startsWith(`${source.path}/`)) return false;
  }
  return true;
}

/** Hierarchical, drag-and-droppable file tree - the "tree view" mode of Home's middle
 * portion (see Home.tsx). Owns its own expand/collapse, rename, drag, and context-menu state,
 * so it can be mounted/unmounted freely as the user flips between tree and grid view. */
export function NoteTree({
  tree,
  onOpenNote,
  onDuplicateNote,
  onCreateNote,
  onCreateFolder,
  onRename,
  onDeleteEntry,
  onMove,
  onSetFolderColor,
  onSetStarred,
}: NoteTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ path: string } | null>(null);
  const [drag, setDrag] = useState<DragEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; entry: DragEntry } | null>(null);
  const dragEntryRef = useRef<DragEntry | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const didDragRef = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  useEffect(() => {
    function cleanupDrag() {
      pointerStartRef.current = null;
      dragEntryRef.current = null;
      dropTargetRef.current = null;
      document.body.style.removeProperty("cursor");
      setDrag(null);
      setDropTarget(null);
    }

    function handlePointerMove(e: PointerEvent) {
      const start = pointerStartRef.current;
      if (!start) return;

      if (!dragEntryRef.current) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragEntryRef.current = start.entry;
        didDragRef.current = true;
        setDrag(start.entry);
        document.body.style.cursor = "grabbing";
      }

      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate3d(${e.clientX + 16}px, ${e.clientY + 14}px, 0)`;
      }

      const hovered = resolveDropTarget(e.clientX, e.clientY);
      const valid = hovered !== null && isValidDropTarget(dragEntryRef.current, hovered) ? hovered : null;
      if (valid !== dropTargetRef.current) {
        dropTargetRef.current = valid;
        setDropTarget(valid);
      }
    }

    function handlePointerUp() {
      if (dragEntryRef.current && dropTargetRef.current !== null) {
        onMoveRef.current(dragEntryRef.current.path, dropTargetRef.current);
      }
      const didDrag = didDragRef.current;
      cleanupDrag();
      if (didDrag) {
        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }
    }

    function handlePointerCancel() {
      cleanupDrag();
      didDragRef.current = false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragEntryRef.current) {
        cleanupDrag();
        didDragRef.current = false;
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function guardedClick(fn: () => void) {
    if (didDragRef.current) return;
    fn();
  }

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleRowPointerDown(e: React.PointerEvent, entry: DragEntry) {
    if (e.button !== 0) return;
    if (renaming?.path === entry.path) return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, entry };
  }

  function openMenu(
    e: React.MouseEvent,
    entry: { path: string; title: string; type: "note" | "folder"; color?: string },
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (menu && menu.path === entry.path) {
      setMenu(null);
      return;
    }
    const containerRect = containerRef.current!.getBoundingClientRect();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const idealX = rect.left - containerRect.left;
    const maxX = containerRect.width - MENU_WIDTH - 4;
    setMenu({
      path: entry.path,
      title: entry.title,
      type: entry.type,
      color: entry.color,
      x: Math.max(4, Math.min(idealX, maxX)),
      y: rect.bottom - containerRect.top + 4,
    });
  }

  function startRename(path: string) {
    setMenu(null);
    setRenaming({ path });
  }

  function commitRename(path: string, isFolder: boolean, rawValue: string) {
    setRenaming(null);
    const value = rawValue.trim();
    if (value) onRename(path, isFolder, value);
  }

  if (tree.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-3 text-center">
        <p className="text-secondary text-sm">No notes yet.</p>
        <button
          type="button"
          onClick={() => onCreateNote("")}
          className="btn-ghost bg-accent-soft text-accent h-9 rounded-lg px-4 text-sm"
        >
          Create your first note
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div data-drop-target data-path="" className="flex min-h-full flex-col gap-0.5">
        {tree.map((entry) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={0}
            expanded={expanded}
            onToggleFolder={toggleFolder}
            dragPath={drag?.path ?? null}
            dropTarget={dropTarget}
            renamingPath={renaming?.path ?? null}
            onCommitRename={commitRename}
            onCancelRename={() => setRenaming(null)}
            onOpenNote={onOpenNote}
            onOpenMenu={openMenu}
            onRowPointerDown={handleRowPointerDown}
            guardedClick={guardedClick}
            onCreateNote={onCreateNote}
            onCreateFolder={onCreateFolder}
            onStartRename={startRename}
            onToggleStar={(path, value) => onSetStarred(path, value)}
          />
        ))}
      </div>

      {menu && (
        <EntryMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onRename={() => startRename(menu.path)}
          onDelete={() => {
            setMenu(null);
            onDeleteEntry(menu.path, menu.type === "folder");
          }}
          onSetColor={menu.type === "folder" ? (color) => onSetFolderColor(menu.path, color) : undefined}
          onOpenInNewWindow={menu.type === "note" ? () => onDuplicateNote(menu.path) : undefined}
        />
      )}

      {drag &&
        createPortal(
          <div
            ref={ghostRef}
            className="glass-surface shadow-app-lg pointer-events-none fixed left-0 top-0 z-[999] flex max-w-[220px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm"
            style={{ transform: "translate3d(-9999px, -9999px, 0)", opacity: 0.92 }}
          >
            {drag.type === "folder" ? (
              <Folder size={13} className="text-tertiary shrink-0" />
            ) : (
              <FileText size={13} className="text-tertiary shrink-0" />
            )}
            <span className="text-primary min-w-0 truncate">{drag.title}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}

interface TreeRowProps {
  entry: TreeEntry;
  depth: number;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  dragPath: string | null;
  dropTarget: string | null;
  renamingPath: string | null;
  onCommitRename: (path: string, isFolder: boolean, value: string) => void;
  onCancelRename: () => void;
  onOpenNote: (path: string) => void;
  onOpenMenu: (
    e: React.MouseEvent,
    entry: { path: string; title: string; type: "note" | "folder"; color?: string },
  ) => void;
  onRowPointerDown: (e: React.PointerEvent, entry: DragEntry) => void;
  guardedClick: (fn: () => void) => void;
  onCreateNote: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onStartRename: (path: string) => void;
  onToggleStar: (path: string, value: boolean) => void;
}

function TreeRow({
  entry,
  depth,
  expanded,
  onToggleFolder,
  dragPath,
  dropTarget,
  renamingPath,
  onCommitRename,
  onCancelRename,
  onOpenNote,
  onOpenMenu,
  onRowPointerDown,
  guardedClick,
  onCreateNote,
  onCreateFolder,
  onStartRename,
  onToggleStar,
}: TreeRowProps) {
  const indent = 8 + depth * 16;
  const isBeingDragged = dragPath === entry.path;
  const isRenaming = renamingPath === entry.path;

  if (entry.type === "note") {
    return (
      <div
        onPointerDown={(e) =>
          onRowPointerDown(e, { path: entry.path, title: entry.title, type: "note", parentPath: entry.parentPath })
        }
        onClick={() => guardedClick(() => onOpenNote(entry.path))}
        role="button"
        tabIndex={0}
        className={`group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-sm transition-colors duration-150 ${
          isBeingDragged ? "opacity-40" : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
        style={{ paddingLeft: indent, touchAction: "none" }}
      >
        <FileText size={14} className="text-icon-outline shrink-0" />
        {isRenaming ? (
          <RenameInput
            initialValue={entry.title}
            onCommit={(value) => onCommitRename(entry.path, false, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(entry.path);
            }}
            className="min-w-0 flex-1 truncate"
          >
            {entry.title}
          </span>
        )}
        {!isRenaming && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(entry.path, !entry.starred);
              }}
              className={`btn-ghost h-5 w-5 ${entry.starred ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              title={entry.starred ? "Unstar" : "Star"}
              aria-label={entry.starred ? `Unstar ${entry.title}` : `Star ${entry.title}`}
              aria-pressed={!!entry.starred}
            >
              <Star size={11} className={entry.starred ? "fill-current" : ""} />
            </button>
            <button
              type="button"
              onClick={(e) => onOpenMenu(e, { path: entry.path, title: entry.title, type: "note" })}
              className="btn-ghost h-5 w-5 opacity-0 group-hover:opacity-100"
              title="Note options"
              aria-label={`Options for ${entry.title}`}
            >
              <MoreHorizontal size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }

  const isOpen = expanded.has(entry.path);
  const isDropTarget = dropTarget === entry.path;

  return (
    <div>
      <div
        data-drop-target
        data-path={entry.path}
        onPointerDown={(e) =>
          onRowPointerDown(e, { path: entry.path, title: entry.title, type: "folder", parentPath: entry.parentPath })
        }
        onClick={() => guardedClick(() => onToggleFolder(entry.path))}
        role="button"
        tabIndex={0}
        className={`group flex cursor-pointer items-center gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors duration-150 ${
          isDropTarget ? "bg-accent-soft text-accent" : "text-secondary hover:bg-surface-hover hover:text-primary"
        } ${isBeingDragged ? "opacity-40" : ""}`}
        style={{ paddingLeft: Math.max(indent - 16, 0), touchAction: "none" }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFolder(entry.path);
          }}
          className="btn-ghost h-5 w-5 shrink-0"
          aria-label={isOpen ? "Collapse folder" : "Expand folder"}
        >
          <ChevronRight size={13} className={`transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
        </button>
        <Folder
          size={14}
          className={entry.color ? "text-icon-outline shrink-0" : "text-tertiary shrink-0"}
          fill={entry.color ? FOLDER_COLOR_HEX[entry.color] : undefined}
          fillOpacity={entry.color ? 1 : 0}
        />
        {isRenaming ? (
          <RenameInput
            initialValue={entry.title}
            onCommit={(value) => onCommitRename(entry.path, true, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(entry.path);
            }}
            className="min-w-0 flex-1 truncate font-medium"
          >
            {entry.title}
          </span>
        )}
        {!isRenaming && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCreateNote(entry.path);
              }}
              className="btn-ghost h-5 w-5"
              title="New note here"
              aria-label={`New note in ${entry.title}`}
            >
              <FilePlus size={11} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolder(entry.path);
              }}
              className="btn-ghost h-5 w-5"
              title="New folder here"
              aria-label={`New folder in ${entry.title}`}
            >
              <FolderPlus size={11} />
            </button>
            <button
              type="button"
              onClick={(e) => onOpenMenu(e, { path: entry.path, title: entry.title, type: "folder", color: entry.color })}
              className="btn-ghost h-5 w-5"
              title="Folder options"
              aria-label={`Options for ${entry.title}`}
            >
              <MoreHorizontal size={12} />
            </button>
          </div>
        )}
      </div>
      {isOpen && entry.children.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {entry.children.map((child) => (
            <TreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleFolder={onToggleFolder}
              dragPath={dragPath}
              dropTarget={dropTarget}
              renamingPath={renamingPath}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onOpenNote={onOpenNote}
              onOpenMenu={onOpenMenu}
              onRowPointerDown={onRowPointerDown}
              guardedClick={guardedClick}
              onCreateNote={onCreateNote}
              onCreateFolder={onCreateFolder}
              onStartRename={onStartRename}
              onToggleStar={onToggleStar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Keeps the draft text as local state instead of routing every keystroke through the
 * parent's `renaming` state. `onCommit` fires at most once per mount. */
export function RenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function commit() {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  }

  function cancel() {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
      }}
      onBlur={commit}
      className="text-primary w-full min-w-0 rounded bg-transparent text-sm font-medium focus:outline-none"
    />
  );
}

export function EntryMenu({
  menu,
  onClose,
  onRename,
  onDelete,
  onSetColor,
  onOpenInNewWindow,
}: {
  menu: MenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSetColor?: (color: string | null) => void;
  onOpenInNewWindow?: () => void;
}) {
  return (
    <div
      className="glass-surface shadow-app-lg absolute z-50 w-40 rounded-xl p-1 text-sm"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {onSetColor && (
        <>
          <div className="flex flex-wrap gap-1.5 px-1.5 py-1.5">
            <button
              type="button"
              onClick={() => {
                onSetColor(null);
                onClose();
              }}
              title="No color"
              aria-label="No color"
              aria-pressed={!menu.color}
              className="border-subtle-strong flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-110"
              style={{
                boxShadow: !menu.color
                  ? "0 0 0 2px var(--surface-strong), 0 0 0 3.5px rgb(var(--accent-rgb))"
                  : "none",
              }}
            >
              {!menu.color && <Check size={11} className="text-tertiary" strokeWidth={3} />}
            </button>
            {FOLDER_COLORS.map((c) => {
              const selected = menu.color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    onSetColor(c.value);
                    onClose();
                  }}
                  title={c.value}
                  aria-label={`Color ${c.value}`}
                  aria-pressed={selected}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110"
                  style={{
                    backgroundColor: c.hex,
                    boxShadow: selected ? `0 0 0 2px var(--surface-strong), 0 0 0 3.5px ${c.hex}` : "none",
                  }}
                >
                  {selected && <Check size={11} className="text-white" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
          <div className="border-subtle my-1 border-t" />
        </>
      )}
      {onOpenInNewWindow && (
        <button
          type="button"
          onClick={() => {
            onOpenInNewWindow();
            onClose();
          }}
          className="menu-item text-primary flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left"
        >
          <Copy size={12} className="text-tertiary shrink-0" />
          Open in new window
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onRename();
          onClose();
        }}
        className="menu-item text-primary flex w-full items-center rounded-lg px-2.5 py-1.5 text-left"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="menu-item menu-item-danger text-danger flex w-full items-center rounded-lg px-2.5 py-1.5 text-left"
      >
        Delete
      </button>
    </div>
  );
}
