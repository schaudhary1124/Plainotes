import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { FOLDER_COLORS } from "../utils/folderColors";

interface NewItemDialogProps {
  kind: "note" | "folder";
  defaultName: string;
  onCreate: (name: string, color: string | null) => void;
  onCancel: () => void;
}

export function NewItemDialog({ kind, defaultName, onCreate, onCancel }: NewItemDialogProps) {
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleCreate() {
    onCreate(name.trim() || defaultName, color);
  }

  return (
    <div
      className="animate-fade-in absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="glass-surface shadow-app-lg w-full max-w-sm rounded-2xl p-5 @max-sm:p-4">
        <p className="text-primary text-base font-semibold">
          {kind === "folder" ? "New folder" : "New note"}
        </p>
        <p className="text-secondary mt-1.5 text-sm leading-relaxed">
          {kind === "folder" ? "Name your folder and pick a color." : "Name your note, or keep the default."}
        </p>

        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") onCancel();
          }}
          className="border-subtle bg-surface-hover text-primary mt-4 h-9 w-full rounded-lg border px-3 text-sm focus:outline-none"
          placeholder={defaultName}
        />

        {kind === "folder" && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setColor(null)}
              title="No color"
              aria-label="No color"
              aria-pressed={color === null}
              className="border-subtle-strong flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-transform duration-150 hover:scale-110"
              style={{
                boxShadow:
                  color === null
                    ? "0 0 0 2px var(--surface-strong), 0 0 0 3.5px rgb(var(--accent-rgb))"
                    : "none",
              }}
            >
              {color === null && <Check size={12} className="text-tertiary" strokeWidth={3} />}
            </button>
            {FOLDER_COLORS.map((c) => {
              const selected = color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.value}
                  aria-label={`Color ${c.value}`}
                  aria-pressed={selected}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110"
                  style={{
                    backgroundColor: c.hex,
                    boxShadow: selected ? `0 0 0 2px var(--surface-strong), 0 0 0 3.5px ${c.hex}` : "none",
                  }}
                >
                  {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost h-9 rounded-lg px-4 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            autoFocus
            className="bg-accent-solid h-9 rounded-lg px-4 text-sm font-medium text-white transition-colors duration-150 hover:brightness-110"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
