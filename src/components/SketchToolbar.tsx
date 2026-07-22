import { useState } from "react";
import { Brush, Eraser, Highlighter, PenTool, Redo2, Trash2, Undo2 } from "lucide-react";
import type { SketchTool } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

/** Line width in CSS pixels (pen/highlighter) or erase radius (eraser) for
 * each of the toolbar's three size presets, per tool. */
export const SKETCH_TOOL_SIZES: Record<SketchTool, number[]> = {
  pen: [3, 6, 10],
  highlighter: [12, 18, 26],
  eraser: [14, 24, 36],
};

export const SKETCH_COLORS = [
  { label: "Blue", value: "#3b82f6" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Purple", value: "#a855f7" },
  { label: "Ink", value: "#1c1c1e" },
];

export const DEFAULT_SKETCH_COLOR = SKETCH_COLORS[0].value;

interface SketchToolbarProps {
  tool: SketchTool;
  onToolChange: (tool: SketchTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  sizeIndex: number;
  onSizeIndexChange: (index: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExit: () => void;
}

const TOOLS: { tool: SketchTool; label: string; icon: typeof PenTool }[] = [
  { tool: "pen", label: "Pen", icon: PenTool },
  { tool: "highlighter", label: "Highlighter", icon: Highlighter },
  { tool: "eraser", label: "Eraser", icon: Eraser },
];

export function SketchToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  sizeIndex,
  onSizeIndexChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExit,
}: SketchToolbarProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="border-subtle flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
      <button
        type="button"
        onClick={onExit}
        title="Exit sketch mode"
        aria-label="Exit sketch mode"
        aria-pressed="true"
        className="btn-ghost bg-accent-soft text-accent h-7 w-7 shrink-0"
      >
        <Brush size={14} />
      </button>

      <div className="divider mx-1 h-5 w-px shrink-0" />

      {TOOLS.map(({ tool: t, label, icon: Icon }) => (
        <button
          key={t}
          type="button"
          onClick={() => onToolChange(t)}
          title={label}
          aria-label={label}
          aria-pressed={tool === t}
          className={`btn-ghost h-7 w-7 shrink-0 ${tool === t ? "bg-accent-soft text-accent" : ""}`}
        >
          <Icon size={14} />
        </button>
      ))}

      <div className="divider mx-1 h-5 w-px shrink-0" />

      {tool !== "eraser" &&
        SKETCH_COLORS.map((c) => (
          <button
            key={c.label}
            type="button"
            title={c.label}
            aria-label={c.label}
            aria-pressed={color === c.value}
            className={`h-5 w-5 shrink-0 rounded-full border transition-transform duration-100 ${
              color === c.value ? "border-accent-soft scale-110" : "border-subtle-strong"
            }`}
            style={{ background: c.value }}
            onClick={() => onColorChange(c.value)}
          />
        ))}

      {tool !== "eraser" && <div className="divider mx-1 h-5 w-px shrink-0" />}

      <div className="flex shrink-0 items-center gap-1">
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            title={["Thin", "Medium", "Thick"][i]}
            aria-label={["Thin", "Medium", "Thick"][i]}
            aria-pressed={sizeIndex === i}
            onClick={() => onSizeIndexChange(i)}
            className={`btn-ghost flex h-7 w-7 shrink-0 items-center justify-center ${
              sizeIndex === i ? "bg-accent-soft text-accent" : ""
            }`}
          >
            <span
              className="rounded-full bg-current"
              style={{ width: 4 + i * 3, height: 4 + i * 3 }}
            />
          </button>
        ))}
      </div>

      <div className="divider mx-1 h-5 w-px shrink-0" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        aria-label="Undo"
        className="btn-ghost h-7 w-7 shrink-0 disabled:opacity-30"
      >
        <Undo2 size={14} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        aria-label="Redo"
        className="btn-ghost h-7 w-7 shrink-0 disabled:opacity-30"
      >
        <Redo2 size={14} />
      </button>

      <div className="divider mx-1 h-5 w-px shrink-0" />

      <button
        type="button"
        onClick={() => setConfirmClear(true)}
        title="Clear page"
        aria-label="Clear page"
        className="btn-ghost h-7 w-7 shrink-0 hover:text-danger"
      >
        <Trash2 size={14} />
      </button>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all ink on this page?"
          description="This removes every stroke you've drawn on this note. This cannot be undone once you leave the note."
          confirmLabel="Clear"
          onConfirm={() => {
            onClear();
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
