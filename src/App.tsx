import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "./components/Header";
import { NotesBrowser } from "./components/NotesBrowser";
import { Editor } from "./components/Editor";
import { StudyView } from "./components/StudyView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NewItemDialog } from "./components/NewItemDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { ResizeHandles } from "./components/ResizeHandles";
import {
  STARTER_CONTENT,
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
import { applySettingsToDocument, loadSettings, saveSettings } from "./utils/settings";
import { getTargetFromLocation, openWindowInstance } from "./utils/windowInstance";
import { broadcastNoteSaved, listenForNoteSaved } from "./utils/noteSync";
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

function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
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

  const handleOpenNote = useCallback(
    async (path: string) => {
      await selectNote(path);
      setView("note");
      setMode("edit");
    },
    [selectNote],
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
    (async () => {
      try {
        await ensureNotesDir();
        const initialTree = await refreshTree();
        const target = getTargetFromLocation();
        if (target.notePath) {
          try {
            await selectNote(target.notePath);
            setView("note");
            setMode("edit");
          } catch {
            // The requested note may have been deleted or moved since this
            // window was opened; fall back to the browse view.
          }
        } else if (target.browseFolder !== undefined) {
          setBrowseFolder(target.browseFolder);
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
    async (parentPath: string, title?: string) => {
      await flushActiveNote();
      const note = await createNote(parentPath, title);
      await refreshTree();
      addNoteToIndex(note.path, STARTER_CONTENT);
      savedContentRef.current = STARTER_CONTENT;
      setActiveNotePath(note.path);
      setActiveContent(STARTER_CONTENT);
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
        const current = activeNotePathRef.current;
        if (current) {
          if (!isFolder && current === path) {
            setActiveNotePath(newPath);
          } else if (isFolder && current.startsWith(`${path}/`)) {
            setActiveNotePath(newPath + current.slice(path.length));
          }
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
        const current = activeNotePathRef.current;
        if (current) {
          if (current === path) {
            setActiveNotePath(newPath);
          } else if (current.startsWith(`${path}/`)) {
            setActiveNotePath(newPath + current.slice(path.length));
          }
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
    const current = activeNotePathRef.current;
    if (current && (current === action.path || current.startsWith(`${action.path}/`))) {
      setActiveNotePath(null);
      setActiveContent("");
      if (view === "note") setView("browse");
    }
    setConfirmAction(null);
  }

  // Global shortcuts: Cmd/Ctrl+N new note, Cmd/Ctrl+F focus search.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        promptNewNote(browseFolder);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("browse");
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [promptNewNote, browseFolder]);

  const activeNote = useMemo(
    () => flattenNotes(tree).find((n) => n.path === activeNotePath) ?? null,
    [tree, activeNotePath],
  );

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
            onCreate={(name, color) => {
              setNewItemDialog(null);
              if (newItemDialog.kind === "folder") {
                handleCreateFolder(newItemDialog.parentPath, name, color);
              } else {
                handleCreateNote(newItemDialog.parentPath, name);
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
