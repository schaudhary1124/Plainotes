import { FileText, Plus, Trash2 } from "lucide-react";
import type { NoteSummary } from "../types";

interface SidebarProps {
  notes: NoteSummary[];
  activeNoteName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
}

export function Sidebar({
  notes,
  activeNoteName,
  onSelect,
  onCreate,
  onDelete,
}: SidebarProps) {
  return (
    <aside className="glass-panel flex h-full w-64 shrink-0 flex-col rounded-2xl">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Notes
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="btn-ghost h-7 w-7"
          title="New note"
          aria-label="New note"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {notes.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-500">
            No notes yet. Create your first one.
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {notes.map((note) => {
            const isActive = note.name === activeNoteName;
            return (
              <li key={note.name}>
                <div
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
                    isActive
                      ? "bg-indigo-500/15 text-slate-50"
                      : "text-slate-300/80 hover:bg-white/[0.06] hover:text-slate-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(note.name)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <FileText
                      size={14}
                      className={isActive ? "text-indigo-300" : "text-slate-500"}
                    />
                    <span className="truncate">{note.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(note.name)}
                    className="btn-ghost h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                    title="Delete note"
                    aria-label={`Delete ${note.title}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
