import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import { readAttachment } from "../utils/fsNotes";

const resolvedCache = new Map<string, string>();

function isExternal(src: string): boolean {
  return /^(https?:|data:)/.test(src);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function mimeFromExtension(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

/** Resolves a note-relative attachment path (as stored in the .md file) to a
 * displayable data: URL, caching results the same way Preview.tsx used to. */
async function resolveSrc(src: string): Promise<string> {
  if (!src || isExternal(src)) return src;
  const cached = resolvedCache.get(src);
  if (cached) return cached;
  const bytes = await readAttachment(src);
  const url = `data:${mimeFromExtension(src)};base64,${uint8ToBase64(bytes)}`;
  resolvedCache.set(src, url);
  return url;
}

/** NodeView for the standard commonmark `image` node: attrs.src stays the
 * relative attachment path (so `![alt](path)` round-trips to disk unchanged),
 * while the displayed <img src> is resolved asynchronously to a data URL. */
class ImageNodeView implements NodeView {
  dom: HTMLElement;
  private img: HTMLImageElement;
  private node: ProseNode;

  constructor(node: ProseNode, _view: EditorView, _getPos: () => number | undefined) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "milkdown-image-view";
    this.img = document.createElement("img");
    this.dom.appendChild(this.img);
    this.renderImg(node);
  }

  private renderImg(node: ProseNode) {
    this.img.alt = (node.attrs.alt as string) ?? "";
    this.img.title = (node.attrs.title as string) ?? "";
    const src = (node.attrs.src as string) ?? "";
    if (!src || isExternal(src)) {
      this.img.src = src;
      return;
    }
    resolveSrc(src)
      .then((resolved) => {
        this.img.src = resolved;
      })
      .catch(() => {
        this.img.alt = `Couldn't load image: ${src}`;
      });
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const srcChanged = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (srcChanged) {
      this.renderImg(node);
    } else {
      this.img.alt = (node.attrs.alt as string) ?? "";
      this.img.title = (node.attrs.title as string) ?? "";
    }
    return true;
  }

  selectNode() {
    this.dom.classList.add("selected");
  }

  deselectNode() {
    this.dom.classList.remove("selected");
  }
}

export const imageView = $view(imageSchema.node, () => {
  return ((node, view, getPos) => new ImageNodeView(node, view, getPos)) as NodeViewConstructor;
});
