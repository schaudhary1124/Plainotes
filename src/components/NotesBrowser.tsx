import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Copy,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { flattenNotes } from "../utils/fsNotes";
import type { FolderEntry, NotesViewMode, TreeEntry } from "../types";

/** Preset folder colors, offered as swatches in the folder's context menu. */
export const FOLDER_COLORS: { value: string; hex: string }[] = [
  { value: "red", hex: "#f43f5e" },
  { value: "orange", hex: "#f97316" },
  { value: "amber", hex: "#d97706" },
  { value: "green", hex: "#16a34a" },
  { value: "teal", hex: "#0d9488" },
  { value: "blue", hex: "#3b82f6" },
  { value: "indigo", hex: "#6366f1" },
  { value: "purple", hex: "#9333ea" },
  { value: "pink", hex: "#ec4899" },
  { value: "gray", hex: "#6b7280" },
];

const FOLDER_COLOR_HEX: Record<string, string> = Object.fromEntries(
  FOLDER_COLORS.map((c) => [c.value, c.hex]),
);

interface NotesBrowserProps {
  tree: TreeEntry[];
  browseFolder: string;
  onNavigate: (path: string) => void;
  viewMode: NotesViewMode;
  onViewModeChange: (mode: NotesViewMode) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onOpenNote: (path: string) => void;
  onDuplicateNote: (path: string) => void;
  onCreateNote: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string, isFolder: boolean, newTitle: string) => void;
  onDeleteNote: (path: string, title: string) => void;
  onDeleteFolder: (path: string, title: string) => void;
  onMove: (path: string, targetParentPath: string) => void;
  onSetFolderColor: (path: string, color: string | null) => void;
}

interface BrowserNote {
  path: string;
  title: string;
  parentPath: string;
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
/** Matches the EntryMenu's `w-40` class, used to keep the menu inside the container. */
const MENU_WIDTH = 160;

function findChildren(tree: TreeEntry[], path: string): TreeEntry[] | null {
  if (!path) return tree;
  for (const entry of tree) {
    if (entry.type !== "folder") continue;
    if (entry.path === path) return entry.children;
    if (path.startsWith(`${entry.path}/`)) {
      const found = findChildren(entry.children, path);
      if (found) return found;
    }
  }
  return null;
}

function getBreadcrumbs(path: string): { path: string; label: string }[] {
  const crumbs = [{ path: "", label: "All Notes" }];
  if (!path) return crumbs;
  const segments = path.split("/");
  let acc = "";
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ path: acc, label: seg });
  }
  return crumbs;
}

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

export function NotesBrowser({
  tree,
  browseFolder,
  onNavigate,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  searchInputRef,
  onOpenNote,
  onDuplicateNote,
  onCreateNote,
  onCreateFolder,
  onRename,
  onDeleteNote,
  onDeleteFolder,
  onMove,
  onSetFolderColor,
}: NotesBrowserProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Only tracks *which* entry is being renamed - the draft text itself lives
  // locally inside RenameInput so keystrokes don't cascade a re-render
  // through the whole grid/tree on every character typed.
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

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;

  const folderChildren = useMemo(() => findChildren(tree, browseFolder) ?? [], [tree, browseFolder]);

  const displayFolders = useMemo(
    () => (isSearching ? [] : (folderChildren.filter((e) => e.type === "folder") as FolderEntry[])),
    [isSearching, folderChildren],
  );

  const displayNotes: BrowserNote[] = useMemo(
    () =>
      isSearching
        ? flattenNotes(tree).filter((n) => n.title.toLowerCase().includes(trimmedQuery))
        : folderChildren.filter((e) => e.type === "note"),
    [isSearching, tree, trimmedQuery, folderChildren],
  );

  const breadcrumbs = getBreadcrumbs(browseFolder);

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

  const nothingAnywhere = tree.length === 0;
  const folderEmpty =
    viewMode === "grid" && !isSearching && displayFolders.length === 0 && displayNotes.length === 0;
  const noMatches = isSearching && displayNotes.length === 0;
  const createTargetFolder = viewMode === "grid" ? browseFolder : "";

  return (
    <div ref={containerRef} className="relative flex h-full flex-col">
      <div className="border-subtle flex flex-wrap items-center gap-2 border-b px-4 py-3 @max-sm:px-3 @max-sm:py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {isSearching ? (
            <span className="text-secondary font-medium">Search results</span>
          ) : viewMode === "list" ? (
            <span className="text-primary font-semibold">All Notes</span>
          ) : (
            breadcrumbs.map((crumb, i) => (
              <span key={crumb.path || "root"} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight size={13} className="text-tertiary shrink-0" />}
                <button
                  type="button"
                  data-drop-target
                  data-path={crumb.path}
                  onClick={() => onNavigate(crumb.path)}
                  className={`min-w-0 truncate rounded-md px-1.5 py-0.5 transition-colors duration-150 ${
                    i === breadcrumbs.length - 1
                      ? "text-primary font-semibold"
                      : "text-secondary hover:bg-surface-hover hover:text-primary"
                  } ${dropTarget === crumb.path ? "bg-accent-soft text-accent" : ""}`}
                >
                  {crumb.label}
                </button>
              </span>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="border-subtle bg-surface-hover flex h-8 w-40 items-center gap-2 rounded-lg border px-2.5 @max-sm:w-28">
            <Search size={13} className="text-tertiary shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes"
              className="text-primary placeholder:text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            />
          </div>

          <div className="glass-surface flex h-8 items-center gap-0.5 rounded-lg border-0 p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`btn-ghost h-7 w-7 ${viewMode === "grid" ? "bg-accent-soft text-accent" : ""}`}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={`btn-ghost h-7 w-7 ${viewMode === "list" ? "bg-accent-soft text-accent" : ""}`}
              title="List view"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onCreateFolder(createTargetFolder)}
            className="btn-ghost h-8 w-8"
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus size={15} />
          </button>
          <button
            type="button"
            onClick={() => onCreateNote(createTargetFolder)}
            className="btn-ghost h-8 w-8"
            title="New note"
            aria-label="New note"
          >
            <FilePlus size={15} />
          </button>
        </div>
      </div>

      <div className="@container flex-1 overflow-y-auto p-4 @max-sm:p-3">
        {nothingAnywhere && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-secondary text-sm">No notes yet.</p>
            <button
              type="button"
              onClick={() => onCreateNote("")}
              className="btn-ghost bg-accent-soft text-accent h-9 rounded-lg px-4 text-sm"
            >
              Create your first note
            </button>
          </div>
        )}

        {!nothingAnywhere && folderEmpty && (
          <p className="text-tertiary flex h-full items-center justify-center text-sm">Nothing here yet.</p>
        )}

        {!nothingAnywhere && noMatches && (
          <p className="text-tertiary flex h-full items-center justify-center text-sm">No matches.</p>
        )}

        {!nothingAnywhere && !folderEmpty && !noMatches && viewMode === "grid" && (
          <div className="grid justify-start gap-3 [grid-template-columns:repeat(auto-fill,96px)]">
            {displayFolders.map((entry) => (
              <FolderTile
                key={entry.path}
                entry={entry}
                isRenaming={renaming?.path === entry.path}
                onCommitRename={(value) => commitRename(entry.path, true, value)}
                onCancelRename={() => setRenaming(null)}
                isBeingDragged={drag?.path === entry.path}
                isDropTarget={dropTarget === entry.path}
                onPointerDown={(e) =>
                  handleRowPointerDown(e, {
                    path: entry.path,
                    title: entry.title,
                    type: "folder",
                    parentPath: entry.parentPath,
                  })
                }
                onOpen={() => guardedClick(() => onNavigate(entry.path))}
                onStartRename={() => startRename(entry.path)}
                onOpenMenu={(e) =>
                  openMenu(e, { path: entry.path, title: entry.title, type: "folder", color: entry.color })
                }
              />
            ))}
            {displayNotes.map((entry) => (
              <NoteTile
                key={entry.path}
                entry={entry}
                viewMode={viewMode}
                isRenaming={renaming?.path === entry.path}
                onCommitRename={(value) => commitRename(entry.path, false, value)}
                onCancelRename={() => setRenaming(null)}
                isBeingDragged={drag?.path === entry.path}
                onPointerDown={(e) =>
                  handleRowPointerDown(e, {
                    path: entry.path,
                    title: entry.title,
                    type: "note",
                    parentPath: entry.parentPath,
                  })
                }
                onOpen={() => guardedClick(() => onOpenNote(entry.path))}
                onStartRename={() => startRename(entry.path)}
                onOpenMenu={(e) => openMenu(e, { path: entry.path, title: entry.title, type: "note" })}
              />
            ))}
          </div>
        )}

        {!nothingAnywhere && !noMatches && viewMode === "list" && isSearching && (
          <div className="flex flex-col gap-0.5">
            {displayNotes.map((entry) => (
              <NoteTile
                key={entry.path}
                entry={entry}
                viewMode={viewMode}
                isRenaming={renaming?.path === entry.path}
                onCommitRename={(value) => commitRename(entry.path, false, value)}
                onCancelRename={() => setRenaming(null)}
                isBeingDragged={drag?.path === entry.path}
                onPointerDown={(e) =>
                  handleRowPointerDown(e, {
                    path: entry.path,
                    title: entry.title,
                    type: "note",
                    parentPath: entry.parentPath,
                  })
                }
                onOpen={() => guardedClick(() => onOpenNote(entry.path))}
                onStartRename={() => startRename(entry.path)}
                onOpenMenu={(e) => openMenu(e, { path: entry.path, title: entry.title, type: "note" })}
              />
            ))}
          </div>
        )}

        {!nothingAnywhere && viewMode === "list" && !isSearching && (
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
              />
            ))}
          </div>
        )}
      </div>

      {menu && (
        <EntryMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onRename={() => startRename(menu.path)}
          onDelete={() => {
            setMenu(null);
            if (menu.type === "note") onDeleteNote(menu.path, menu.title);
            else onDeleteFolder(menu.path, menu.title);
          }}
          onSetColor={
            menu.type === "folder" ? (color) => onSetFolderColor(menu.path, color) : undefined
          }
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

interface FolderTileProps {
  entry: FolderEntry;
  isRenaming: boolean;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  isBeingDragged: boolean;
  isDropTarget: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
}

function FolderTile({
  entry,
  isRenaming,
  onCommitRename,
  onCancelRename,
  isBeingDragged,
  isDropTarget,
  onPointerDown,
  onOpen,
  onStartRename,
  onOpenMenu,
}: FolderTileProps) {
  const itemCount = entry.children.length;
  const countLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const colorHex = entry.color ? FOLDER_COLOR_HEX[entry.color] : undefined;

  return (
    <div
      data-drop-target
      data-path={entry.path}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      className={`group animate-card-in relative flex cursor-pointer flex-col items-center gap-0.5 text-center ${
        isBeingDragged ? "opacity-40" : ""
      }`}
      style={{ touchAction: "none" }}
    >
      <div
        className={`relative flex aspect-square w-[88px] items-center justify-center rounded-2xl transition-colors duration-150 ${
          isDropTarget ? "bg-accent-soft" : "hover:bg-surface-hover"
        }`}
      >
        <Folder
          size={66}
          strokeWidth={1.25}
          className={colorHex ? "text-icon-outline shrink-0" : "text-tertiary shrink-0"}
          fill={colorHex}
          fillOpacity={colorHex ? 1 : 0}
        />
        {!isRenaming && (
          <button
            type="button"
            onClick={onOpenMenu}
            className="btn-ghost absolute right-0 top-0 h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
            title="Folder options"
            aria-label={`Options for ${entry.title}`}
          >
            <MoreHorizontal size={13} />
          </button>
        )}
      </div>
      <div className="min-w-0 w-full">
        {isRenaming ? (
          <RenameInput
            initialValue={entry.title}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <p
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            className="text-primary truncate text-sm font-medium"
          >
            {entry.title}
          </p>
        )}
        <p className="text-tertiary text-xs">{countLabel}</p>
      </div>
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
          <button
            type="button"
            onClick={(e) => onOpenMenu(e, { path: entry.path, title: entry.title, type: "note" })}
            className="btn-ghost h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
            title="Note options"
            aria-label={`Options for ${entry.title}`}
          >
            <MoreHorizontal size={12} />
          </button>
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
              onClick={(e) =>
                onOpenMenu(e, { path: entry.path, title: entry.title, type: "folder", color: entry.color })
              }
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NoteTileProps {
  entry: BrowserNote;
  viewMode: NotesViewMode;
  isRenaming: boolean;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onOpenMenu: (e: React.MouseEvent) => void;
}

function NoteTile({
  entry,
  viewMode,
  isRenaming,
  onCommitRename,
  onCancelRename,
  isBeingDragged,
  onPointerDown,
  onOpen,
  onStartRename,
  onOpenMenu,
}: NoteTileProps) {
  const isGrid = viewMode === "grid";

  if (!isGrid) {
    return (
      <div
        onPointerDown={onPointerDown}
        onClick={onOpen}
        role="button"
        tabIndex={0}
        className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 ${
          isBeingDragged ? "opacity-40" : "text-secondary hover:bg-surface-hover hover:text-primary"
        }`}
        style={{ touchAction: "none" }}
      >
        <FileText size={14} className="text-icon-outline shrink-0" />
        {isRenaming ? (
          <RenameInput
            initialValue={entry.title}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            className="min-w-0 flex-1 truncate"
          >
            {entry.title}
          </span>
        )}
        {!isRenaming && (
          <button
            type="button"
            onClick={onOpenMenu}
            className="btn-ghost h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
            title="Note options"
            aria-label={`Options for ${entry.title}`}
          >
            <MoreHorizontal size={12} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      className={`group animate-card-in relative flex cursor-pointer flex-col items-center gap-0.5 text-center ${
        isBeingDragged ? "opacity-40" : ""
      }`}
      style={{ touchAction: "none" }}
    >
      <div className="relative flex aspect-square w-[88px] items-center justify-center rounded-2xl transition-colors duration-150 hover:bg-surface-hover">
        <FileText size={56} strokeWidth={1.25} className="text-icon-outline shrink-0" />
        {!isRenaming && (
          <button
            type="button"
            onClick={onOpenMenu}
            className="btn-ghost absolute right-0 top-0 h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
            title="Note options"
            aria-label={`Options for ${entry.title}`}
          >
            <MoreHorizontal size={13} />
          </button>
        )}
      </div>
      <div className="min-w-0 w-full">
        {isRenaming ? (
          <RenameInput
            initialValue={entry.title}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <p
            onClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            className="text-primary truncate text-sm font-medium"
          >
            {entry.title}
          </p>
        )}
      </div>
    </div>
  );
}

/** Keeps the draft text as local state instead of routing every keystroke
 * through the parent's `renaming` state - typing here used to re-render the
 * entire visible grid/tree on every character. `onCommit` fires at most
 * once per mount (Enter and blur can otherwise both fire for the same
 * keypress). */
function RenameInput({
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
  // Guards both paths against firing twice - e.g. a stray `blur` from the
  // input unmounting after Escape shouldn't re-commit the cancelled edit.
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

function EntryMenu({
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
