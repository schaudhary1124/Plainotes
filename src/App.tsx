import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Header } from "./components/Header";
import { NotesBrowser } from "./components/NotesBrowser";
import { Editor } from "./components/Editor";
import { StudyView } from "./components/StudyView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NewItemDialog } from "./components/NewItemDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { ResizeHandles } from "./components/ResizeHandles";
import { TabStrip } from "./components/TabStrip";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  ensureNotesDir,
  flattenNotes,
  listNoteTree,
  moveEntry,
  readNote,
  renameEntry,
  setFolderColor,
  writeNote,
} from "./utils/fsNotes";
import { getTemplate } from "./utils/templates";
import { applySettingsToDocument, loadSettings, saveSettings } from "./utils/settings";
import {
  detachInitPromise,
  getTargetFromLocation,
  openWindowInstance,
  MERGE_TAB_EVENT,
  type MergeTabPayload,
} from "./utils/windowInstance";
import { broadcastNoteSaved, listenForNoteSaved } from "./utils/noteSync";
import { loadMainTabSession, saveMainTabSession } from "./utils/tabSession";
import {
  addNoteToIndex,
  loadPersistedSearchIndex,
  movePathInIndex,
  removePathFromIndex,
  syncSearchIndex,
  updateNoteInIndex,
} from "./utils/searchIndex";
import type { AppMode, AppSettings, TreeEntry } from "./types";

type BootStatus = "loading" | "ready" | "error";

type ConfirmAction =
  | { kind: "delete-note"; path: string; title: string }
  | { kind: "delete-folder"; path: string; title: string };

type NewItemDialogState = { kind: "note" | "folder"; parentPath: string };

const appWindow = getCurrentWindow();
/** Only the main window's tabs are persisted/restored across relaunches - secondary windows
 * (duplicated or detached) are spawned ad hoc and were never restored on relaunch either. */
const isMainWindow = appWindow.label === "main";

// Temporary diagnostics for the "why does a new window take so long" investigation - safe to
// remove once that's resolved. performance.now() is relative to when this document's
// navigation started, so timestamps here reveal how much of the delay happens before this
// module even starts executing (bundle fetch/parse) vs. inside the boot logic below.
const bootStartTime = performance.now();
const bootLog = (...args: unknown[]) =>
  console.log("[boot]", `+${(performance.now() - bootStartTime).toFixed(0)}ms`, ...args);
bootLog("module evaluating", { label: appWindow.label });

/** Repoints a tab's note path when its note (or an ancestor folder) is renamed/moved. */
function remapTabPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
  return path;
}

/** Picks which tab should become active after `removedPath` is closed: the tab that shifted
 * into its old slot (its right neighbor), falling back to the new last tab (its left neighbor). */
function neighborTabAfterRemoval(before: string[], removedPath: string, after: string[]): string | null {
  if (after.length === 0) return null;
  const idx = before.indexOf(removedPath);
  return after[Math.max(0, Math.min(idx, after.length - 1))];
}

/** Inserts `path` right after `activePath` (Chrome's "new tab opens next to the current
 * one" behavior), or leaves `tabs` untouched if it's already open. */
function insertTabNextToActive(tabs: string[], activePath: string | null, path: string): string[] {
  if (tabs.includes(path)) return tabs;
  const idx = activePath ? tabs.indexOf(activePath) : -1;
  const next = [...tabs];
  next.splice(idx + 1, 0, path);
  return next;
}

function App() {
  bootLog("App() rendering");
  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState("");
  const [mode, setMode] = useState<AppMode>("edit");
  const [sketchMode, setSketchMode] = useState(false);
  const [view, setView] = useState<"browse" | "note">("browse");
  const [browseFolder, setBrowseFolder] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndexReady, setSearchIndexReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [newItemDialog, setNewItemDialog] = useState<NewItemDialogState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const toolbarVisible = !settings.toolbarCollapsed;
  const handleToggleToolbar = () => setSettings((s) => ({ ...s, toolbarCollapsed: !s.toolbarCollapsed }));

  const activeContentRef = useRef(activeContent);
  const activeNotePathRef = useRef(activeNotePath);
  const tabsRef = useRef(tabs);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Content last known to be on disk for the active note - used to tell whether this
  // window has local edits that haven't been persisted yet (see listenForNoteSaved below).
  const savedContentRef = useRef(activeContent);
  // Bumped to force the Editor to remount (and pick up fresh initialContent) when another
  // window's save is applied here, since Milkdown only reads its initial value on mount.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    activeContentRef.current = activeContent;
  }, [activeContent]);
  useEffect(() => {
    activeNotePathRef.current = activeNotePath;
  }, [activeNotePath]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Persist the main window's open tabs so they can be restored on next launch (see the
  // boot effect below). Secondary windows never write this - see isMainWindow's definition.
  useEffect(() => {
    if (!isMainWindow || bootStatus !== "ready") return;
    saveMainTabSession(tabs, activeNotePath);
  }, [tabs, activeNotePath, bootStatus]);

  useEffect(() => {
    applySettingsToDocument(settings);
    saveSettings(settings);
  }, [settings]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 3500);
  }

  const flushActiveNote = useCallback(async () => {
    const path = activeNotePathRef.current;
    if (!path) return;
    const content = activeContentRef.current;
    try {
      await writeNote(path, content);
      savedContentRef.current = content;
      updateNoteInIndex(path, content);
      await broadcastNoteSaved(path, content);
    } catch {
      // The active note may have been deleted or moved outside the app;
      // don't let a failed save block switching to a different note.
    }
  }, []);

  const refreshTree = useCallback(async () => {
    const t = await listNoteTree();
    setTree(t);
    return t;
  }, []);

  // Defensive: if the folder currently being browsed was deleted out from
  // under the user (e.g. an ancestor folder removed), fall back to root.
  useEffect(() => {
    if (!browseFolder) return;
    const folderExists = (entries: TreeEntry[], path: string): boolean =>
      entries.some(
        (e) => e.type === "folder" && (e.path === path || (path.startsWith(`${e.path}/`) && folderExists(e.children, path))),
      );
    if (!folderExists(tree, browseFolder)) {
      setBrowseFolder("");
    }
  }, [tree, browseFolder]);

  const selectNote = useCallback(
    async (path: string) => {
      await flushActiveNote();
      const content = await readNote(path);
      savedContentRef.current = content;
      setActiveNotePath(path);
      setActiveContent(content);
    },
    [flushActiveNote],
  );

  /** Opens `path` as a new tab next to the current one (Chrome's "open in new tab"
   * behavior) - or just switches to it if it's already open in this window. */
  const handleOpenNote = useCallback(
    async (path: string) => {
      setTabs((current) => insertTabNextToActive(current, activeNotePathRef.current, path));
      await selectNote(path);
      setView("note");
      setMode("edit");
    },
    [selectNote],
  );

  const handleSelectTab = useCallback(
    async (path: string) => {
      await selectNote(path);
      setView("note");
    },
    [selectNote],
  );

  /** Closes a tab. If it was active, activates a neighbor (or falls back to browse if it
   * was the last tab) - also used to finalize a drag-out once the new window is live. */
  const handleCloseTab = useCallback(
    async (path: string) => {
      const before = tabsRef.current;
      const after = before.filter((p) => p !== path);
      setTabs(after);
      if (activeNotePathRef.current !== path) return;
      const neighbor = neighborTabAfterRemoval(before, path, after);
      if (neighbor) {
        await selectNote(neighbor);
        return;
      }
      if (!isMainWindow) {
        // A secondary window that just lost its only tab (e.g. its tab got dragged/merged
        // elsewhere) has nothing left to show - close it, like a browser window with no tabs
        // left, rather than leaving it sitting there as an empty browse view.
        await appWindow.close();
        return;
      }
      await flushActiveNote();
      setActiveNotePath(null);
      setActiveContent("");
      setView("browse");
    },
    [selectNote, flushActiveNote],
  );

  const handleReorderTabs = useCallback((next: string[]) => {
    setTabs(next);
  }, []);

  /** Called once a tab-drag resolves into a detach (merge into another window, or a new
   * standalone window) - resolves the note's latest content: flushed in-memory content if
   * it's the active tab, otherwise a plain disk read (background tabs are never edited, so
   * disk is already current). */
  const handlePrepareDetach = useCallback(
    async (path: string): Promise<string> => {
      if (path === activeNotePathRef.current) {
        await flushActiveNote();
        return activeContentRef.current;
      }
      return readNote(path);
    },
    [flushActiveNote],
  );

  const handleBack = useCallback(async () => {
    await flushActiveNote();
    setView("browse");
  }, [flushActiveNote]);

  /** Opens a note in a new window, regardless of what's currently active/browsed. */
  const handleDuplicateNote = useCallback(
    async (path: string) => {
      await flushActiveNote();
      await openWindowInstance({ notePath: path });
    },
    [flushActiveNote],
  );

  /** Mirrors the current window (active note if one is open, else the folder being browsed) into a new window. */
  const handleDuplicateWindow = useCallback(async () => {
    await flushActiveNote();
    if (view === "note" && activeNotePathRef.current) {
      await openWindowInstance({ notePath: activeNotePathRef.current });
    } else {
      await openWindowInstance({ browseFolder });
    }
  }, [flushActiveNote, view, browseFolder]);

  useEffect(() => {
    bootLog("boot effect running");
    (async () => {
      try {
        await ensureNotesDir();
        bootLog("ensureNotesDir done");
        const target = getTargetFromLocation();
        bootLog("target resolved", target);

        if (target.notePath) {
          // The editor only needs notePath+content, not the tree - skip waiting on a full
          // directory walk (slow for a big vault) before showing the note, so a freshly
          // detached (or duplicated) window feels instant. Tree/search index load after.
          try {
            // A window spawned mid tab-drag gets its content handed off directly instead of
            // reading disk, in case the drag started before an in-flight edit had autosaved.
            const handoff = target.detached ? await detachInitPromise : null;
            bootLog("detachInitPromise resolved", { gotHandoff: handoff !== null });
            if (handoff !== null) {
              savedContentRef.current = handoff;
              setActiveNotePath(target.notePath);
              setActiveContent(handoff);
            } else {
              await selectNote(target.notePath);
              bootLog("selectNote (disk read) done");
            }
            setTabs([target.notePath]);
            setView("note");
            setMode("edit");
          } catch {
            // The requested note may have been deleted or moved since this
            // window was opened; fall back to the browse view.
          }
          bootLog("setting bootStatus ready");
          setBootStatus("ready");

          void (async () => {
            const initialTree = await refreshTree();
            await loadPersistedSearchIndex();
            await syncSearchIndex(initialTree);
            setSearchIndexReady(true);
          })();
          return;
        }

        const initialTree = await refreshTree();
        if (target.browseFolder !== undefined) {
          setBrowseFolder(target.browseFolder);
        } else if (isMainWindow) {
          const session = loadMainTabSession();
          const existingPaths = new Set(flattenNotes(initialTree).map((n) => n.path));
          const restoredTabs = session?.tabs.filter((p) => existingPaths.has(p)) ?? [];
          if (restoredTabs.length > 0) {
            setTabs(restoredTabs);
            const activePath =
              session?.activePath && restoredTabs.includes(session.activePath)
                ? session.activePath
                : restoredTabs[0];
            try {
              await selectNote(activePath);
              setView("note");
              setMode("edit");
            } catch {
              // Fall back to browse if even the first restored note can't be read.
            }
          }
        }
        setBootStatus("ready");

        // Runs after first paint so a cold, unindexed vault never delays
        // startup - search falls back to a plain title filter until this
        // resolves (see NotesBrowser), then switches over to the full index.
        void (async () => {
          await loadPersistedSearchIndex();
          await syncSearchIndex(initialTree);
          setSearchIndexReady(true);
        })();
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
        setBootStatus("error");
      }
    })();
    // Runs once on mount; refreshTree/selectNote are stable (ref-backed, no changing deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-window sync: when another window saves the note we currently have open, adopt
  // its content here too - otherwise each window keeps its own stale in-memory copy and
  // silently overwrites the other's changes on its next autosave. Skipped if this window
  // has local edits that haven't been persisted yet, to avoid clobbering active typing.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listenForNoteSaved((path, content) => {
        updateNoteInIndex(path, content);
        if (path !== activeNotePathRef.current) return;
        if (activeContentRef.current !== savedContentRef.current) return;
        savedContentRef.current = content;
        setActiveContent(content);
        setReloadToken((token) => token + 1);
      });
    })();
    return () => unlisten?.();
  }, []);

  // Cross-window tab merging, target side: another window's tab was dropped on this window's
  // tab strip (see TabStrip.tsx's finishDragOut) - adopt it as a new tab here, next to whatever
  // is currently active, using the handed-off content directly rather than reading disk.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      // `listen` defaults to receiving events addressed to *any* window - without this target
      // filter, every window (including whichever one sent the emitTo below) would receive
      // this, so the sender would immediately re-insert the tab it had just removed.
      unlisten = await listen<MergeTabPayload>(
        MERGE_TAB_EVENT,
        async (event) => {
          const { path, content } = event.payload;
          await flushActiveNote();
          setTabs((current) => insertTabNextToActive(current, activeNotePathRef.current, path));
          savedContentRef.current = content;
          setActiveNotePath(path);
          setActiveContent(content);
          setView("note");
          setMode("edit");
          await appWindow.setFocus();
        },
        { target: appWindow.label },
      );
    })();
    return () => unlisten?.();
  }, [flushActiveNote]);

  // Window chrome: track maximize state so the shell can go edge-to-edge,
  // and flush any pending edit before the window actually closes.
  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    (async () => {
      setIsMaximized(await appWindow.isMaximized());
      unlistenResize = await appWindow.onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
      });
      unlistenClose = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        await flushActiveNote();
        await appWindow.destroy();
      });
    })();
    return () => {
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [flushActiveNote]);

  const handleCreateNote = useCallback(
    async (parentPath: string, title?: string, templateId: string = "blank") => {
      await flushActiveNote();
      const template = getTemplate(templateId);
      const content = template.buildContent();
      const note = await createNote(parentPath, title, content, template.look);
      await refreshTree();
      addNoteToIndex(note.path, content);
      savedContentRef.current = content;
      setTabs((current) => insertTabNextToActive(current, activeNotePathRef.current, note.path));
      setActiveNotePath(note.path);
      setActiveContent(content);
      setMode("edit");
      setView("note");
    },
    [flushActiveNote, refreshTree],
  );

  const handleCreateFolder = useCallback(
    async (parentPath: string, name?: string, color?: string | null) => {
      await createFolder(parentPath, name, color);
      await refreshTree();
    },
    [refreshTree],
  );

  const promptNewNote = useCallback((parentPath: string) => {
    setNewItemDialog({ kind: "note", parentPath });
  }, []);

  const promptNewFolder = useCallback((parentPath: string) => {
    setNewItemDialog({ kind: "folder", parentPath });
  }, []);

  const handleRename = useCallback(
    async (path: string, isFolder: boolean, newTitle: string) => {
      try {
        const newPath = await renameEntry(path, newTitle, isFolder);
        await refreshTree();
        movePathInIndex(path, newPath);
        setTabs((current) => current.map((p) => remapTabPath(p, path, newPath)));
        const current = activeNotePathRef.current;
        if (current) {
          setActiveNotePath(remapTabPath(current, path, newPath));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [refreshTree],
  );

  const handleSetFolderColor = useCallback(
    async (path: string, color: string | null) => {
      try {
        await setFolderColor(path, color);
        await refreshTree();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Couldn't set folder color");
      }
    },
    [refreshTree],
  );

  const handleMove = useCallback(
    async (path: string, targetParentPath: string) => {
      try {
        const newPath = await moveEntry(path, targetParentPath);
        await refreshTree();
        movePathInIndex(path, newPath);
        setTabs((current) => current.map((p) => remapTabPath(p, path, newPath)));
        const current = activeNotePathRef.current;
        if (current) {
          setActiveNotePath(remapTabPath(current, path, newPath));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Move failed");
      }
    },
    [refreshTree],
  );

  async function performDelete(action: ConfirmAction) {
    try {
      if (action.kind === "delete-note") {
        await deleteNote(action.path);
      } else {
        await deleteFolder(action.path);
      }
      removePathFromIndex(action.path);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
    await refreshTree();
    const affected = (p: string) => p === action.path || p.startsWith(`${action.path}/`);
    const tabsBefore = tabsRef.current;
    const tabsAfter = tabsBefore.filter((p) => !affected(p));
    setTabs(tabsAfter);
    const current = activeNotePathRef.current;
    if (current && affected(current)) {
      const neighbor = neighborTabAfterRemoval(tabsBefore, current, tabsAfter);
      if (neighbor) {
        await selectNote(neighbor);
      } else if (!isMainWindow && tabsAfter.length === 0) {
        setConfirmAction(null);
        await appWindow.close();
        return;
      } else {
        setActiveNotePath(null);
        setActiveContent("");
        if (view === "note") setView("browse");
      }
    }
    setConfirmAction(null);
  }

  const activeNote = useMemo(
    () => flattenNotes(tree).find((n) => n.path === activeNotePath) ?? null,
    [tree, activeNotePath],
  );

  /** New-note action for the tab strip's "+" button: creates a sibling of the active tab's
   * note, or falls back to the folder being browsed if no note is open. */
  const handleNewNoteInActiveFolder = useCallback(() => {
    promptNewNote(activeNote ? activeNote.parentPath : browseFolder);
  }, [promptNewNote, activeNote, browseFolder]);

  const tabNotes = useMemo(() => {
    const byPath = new Map(flattenNotes(tree).map((n) => [n.path, n]));
    return tabs.map((path) => ({ path, title: byPath.get(path)?.title ?? path.split("/").pop() ?? path }));
  }, [tree, tabs]);

  // Global shortcuts: Cmd/Ctrl+N new note (sibling of the active note, if one is open),
  // Cmd/Ctrl+W close the active tab, Cmd/Ctrl+F focus search.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        promptNewNote(view === "note" && activeNote ? activeNote.parentPath : browseFolder);
      } else if (e.key.toLowerCase() === "w") {
        if (activeNotePathRef.current) {
          e.preventDefault();
          void handleCloseTab(activeNotePathRef.current);
        }
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("browse");
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [promptNewNote, browseFolder, view, activeNote, handleCloseTab]);

  return (
    <div className="h-screen w-screen">
      <div
        className={`app-shell @container relative flex h-full w-full flex-col overflow-hidden border transition-[border-radius] duration-150 ${
          isMaximized ? "rounded-none border-transparent" : "rounded-3xl border-subtle"
        }`}
      >
        <ResizeHandles />

        <Header
          view={view}
          onBack={handleBack}
          mode={mode}
          onModeChange={setMode}
          sketchMode={sketchMode}
          onToggleSketchMode={() => setSketchMode((v) => !v)}
          onDuplicateWindow={handleDuplicateWindow}
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
          toolbarVisible={toolbarVisible}
          onToggleToolbar={handleToggleToolbar}
          showFolderBack={view === "browse" && settings.notesViewMode === "grid" && !!browseFolder}
          onNavigateUp={() => setBrowseFolder(browseFolder.split("/").slice(0, -1).join("/"))}
          tabStrip={
            tabNotes.length > 0 ? (
              <TabStrip
                tabs={tabNotes}
                activeNotePath={view === "note" ? activeNotePath : null}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
                onReorderTabs={handleReorderTabs}
                onNewNote={handleNewNoteInActiveFolder}
                onPrepareDetach={handlePrepareDetach}
              />
            ) : undefined
          }
        />

        <div className="relative flex flex-1 overflow-hidden">
          {settingsOpen ? (
            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              onClose={() => setSettingsOpen(false)}
            />
          ) : (
            <main className="glass-panel shadow-app relative flex-1 overflow-hidden">
              {bootStatus === "loading" && (
                <div className="text-secondary flex h-full items-center justify-center text-sm">
                  Loading notes…
                </div>
              )}

              {bootStatus === "error" && (
                <div className="flex h-full items-center justify-center p-10 text-center">
                  <div className="border-danger-soft bg-danger-soft text-danger max-w-md rounded-2xl border p-6 text-sm">
                    <p className="font-medium">Couldn't access your notes folder</p>
                    <p className="mt-1 opacity-80">{bootError}</p>
                  </div>
                </div>
              )}

              {bootStatus === "ready" && view === "browse" && (
                <NotesBrowser
                  tree={tree}
                  browseFolder={browseFolder}
                  onNavigate={setBrowseFolder}
                  viewMode={settings.notesViewMode}
                  onViewModeChange={(notesViewMode) => setSettings((s) => ({ ...s, notesViewMode }))}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  searchIndexReady={searchIndexReady}
                  searchInputRef={searchInputRef}
                  onOpenNote={handleOpenNote}
                  onDuplicateNote={handleDuplicateNote}
                  onCreateNote={promptNewNote}
                  onCreateFolder={promptNewFolder}
                  onRename={handleRename}
                  onDeleteNote={(path, title) => setConfirmAction({ kind: "delete-note", path, title })}
                  onDeleteFolder={(path, title) => setConfirmAction({ kind: "delete-folder", path, title })}
                  onMove={handleMove}
                  onSetFolderColor={handleSetFolderColor}
                />
              )}

              {bootStatus === "ready" && view === "note" && activeNote && mode === "edit" && (
                <Editor
                  key={`${activeNote.path}:${reloadToken}`}
                  notePath={activeNote.path}
                  initialContent={activeContent}
                  onChange={setActiveContent}
                  onSave={async (content) => {
                    await writeNote(activeNote.path, content);
                    savedContentRef.current = content;
                    updateNoteInIndex(activeNote.path, content);
                    await broadcastNoteSaved(activeNote.path, content);
                  }}
                  toolbarVisible={toolbarVisible}
                  sketchMode={sketchMode}
                />
              )}

              {bootStatus === "ready" && view === "note" && activeNote && mode === "study" && (
                <StudyView key={activeNote.path} content={activeContent} />
              )}
            </main>
          )}
        </div>

        {confirmAction && (
          <ConfirmDialog
            title={
              confirmAction.kind === "delete-note"
                ? `Delete "${confirmAction.title}"?`
                : `Delete folder "${confirmAction.title}"?`
            }
            description={
              confirmAction.kind === "delete-note"
                ? "This cannot be undone."
                : "This deletes the folder and everything inside it. This cannot be undone."
            }
            confirmLabel="Delete"
            onConfirm={() => performDelete(confirmAction)}
            onCancel={() => setConfirmAction(null)}
          />
        )}

        {newItemDialog && (
          <NewItemDialog
            kind={newItemDialog.kind}
            defaultName={newItemDialog.kind === "folder" ? "New Folder" : "Untitled"}
            onCreate={(name, color, templateId) => {
              setNewItemDialog(null);
              if (newItemDialog.kind === "folder") {
                handleCreateFolder(newItemDialog.parentPath, name, color);
              } else {
                handleCreateNote(newItemDialog.parentPath, name, templateId);
              }
            }}
            onCancel={() => setNewItemDialog(null)}
          />
        )}

        {toast && (
          <div className="glass-surface shadow-app-lg animate-fade-in absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm">
            <span className="text-primary">{toast}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
