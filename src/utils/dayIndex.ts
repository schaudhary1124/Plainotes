import type { NoteSummary } from "../types";

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export interface DayNoteRef {
  note: NoteSummary;
  kind: "created" | "edited";
}

/** Buckets notes by every local calendar day they touched - a note edited on a different day
 * than it was created gets an entry (and a dot) on both days, not just one. */
export function buildDayIndex(notes: NoteSummary[]): Map<string, DayNoteRef[]> {
  const map = new Map<string, DayNoteRef[]>();
  const add = (key: string, ref: DayNoteRef) => {
    const list = map.get(key);
    if (list) list.push(ref);
    else map.set(key, [ref]);
  };
  for (const note of notes) {
    const createdKey = note.createdAt != null ? dayKey(new Date(note.createdAt)) : null;
    const modifiedKey = note.modifiedAt != null ? dayKey(new Date(note.modifiedAt)) : null;
    if (modifiedKey) add(modifiedKey, { note, kind: "edited" });
    if (createdKey && createdKey !== modifiedKey) add(createdKey, { note, kind: "created" });
  }
  return map;
}
