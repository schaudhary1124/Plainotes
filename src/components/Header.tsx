import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Brush,
  Copy,
  Minus,
  PanelTopClose,
  PanelTopOpen,
  Pin,
  PinOff,
  Settings,
  Square,
  X,
} from "lucide-react";
import { ModeToggle } from "./ModeToggle";
import type { AppMode } from "../types";

interface HeaderProps {
  view: "browse" | "note";
  onBack: () => void;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  sketchMode: boolean;
  onToggleSketchMode: () => void;
  onDuplicateWindow: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  toolbarVisible: boolean;
  onToggleToolbar: () => void;
  showFolderBack: boolean;
  onNavigateUp: () => void;
  /** The open-tabs strip, rendered left-aligned next to the back button. */
  tabStrip?: React.ReactNode;
}

const appWindow = getCurrentWindow();

export function Header({
  view,
  onBack,
  mode,
  onModeChange,
  sketchMode,
  onToggleSketchMode,
  onDuplicateWindow,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  toolbarVisible,
  onToggleToolbar,
  showFolderBack,
  onNavigateUp,
  tabStrip,
}: HeaderProps) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  async function toggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    await appWindow.setAlwaysOnTop(next);
    setAlwaysOnTop(next);
  }

  return (
    <header
      data-tauri-drag-region
      className="glass-panel relative z-20 flex h-10 shrink-0 items-center gap-1.5 px-2.5 @max-sm:gap-1 @max-sm:px-2"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-1.5">
        {settingsOpen ? (
          <button
            type="button"
            onClick={onCloseSettings}
            className="btn-ghost h-6 w-6"
            title="Exit settings"
            aria-label="Exit settings"
          >
            <ArrowLeft size={15} />
          </button>
        ) : (
          <>
            {view === "note" ? (
              <button
                type="button"
                onClick={onBack}
                className="btn-ghost h-6 w-6 shrink-0"
                title="Back to notes"
                aria-label="Back to notes"
              >
                <ArrowLeft size={15} />
              </button>
            ) : (
              showFolderBack && (
                <button
                  type="button"
                  onClick={onNavigateUp}
                  className="btn-ghost h-6 w-6 shrink-0"
                  title="Back"
                  aria-label="Back to parent folder"
                >
                  <ArrowLeft size={15} />
                </button>
              )
            )}
            {tabStrip}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        {!settingsOpen && (
          <>
            {view === "note" && <ModeToggle mode={mode} onChange={onModeChange} />}
            {view === "note" && mode === "edit" && (
              <button
                type="button"
                onClick={onToggleSketchMode}
                className={`btn-ghost h-6 w-6 ${sketchMode ? "bg-accent-soft text-accent" : ""}`}
                title={sketchMode ? "Exit sketch mode" : "Sketch on this note"}
                aria-pressed={sketchMode}
                aria-label="Toggle sketch mode"
              >
                <Brush size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSettings}
              className="btn-ghost h-6 w-6"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={15} />
            </button>
            {view === "note" && mode === "edit" && (
              <button
                type="button"
                onClick={onToggleToolbar}
                className={`btn-ghost h-6 w-6 ${!toolbarVisible ? "bg-accent-soft text-accent" : ""}`}
                title={toolbarVisible ? "Hide formatting toolbar" : "Show formatting toolbar"}
                aria-pressed={!toolbarVisible}
                aria-label="Toggle formatting toolbar"
              >
                {toolbarVisible ? <PanelTopClose size={15} /> : <PanelTopOpen size={15} />}
              </button>
            )}
            <button
              type="button"
              onClick={onDuplicateWindow}
              className="btn-ghost h-6 w-6"
              title={view === "note" ? "Open this note in a new window" : "Open a new window"}
              aria-label="Duplicate window"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              onClick={toggleAlwaysOnTop}
              className={`btn-ghost h-6 w-6 ${alwaysOnTop ? "bg-accent-soft text-accent" : ""}`}
              title={alwaysOnTop ? "Disable always on top" : "Keep window on top"}
              aria-pressed={alwaysOnTop}
              aria-label="Toggle always on top"
            >
              {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
            </button>

            <div className="divider mx-0.5 h-5 w-px" />
          </>
        )}

        <button
          type="button"
          onClick={() => appWindow.minimize()}
          className="btn-ghost h-6 w-6"
          title="Minimize"
          aria-label="Minimize window"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          className="btn-ghost h-6 w-6"
          title="Maximize"
          aria-label="Maximize window"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          className="btn-ghost h-6 w-6 hover:bg-red-500/20 hover:text-red-500"
          title="Close"
          aria-label="Close window"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
