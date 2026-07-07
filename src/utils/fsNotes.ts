import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { NoteSummary } from "../types";

/** Notes live under the user's OS Documents folder, e.g. ~/Documents/PlaiNotes */
export const NOTES_DIR = "PlaiNotes";
const NOTE_EXTENSION = ".md";

const STARTER_CONTENT = `# Untitled note

Start writing in Markdown. Switch to Study Mode and try the study syntax:

Q: What is the capital of France? -> A: Paris
MCQ: Which ocean is the largest? | Atlantic, Pacific, Indian, Arctic | Pacific
`;

function titleFromFileName(name: string): string {
  return name.endsWith(NOTE_EXTENSION)
    ? name.slice(0, -NOTE_EXTENSION.length)
    : name;
}

/** Creates the PlaiNotes folder in Documents on first run, if it doesn't exist yet. */
export async function ensureNotesDir(): Promise<void> {
  const dirExists = await exists(NOTES_DIR, {
    baseDir: BaseDirectory.Document,
  });
  if (!dirExists) {
    await mkdir(NOTES_DIR, { baseDir: BaseDirectory.Document, recursive: true });
  }
}

export async function listNotes(): Promise<NoteSummary[]> {
  const entries = await readDir(NOTES_DIR, { baseDir: BaseDirectory.Document });
  return entries
    .filter((entry) => entry.isFile && entry.name?.endsWith(NOTE_EXTENSION))
    .map((entry) => ({
      name: entry.name,
      title: titleFromFileName(entry.name),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function readNote(name: string): Promise<string> {
  return readTextFile(`${NOTES_DIR}/${name}`, {
    baseDir: BaseDirectory.Document,
  });
}

export function writeNote(name: string, content: string): Promise<void> {
  return writeTextFile(`${NOTES_DIR}/${name}`, content, {
    baseDir: BaseDirectory.Document,
  });
}

export function deleteNote(name: string): Promise<void> {
  return remove(`${NOTES_DIR}/${name}`, { baseDir: BaseDirectory.Document });
}

/** Creates a new note with a unique "Untitled" name and starter content. */
export async function createNote(
  existingNames: string[],
): Promise<NoteSummary> {
  const taken = new Set(existingNames);
  let name = `Untitled${NOTE_EXTENSION}`;
  let suffix = 2;
  while (taken.has(name)) {
    name = `Untitled ${suffix}${NOTE_EXTENSION}`;
    suffix += 1;
  }

  await writeNote(name, STARTER_CONTENT);
  return { name, title: titleFromFileName(name) };
}
