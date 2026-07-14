import MiniSearch, { type MatchInfo, type Options } from "minisearch";
import type { TreeEntry } from "../types";
import {
  flattenNotes,
  noteMtimeMs,
  readNote,
  readSearchIndexFile,
  titleFromNotePath,
  writeSearchIndexFile,
} from "./fsNotes";

interface IndexedDoc {
  id: string;
  title: string;
  content: string;
}

interface PersistedState {
  version: number;
  mtimes: Record<string, number>;
  index: unknown;
}

/** Shape returned by `getStoredFields` - everything in IndexedDoc except `id`,
 * which is the lookup key rather than a stored field. */
type StoredDoc = Pick<IndexedDoc, "title" | "content">;

/** Bump if IndexedDoc's shape or MiniSearch options change, to invalidate old caches. */
const INDEX_VERSION = 1;

const MINISEARCH_OPTIONS: Options<IndexedDoc> = {
  idField: "id",
  fields: ["title", "content"],
  storeFields: ["title", "content"],
  searchOptions: {
    // Title matches dominate ranking; body matches still surface when there's
    // no good title hit, which is the "remembered the content, not the name" case.
    boost: { title: 6 },
    // 0.3 (rather than MiniSearch's typical 0.2) so common one-key-swap typos
    // like "grocrey" for "grocery" - a 2-edit transposition under plain
    // Levenshtein distance - still resolve, not just single-character typos.
    // Skipped entirely for terms under 4 characters: short words have too
    // many equally-close neighbors (fuzzy-matching "aws" landed on "as",
    // a false positive) for edit-distance tolerance to be useful there.
    fuzzy: (term) => (term.length >= 4 ? 0.3 : false),
    prefix: true,
  },
};

function createEngine(): MiniSearch<IndexedDoc> {
  return new MiniSearch<IndexedDoc>(MINISEARCH_OPTIONS);
}

let engine = createEngine();
// Mirrors which paths are currently indexed and when they were last read, so
// a cold start only re-reads notes whose content actually changed since the
// index was last persisted, instead of re-scanning the whole vault.
let mtimes = new Map<string, number>();
let ready = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether the index has completed at least one build/reconciliation this session. */
export function isSearchIndexReady(): boolean {
  return ready;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 2000);
}

async function persist(): Promise<void> {
  const state: PersistedState = {
    version: INDEX_VERSION,
    mtimes: Object.fromEntries(mtimes),
    index: engine.toJSON(),
  };
  await writeSearchIndexFile(JSON.stringify(state));
}

function upsert(doc: IndexedDoc, mtime: number) {
  if (engine.has(doc.id)) engine.replace(doc);
  else engine.add(doc);
  mtimes.set(doc.id, mtime);
  scheduleSave();
}

/** Loads the persisted index cache from disk, if any. Falls back to an empty
 * index (rebuilt by the next `syncSearchIndex` call) if it's missing or corrupt. */
export async function loadPersistedSearchIndex(): Promise<void> {
  const raw = await readSearchIndexFile();
  if (!raw) return;
  try {
    const state = JSON.parse(raw) as PersistedState;
    if (state.version !== INDEX_VERSION) return;
    engine = MiniSearch.loadJSON<IndexedDoc>(JSON.stringify(state.index), MINISEARCH_OPTIONS);
    mtimes = new Map(Object.entries(state.mtimes));
  } catch {
    engine = createEngine();
    mtimes = new Map();
  }
}

/** Builds/refreshes the index against the current note tree. Only reads a
 * note's content from disk if it's new or its mtime changed since it was last
 * indexed - unaffected notes are skipped entirely, so this stays fast
 * regardless of total vault size. */
export async function syncSearchIndex(tree: TreeEntry[]): Promise<void> {
  const notes = flattenNotes(tree);

  // Guards against wiping a populated index because of a transient/incomplete
  // `tree` snapshot - a genuinely empty vault has nothing to reconcile away
  // anyway, so skipping is always safe.
  if (notes.length > 0) {
    const currentPaths = new Set(notes.map((n) => n.path));
    for (const path of [...mtimes.keys()]) {
      if (!currentPaths.has(path)) removeNoteFromIndex(path);
    }
  }

  await Promise.all(
    notes.map(async (note) => {
      let mtime: number;
      try {
        mtime = await noteMtimeMs(note.path);
      } catch {
        return; // Deleted mid-scan; the next sync will reconcile it.
      }
      const stored = engine.has(note.path) ? (engine.getStoredFields(note.path) as StoredDoc) : undefined;
      if (mtimes.get(note.path) === mtime && stored?.title === note.title) return;

      const content = await readNote(note.path).catch(() => "");
      upsert({ id: note.path, title: note.title, content }, mtime);
    }),
  );

  ready = true;
  scheduleSave();
}

/** A body excerpt around the first matched term, split so callers can render
 * `match` (the literal matched text) distinctly from the surrounding context. */
export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  path: string;
  score: number;
  /** Excerpt proving the content match, or null when the hit only matched the title. */
  snippet: SearchSnippet | null;
}

// Asymmetric on purpose: result tiles are narrow and truncate to 1-2 lines,
// so a short lead-in keeps the actual matched word from being clipped off
// before it ever renders.
const SNIPPET_BEFORE_RADIUS = 20;
const SNIPPET_AFTER_RADIUS = 90;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reduces raw note markdown to roughly plain text, so a snippet shows
 * readable prose instead of `**`, `<mark data-color="...">`, table pipes,
 * etc. Deliberately approximate - good enough for a preview excerpt. */
function toPlainText(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*[-*+]\s+(\[[ xX]\]\s*)?/gm, "")
    .replace(/^[ \t]*\d+\.\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*\|?[ \t:|-]+\|[ \t:|-]*$/gm, " ")
    .replace(/[*_`~|\\]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Finds the earliest occurrence of any matched term in `content` and returns
 * a window of surrounding text around it, so a search result can show *why*
 * it matched rather than just that it did. */
function extractSnippet(content: string, matchedTerms: string[]): SearchSnippet | null {
  const plain = toPlainText(content);

  let bestStart = -1;
  let bestEnd = -1;
  for (const term of matchedTerms) {
    // `\b` prefix only (not a trailing boundary) since a matched term may be
    // a prefix of a longer word in the content (e.g. query "grocer" matching
    // stored word "groceries").
    const found = new RegExp(`\\b${escapeRegExp(term)}`, "i").exec(plain);
    if (found && (bestStart === -1 || found.index < bestStart)) {
      bestStart = found.index;
      bestEnd = found.index + found[0].length;
    }
  }
  if (bestStart === -1) return null;

  while (bestEnd < plain.length && /\w/.test(plain[bestEnd])) bestEnd++;

  const windowStart = Math.max(0, bestStart - SNIPPET_BEFORE_RADIUS);
  const windowEnd = Math.min(plain.length, bestEnd + SNIPPET_AFTER_RADIUS);

  const before = (windowStart > 0 ? "…" : "") + plain.slice(windowStart, bestStart).replace(/\s+/g, " ").trimStart();
  const match = plain.slice(bestStart, bestEnd);
  const after =
    plain.slice(bestEnd, windowEnd).replace(/\s+/g, " ") + (windowEnd < plain.length ? "…" : "");

  return { before, match, after };
}

/** Ranked search across titles (boosted) and body content, tolerant of typos
 * (fuzzy matching) and partial words (prefix matching while still typing). */
export function searchNotes(query: string): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return engine.search(trimmed).map((r) => {
    const contentTerms = Object.entries(r.match as MatchInfo)
      .filter(([, fields]) => fields.includes("content"))
      .map(([term]) => term);
    const stored = engine.getStoredFields(r.id) as StoredDoc | undefined;
    const snippet = stored ? extractSnippet(stored.content, contentTerms) : null;
    return { path: String(r.id), score: r.score, snippet };
  });
}

export function addNoteToIndex(path: string, content: string): void {
  upsert({ id: path, title: titleFromNotePath(path), content }, Date.now());
}

export const updateNoteInIndex = addNoteToIndex;

export function removeNoteFromIndex(path: string): void {
  if (!engine.has(path)) return;
  engine.discard(path);
  mtimes.delete(path);
  scheduleSave();
}

/** Removes a note, or every indexed note nested under a deleted folder. */
export function removePathFromIndex(path: string): void {
  removeNoteFromIndex(path);
  const prefix = `${path}/`;
  for (const indexed of [...mtimes.keys()]) {
    if (indexed.startsWith(prefix)) removeNoteFromIndex(indexed);
  }
}

/** Re-keys a note (or every note nested under a folder) after a rename/move,
 * reusing already-indexed content rather than re-reading files from disk. */
export function movePathInIndex(oldPath: string, newPath: string): void {
  if (engine.has(oldPath)) {
    const { content } = engine.getStoredFields(oldPath) as StoredDoc;
    const mtime = mtimes.get(oldPath) ?? Date.now();
    removeNoteFromIndex(oldPath);
    upsert({ id: newPath, title: titleFromNotePath(newPath), content }, mtime);
  }

  const prefix = `${oldPath}/`;
  for (const indexed of [...mtimes.keys()]) {
    if (!indexed.startsWith(prefix)) continue;
    const { content } = engine.getStoredFields(indexed) as StoredDoc;
    const mtime = mtimes.get(indexed) ?? Date.now();
    const rest = indexed.slice(oldPath.length);
    removeNoteFromIndex(indexed);
    upsert({ id: newPath + rest, title: titleFromNotePath(newPath + rest), content }, mtime);
  }
}
