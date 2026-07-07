import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Pin, PinOff, Square, X } from "lucide-react";
import { ModeToggle } from "./ModeToggle";
import type { AppMode } from "../types";

interface HeaderProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  activeTitle: string | null;
}

const appWindow = getCurrentWindow();

export function Header({ mode, onModeChange, activeTitle }: HeaderProps) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  async function toggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    await appWindow.setAlwaysOnTop(next);
    setAlwaysOnTop(next);
  }

  return (
    <header
      data-tauri-drag-region
      className="glass-panel flex h-14 shrink-0 items-center gap-4 rounded-2xl px-4"
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-md bg-gradient-to-br from-indigo-400 to-violet-500 shadow-sm shadow-indigo-950/50" />
          <span className="text-sm font-semibold text-slate-100">
            PlaiNotes
          </span>
        </div>
        {activeTitle && (
          <>
            <span className="text-slate-600">/</span>
            <span className="truncate text-sm text-slate-400">
              {activeTitle}
            </span>
          </>
        )}
      </div>

      <ModeToggle mode={mode} onChange={onModeChange} />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleAlwaysOnTop}
          className={`btn-ghost h-8 w-8 ${
            alwaysOnTop ? "bg-indigo-500/20 text-indigo-300" : ""
          }`}
          title={alwaysOnTop ? "Disable always on top" : "Keep window on top"}
          aria-pressed={alwaysOnTop}
          aria-label="Toggle always on top"
        >
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>

        <div className="mx-1 h-5 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => appWindow.minimize()}
          className="btn-ghost h-8 w-8"
          title="Minimize"
          aria-label="Minimize window"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          className="btn-ghost h-8 w-8"
          title="Maximize"
          aria-label="Maximize window"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          className="btn-ghost h-8 w-8 hover:bg-rose-500/20 hover:text-rose-300"
          title="Close"
          aria-label="Close window"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
