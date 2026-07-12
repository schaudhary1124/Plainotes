import { useEffect } from "react";
import { Check } from "lucide-react";
import type { AppSettings, BackgroundStyle, ThemeName } from "../types";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
}

const THEMES: { value: ThemeName; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "midnight", label: "Midnight" },
];

const BACKGROUNDS: { value: BackgroundStyle; label: string; description: string }[] = [
  { value: "flat", label: "Flat", description: "Solid surfaces, no blur" },
  { value: "soft", label: "Soft", description: "Gentle blur and depth" },
  { value: "glass", label: "Glass", description: "Translucent, heavier blur" },
];

const ACCENTS = [
  { value: "indigo", color: "rgb(99 102 241)" },
  { value: "violet", color: "rgb(139 92 246)" },
  { value: "blue", color: "rgb(59 130 246)" },
  { value: "rose", color: "rgb(244 63 94)" },
  { value: "amber", color: "rgb(217 119 6)" },
  { value: "emerald", color: "rgb(5 150 105)" },
];

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="glass-panel shadow-app animate-fade-in relative flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-md p-5 @max-sm:p-4">
        <div className="border-subtle mb-4 border-b pb-3">
          <p className="text-primary text-base font-semibold">Settings</p>
        </div>

        <div className="space-y-5">
          <section>
            <p className="text-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
              Theme
            </p>
            <div className="flex gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  onClick={() => onChange({ ...settings, theme: theme.value })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ${
                    settings.theme === theme.value
                      ? "border-accent-soft bg-accent-soft text-accent font-medium"
                      : "border-subtle text-secondary hover:bg-surface-hover"
                  }`}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
              Accent color
            </p>
            <div className="flex flex-wrap gap-3">
              {ACCENTS.map((accent) => {
                const selected = settings.accent === accent.value;
                return (
                  <button
                    key={accent.value}
                    type="button"
                    onClick={() => onChange({ ...settings, accent: accent.value })}
                    title={accent.value}
                    aria-label={`Accent ${accent.value}`}
                    aria-pressed={selected}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110"
                    style={{
                      backgroundColor: accent.color,
                      boxShadow: selected ? `0 0 0 2px var(--surface-strong), 0 0 0 4px ${accent.color}` : "none",
                    }}
                  >
                    {selected && <Check size={14} className="text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="text-secondary mb-2 text-xs font-semibold uppercase tracking-wider">
              Background style
            </p>
            <div className="space-y-1.5">
              {BACKGROUNDS.map((bg) => (
                <button
                  key={bg.value}
                  type="button"
                  onClick={() => onChange({ ...settings, background: bg.value })}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150 ${
                    settings.background === bg.value
                      ? "border-accent-soft bg-accent-soft"
                      : "border-subtle hover:bg-surface-hover"
                  }`}
                >
                  <span className="text-primary font-medium">{bg.label}</span>
                  <span className="text-tertiary text-xs">{bg.description}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
