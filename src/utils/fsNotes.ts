import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FolderEntry, NoteEntry, NoteSummary, SketchData, TreeEntry } from "../types";

/** Notes live under the user's OS Documents folder, e.g. ~/Documents/PlaiNotes */
export const NOTES_DIR = "PlaiNotes";
const NOTE_EXTENSION = ".md";
// No leading dot: Tauri's fs scope glob matching (`PlaiNotes/**`) doesn't match dotfiles,
// which would silently block reads/writes under this folder. Hidden from the notes tree
// via an explicit name check in buildTree instead.
const ASSETS_DIR = "assets";
// Sibling file next to the note (not a dot-directory): Tauri's fs scope glob matching
// (`PlaiNotes/**`) doesn't match dotfiles, which would silently block reads/writes -
// see the META_FILE note below. A same-folder sidecar with a non-".md" extension is
// already invisible to buildTree without needing a leading dot.
const SKETCH_EXTENSION = ".sketch.json";
// No leading dot: Tauri's fs scope glob matching (`PlaiNotes/**`) doesn't match dotfiles,
// which would silently block reads/writes of this file.
const META_FILE = "plainotes-meta.json";
// No leading dot, same reasoning as META_FILE above. This is a cache the search
// index rebuilds from if missing or unreadable, so it's fine to skip it silently.
const SEARCH_INDEX_FILE = "plainotes-search-index.json";
const BASE_DIR = BaseDirectory.Document;

export const STARTER_CONTENT = "";

interface NotesMeta {
  /** Maps a folder's relative path to a preset color name from FOLDER_COLORS */
  folderColors: Record<string, string>;
}

async function readMeta(): Promise<NotesMeta> {
  try {
    const raw = await readTextFile(fullPath(META_FILE), { baseDir: BASE_DIR });
    const parsed = JSON.parse(raw);
    return { folderColors: parsed.folderColors ?? {} };
  } catch {
    return { folderColors: {} };
  }
}

function writeMeta(meta: NotesMeta): Promise<void> {
  return writeTextFile(fullPath(META_FILE), JSON.stringify(meta, null, 2), { baseDir: BASE_DIR });
}

/** Reads the persisted search index cache, or null if it doesn't exist yet / is unreadable. */
export async function readSearchIndexFile(): Promise<string | null> {
  try {
    return await readTextFile(fullPath(SEARCH_INDEX_FILE), { baseDir: BASE_DIR });
  } catch {
    return null;
  }
}

export function writeSearchIndexFile(json: string): Promise<void> {
  return writeTextFile(fullPath(SEARCH_INDEX_FILE), json, { baseDir: BASE_DIR });
}

/** Last-modified time of a note, in epoch ms - used to detect notes changed outside the app. */
export async function noteMtimeMs(notePath: string): Promise<number> {
  const info = await stat(fullPath(notePath), { baseDir: BASE_DIR });
  return info.mtime?.getTime() ?? 0;
}

/** Repoints any folderColors entries under `oldPath` to `newPath`, for renames/moves. */
function remapMetaPaths(meta: NotesMeta, oldPath: string, newPath: string): NotesMeta {
  const folderColors: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta.folderColors)) {
    if (key === oldPath) folderColors[newPath] = value;
    else if (key.startsWith(`${oldPath}/`)) folderColors[newPath + key.slice(oldPath.length)] = value;
    else folderColors[key] = value;
  }
  return { folderColors };
}

/** Drops any folderColors entries at or under `path`, for deletions. */
function dropMetaPaths(meta: NotesMeta, path: string): NotesMeta {
  const folderColors: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta.folderColors)) {
    if (key === path || key.startsWith(`${path}/`)) continue;
    folderColors[key] = value;
  }
  return { folderColors };
}

/** Sets (or clears, when `color` is null) the preset color for the folder at `path`. */
export async function setFolderColor(path: string, color: string | null): Promise<void> {
  const meta = await readMeta();
  if (color) meta.folderColors[path] = color;
  else delete meta.folderColors[path];
  await writeMeta(meta);
}

function titleFromFileName(name: string): string {
  return name.endsWith(NOTE_EXTENSION) ? name.slice(0, -NOTE_EXTENSION.length) : name;
}

/** Derives a note's display title straight from its path, e.g. "Work/Todo.md" -> "Todo". */
export function titleFromNotePath(notePath: string): string {
  return titleFromFileName(nameOf(notePath));
}

function fullPath(relPath: string): string {
  return relPath ? `${NOTES_DIR}/${relPath}` : NOTES_DIR;
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

function nameOf(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Sidecar ink path for a note, e.g. "Work/Todo.md" -> "Work/Todo.sketch.json" */
function sketchPathFor(notePath: string): string {
  return notePath.slice(0, -NOTE_EXTENSION.length) + SKETCH_EXTENSION;
}

/** Creates the PlaiNotes folder in Documents on first run, if it doesn't exist yet. */
export async function ensureNotesDir(): Promise<void> {
  const dirExists = await exists(NOTES_DIR, { baseDir: BASE_DIR });
  if (!dirExists) {
    await mkdir(NOTES_DIR, { baseDir: BASE_DIR, recursive: true });
  }
}

async function buildTree(relDir: string, folderColors: Record<string, string>): Promise<TreeEntry[]> {
  const entries = await readDir(fullPath(relDir), { baseDir: BASE_DIR });
  const relevant = entries.filter((entry) => {
    if (!entry.name || entry.name.startsWith(".")) return false;
    if (relDir === "" && entry.name === ASSETS_DIR) return false;
    return entry.isDirectory || (entry.isFile && entry.name.endsWith(NOTE_EXTENSION));
  });

  // Subdirectories are read in parallel rather than one at a time: each
  // readDir is a Tauri IPC round-trip, and awaiting them sequentially made
  // the walk's latency scale with total folder count instead of tree depth.
  const result = await Promise.all(
    relevant.map(async (entry): Promise<TreeEntry> => {
      const relPath = joinPath(relDir, entry.name);
      if (entry.isDirectory) {
        const children = await buildTree(relPath, folderColors);
        const folder: FolderEntry = {
          type: "folder",
          path: relPath,
          title: entry.name,
          parentPath: relDir,
          children,
          color: folderColors[relPath],
        };
        return folder;
      }
      const note: NoteEntry = {
        type: "note",
        path: relPath,
        title: titleFromFileName(entry.name),
        parentPath: relDir,
      };
      return note;
    }),
  );

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return result;
}

/** Recursively reads the notes folder into a tree of folders and notes. */
export async function listNoteTree(): Promise<TreeEntry[]> {
  const meta = await readMeta();
  return buildTree("", meta.folderColors);
}

export function flattenNotes(tree: TreeEntry[]): NoteSummary[] {
  const notes: NoteSummary[] = [];
  for (const entry of tree) {
    if (entry.type === "note") {
      notes.push({ path: entry.path, title: entry.title, parentPath: entry.parentPath });
    } else {
      notes.push(...flattenNotes(entry.children));
    }
  }
  return notes;
}

export function readNote(path: string): Promise<string> {
  return readTextFile(fullPath(path), { baseDir: BASE_DIR });
}

export function writeNote(path: string, content: string): Promise<void> {
  return writeTextFile(fullPath(path), content, { baseDir: BASE_DIR });
}

export async function deleteNote(path: string): Promise<void> {
  await remove(fullPath(path), { baseDir: BASE_DIR });
  await deleteSketch(path);
}

export async function deleteFolder(path: string): Promise<void> {
  await remove(fullPath(path), { baseDir: BASE_DIR, recursive: true });
  const meta = await readMeta();
  await writeMeta(dropMetaPaths(meta, path));
}

async function uniqueName(parentPath: string, base: string, ext: string): Promise<string> {
  const dirExists = await exists(fullPath(parentPath), { baseDir: BASE_DIR });
  const taken = new Set<string>();
  if (dirExists) {
    const entries = await readDir(fullPath(parentPath), { baseDir: BASE_DIR });
    entries.forEach((entry) => entry.name && taken.add(entry.name));
  }

  let name = `${base}${ext}`;
  let suffix = 2;
  while (taken.has(name)) {
    name = `${base} ${suffix}${ext}`;
    suffix += 1;
  }
  return name;
}

/** All note titles currently in use across the whole vault, optionally excluding one path. */
async function allNoteTitles(excludePath?: string): Promise<Set<string>> {
  const tree = await listNoteTree();
  const titles = new Set<string>();
  for (const note of flattenNotes(tree)) {
    if (note.path === excludePath) continue;
    titles.add(note.title);
  }
  return titles;
}

/** Creates a new note with a unique name (unique across the whole vault) inside `parentPath`. */
export async function createNote(parentPath: string, desiredTitle?: string): Promise<NoteSummary> {
  const taken = await allNoteTitles();
  const base = desiredTitle?.trim() || "Untitled";
  let title = base;
  let suffix = 2;
  while (taken.has(title)) {
    title = `${base} ${suffix}`;
    suffix += 1;
  }

  const name = `${title}${NOTE_EXTENSION}`;
  const relPath = joinPath(parentPath, name);
  await writeNote(relPath, STARTER_CONTENT);
  return { path: relPath, title, parentPath };
}

/** Creates a new folder with a unique name inside `parentPath`, optionally with a preset color. */
export async function createFolder(
  parentPath: string,
  desiredName?: string,
  color?: string | null,
): Promise<string> {
  const base = desiredName?.trim() || "New Folder";
  const name = await uniqueName(parentPath, base, "");
  const relPath = joinPath(parentPath, name);
  await mkdir(fullPath(relPath), { baseDir: BASE_DIR, recursive: true });
  if (color) await setFolderColor(relPath, color);
  return relPath;
}

/** Renames a note or folder in place, keeping it in the same parent folder. */
export async function renameEntry(
  path: string,
  newTitle: string,
  isFolder: boolean,
): Promise<string> {
  const trimmed = newTitle.trim();
  if (!trimmed) throw new Error("Name cannot be empty");

  const parent = parentOf(path);
  const newName = isFolder ? trimmed : `${trimmed}${NOTE_EXTENSION}`;
  const newPath = joinPath(parent, newName);
  if (newPath === path) return path;

  if (isFolder) {
    const clash = await exists(fullPath(newPath), { baseDir: BASE_DIR });
    if (clash) throw new Error(`"${trimmed}" already exists here`);
  } else {
    const taken = await allNoteTitles(path);
    if (taken.has(trimmed)) throw new Error(`A note named "${trimmed}" already exists`);
  }

  await rename(fullPath(path), fullPath(newPath), {
    oldPathBaseDir: BASE_DIR,
    newPathBaseDir: BASE_DIR,
  });

  if (isFolder) {
    const meta = await readMeta();
    await writeMeta(remapMetaPaths(meta, path, newPath));
  } else {
    await relocateSketch(path, newPath);
  }

  return newPath;
}

/** Moves a note or folder to live under `targetParentPath`. */
export async function moveEntry(path: string, targetParentPath: string): Promise<string> {
  const name = nameOf(path);
  const newPath = joinPath(targetParentPath, name);
  if (newPath === path) return path;
  if (targetParentPath === path || targetParentPath.startsWith(`${path}/`)) {
    throw new Error("Can't move a folder into itself");
  }

  if (path.endsWith(NOTE_EXTENSION)) {
    const title = titleFromFileName(name);
    const taken = await allNoteTitles(path);
    if (taken.has(title)) throw new Error(`A note named "${title}" already exists`);
  } else {
    const clash = await exists(fullPath(newPath), { baseDir: BASE_DIR });
    if (clash) throw new Error(`"${name}" already exists in that folder`);
  }

  await rename(fullPath(path), fullPath(newPath), {
    oldPathBaseDir: BASE_DIR,
    newPathBaseDir: BASE_DIR,
  });

  if (!path.endsWith(NOTE_EXTENSION)) {
    const meta = await readMeta();
    await writeMeta(remapMetaPaths(meta, path, newPath));
  } else {
    await relocateSketch(path, newPath);
  }

  return newPath;
}

/** Moves a note's ink sidecar (if any) alongside a rename/move of the note itself. */
async function relocateSketch(oldNotePath: string, newNotePath: string): Promise<void> {
  const oldSketchPath = fullPath(sketchPathFor(oldNotePath));
  const sketchExists = await exists(oldSketchPath, { baseDir: BASE_DIR });
  if (!sketchExists) return;
  const newSketchPath = sketchPathFor(newNotePath);
  await mkdir(fullPath(parentOf(newSketchPath)), { baseDir: BASE_DIR, recursive: true });
  await rename(oldSketchPath, fullPath(newSketchPath), {
    oldPathBaseDir: BASE_DIR,
    newPathBaseDir: BASE_DIR,
  });
}

/** Reads a note's ink strokes, or null if it has none. */
export async function readSketch(notePath: string): Promise<SketchData | null> {
  try {
    const raw = await readTextFile(fullPath(sketchPathFor(notePath)), { baseDir: BASE_DIR });
    return JSON.parse(raw) as SketchData;
  } catch {
    return null;
  }
}

/** Persists a note's ink strokes to its sidecar file. */
export async function writeSketch(notePath: string, data: SketchData): Promise<void> {
  const relPath = sketchPathFor(notePath);
  await mkdir(fullPath(parentOf(relPath)), { baseDir: BASE_DIR, recursive: true });
  await writeTextFile(fullPath(relPath), JSON.stringify(data), { baseDir: BASE_DIR });
}

/** Removes a note's ink sidecar, if any. */
export async function deleteSketch(notePath: string): Promise<void> {
  try {
    await remove(fullPath(sketchPathFor(notePath)), { baseDir: BASE_DIR });
  } catch {
    // No sketch existed for this note - nothing to clean up.
  }
}

/** Saves an image attachment for `notePath` and returns its path relative to the notes root. */
export async function writeAttachment(
  notePath: string,
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  const parent = parentOf(notePath);
  const assetsFolder = joinPath(ASSETS_DIR, parent);
  await mkdir(fullPath(assetsFolder), { baseDir: BASE_DIR, recursive: true });

  const unique = `${crypto.randomUUID()}-${fileName}`;
  const relPath = joinPath(assetsFolder, unique);
  await writeFile(fullPath(relPath), data, { baseDir: BASE_DIR });
  return relPath;
}

export function readAttachment(relPath: string): Promise<Uint8Array> {
  return readFile(fullPath(relPath), { baseDir: BASE_DIR });
}
