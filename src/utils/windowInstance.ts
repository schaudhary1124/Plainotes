import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Query param keys used to tell a freshly opened window what to show. */
const NOTE_QUERY_PARAM = "note";
const FOLDER_QUERY_PARAM = "folder";

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 760;

interface LocationTarget {
  /** Note path to open directly into, if this window was spawned to show a specific note. */
  notePath: string | null;
  /** Folder to browse into, if this window was spawned to mirror the browse view. Undefined if unset. */
  browseFolder: string | undefined;
}

/** Reads which note/folder a window should open to, from its own URL (set by openWindowInstance). */
export function getTargetFromLocation(): LocationTarget {
  const params = new URLSearchParams(window.location.search);
  const note = params.get(NOTE_QUERY_PARAM);
  const folder = params.get(FOLDER_QUERY_PARAM);
  return {
    notePath: note ? decodeURIComponent(note) : null,
    browseFolder: folder !== null ? decodeURIComponent(folder) : undefined,
  };
}

/**
 * Opens a new PlaiNotes window mirroring this one - either straight into a specific note, or
 * into the folder currently being browsed - sized to match the current window.
 */
export async function openWindowInstance(target: { notePath: string } | { browseFolder: string }): Promise<void> {
  const query =
    "notePath" in target
      ? `${NOTE_QUERY_PARAM}=${encodeURIComponent(target.notePath)}`
      : `${FOLDER_QUERY_PARAM}=${encodeURIComponent(target.browseFolder)}`;

  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  try {
    const current = getCurrentWindow();
    const [outerSize, scaleFactor] = await Promise.all([current.outerSize(), current.scaleFactor()]);
    const logical = outerSize.toLogical(scaleFactor);
    width = logical.width;
    height = logical.height;
  } catch {
    // Fall back to the default launch size if the current window's size can't be read.
  }

  const label = `note-${crypto.randomUUID()}`;
  new WebviewWindow(label, {
    url: `index.html?${query}`,
    title: "PlaiNotes",
    width,
    height,
    minWidth: 370,
    minHeight: 370,
    resizable: true,
    decorations: false,
    transparent: true,
    shadow: false,
    center: true,
    acceptFirstMouse: true,
  });
}
