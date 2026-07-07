import { useCallback, useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { StudyView } from "./components/StudyView";
import {
  createNote,
  deleteNote,
  ensureNotesDir,
  listNotes,
  readNote,
  writeNote,
} from "./utils/fsNotes";
import type { AppMode, NoteSummary } from "./types";

type BootStatus = "loading" | "ready" | "error";

function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [activeNoteName, setActiveNoteName] = useState<string | null>(null);
  const [activeContent, setActiveContent] = useState("");
  const [mode, setMode] = useState<AppMode>("edit");

  const selectNote = useCallback(async (name: string) => {
    const content = await readNote(name);
    setActiveNoteName(name);
    setActiveContent(content);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await ensureNotesDir();
        const list = await listNotes();
        setNotes(list);
        if (list.length > 0) {
          await selectNote(list[0].name);
        }
        setBootStatus("ready");
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
        setBootStatus("error");
      }
    })();
  }, [selectNote]);

  async function handleCreate() {
    const newNote = await createNote(notes.map((note) => note.name));
    setNotes((prev) =>
      [...prev, newNote].sort((a, b) => a.title.localeCompare(b.title)),
    );
    await selectNote(newNote.name);
    setMode("edit");
  }

  async function handleDelete(name: string) {
    const note = notes.find((n) => n.name === name);
    const confirmed = window.confirm(
      `Delete "${note?.title ?? name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    await deleteNote(name);
    const remaining = notes.filter((n) => n.name !== name);
    setNotes(remaining);

    if (activeNoteName === name) {
      if (remaining.length > 0) {
        await selectNote(remaining[0].name);
      } else {
        setActiveNoteName(null);
        setActiveContent("");
      }
    }
  }

  const activeNote = notes.find((note) => note.name === activeNoteName) ?? null;

  return (
    <div className="h-screen w-screen p-3">
      <div
        className="relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-3xl border border-white/10 p-3 shadow-2xl shadow-black/50"
        style={{
          backgroundImage: [
            "radial-gradient(1200px 500px at 15% -10%, rgba(99,102,241,0.20), transparent 60%)",
            "radial-gradient(900px 500px at 100% 10%, rgba(168,85,247,0.14), transparent 55%)",
            "linear-gradient(180deg, #0b0c14 0%, #0a0a10 100%)",
          ].join(", "),
        }}
      >
        <Header
          mode={mode}
          onModeChange={setMode}
          activeTitle={activeNote?.title ?? null}
        />

        <div className="flex flex-1 gap-3 overflow-hidden">
          <Sidebar
            notes={notes}
            activeNoteName={activeNoteName}
            onSelect={selectNote}
            onCreate={handleCreate}
            onDelete={handleDelete}
          />

          <main className="glass-panel relative flex-1 overflow-hidden rounded-2xl">
            {bootStatus === "loading" && (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Loading notes…
              </div>
            )}

            {bootStatus === "error" && (
              <div className="flex h-full items-center justify-center p-10 text-center">
                <div className="max-w-md rounded-2xl border border-rose-400/20 bg-rose-500/10 p-6 text-sm text-rose-200">
                  <p className="font-medium">Couldn't access your notes folder</p>
                  <p className="mt-1 text-rose-200/70">{bootError}</p>
                </div>
              </div>
            )}

            {bootStatus === "ready" && !activeNote && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-slate-400">
                  No note selected yet.
                </p>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="btn-ghost h-9 rounded-lg bg-indigo-500/20 px-4 text-sm text-indigo-200 hover:bg-indigo-500/30"
                >
                  Create your first note
                </button>
              </div>
            )}

            {bootStatus === "ready" &&
              activeNote &&
              (mode === "edit" ? (
                <Editor
                  key={activeNote.name}
                  initialContent={activeContent}
                  onChange={setActiveContent}
                  onSave={(content) => writeNote(activeNote.name, content)}
                />
              ) : (
                <StudyView key={activeNote.name} content={activeContent} />
              ))}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
