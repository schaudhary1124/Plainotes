import type { AppMode } from "../types";

interface ModeToggleProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const isStudy = mode === "study";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isStudy}
      aria-label="Toggle between Edit and Study mode"
      onClick={() => onChange(isStudy ? "edit" : "study")}
      className="glass-surface relative flex h-8 w-[132px] shrink-0 items-center rounded-full p-1 text-xs font-medium"
    >
      <span
        className="absolute top-1 h-6 w-[62px] rounded-full bg-indigo-500/80 shadow-sm shadow-indigo-950/40 transition-transform duration-200 ease-out"
        style={{ transform: isStudy ? "translateX(62px)" : "translateX(0px)" }}
      />
      <span
        className={`z-10 flex-1 text-center transition-colors duration-150 ${
          isStudy ? "text-slate-400" : "text-white"
        }`}
      >
        Edit
      </span>
      <span
        className={`z-10 flex-1 text-center transition-colors duration-150 ${
          isStudy ? "text-white" : "text-slate-400"
        }`}
      >
        Study
      </span>
    </button>
  );
}
