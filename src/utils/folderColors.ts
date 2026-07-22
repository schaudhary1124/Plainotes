/** Preset folder colors, offered as swatches in a folder's context menu (see Sidebar.tsx)
 * and the "new folder" dialog (see NewItemDialog.tsx). */
export const FOLDER_COLORS: { value: string; hex: string }[] = [
  { value: "red", hex: "#f43f5e" },
  { value: "orange", hex: "#f97316" },
  { value: "amber", hex: "#d97706" },
  { value: "green", hex: "#16a34a" },
  { value: "teal", hex: "#0d9488" },
  { value: "blue", hex: "#3b82f6" },
  { value: "indigo", hex: "#6366f1" },
  { value: "purple", hex: "#9333ea" },
  { value: "pink", hex: "#ec4899" },
  { value: "gray", hex: "#6b7280" },
];

export const FOLDER_COLOR_HEX: Record<string, string> = Object.fromEntries(
  FOLDER_COLORS.map((c) => [c.value, c.hex]),
);
