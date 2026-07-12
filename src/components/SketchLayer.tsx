import { useCallback, useEffect, useRef } from "react";
import type { SketchPoint, SketchStroke, SketchTool } from "../types";

interface SketchLayerProps {
  className?: string;
  /** Whether sketch mode is on - controls pointer capture vs. click-through. */
  active: boolean;
  strokes: SketchStroke[];
  tool: SketchTool;
  color: string;
  /** Line width (pen/highlighter) or erase radius (eraser), in CSS pixels. */
  width: number;
  onAddStroke: (stroke: SketchStroke) => void;
  onEraseStrokes: (ids: string[]) => void;
}

const HIGHLIGHTER_ALPHA = 0.35;

function distanceToSegment(p: SketchPoint, a: SketchPoint, b: SketchPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke) {
  const { points } = stroke;
  if (points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  if (stroke.tool === "highlighter") ctx.globalAlpha = HIGHLIGHTER_ALPHA;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Notability-style ink layer: a canvas overlay that draws/erases vector
 * strokes, positioned by the caller so it scrolls naturally as part of the
 * note.
 *
 * Strokes are stored in raw CSS pixels relative to the note content's
 * top-left corner, not a coordinate space that scales with the note's
 * width. The text underneath doesn't reflow proportionally when the window
 * is resized (short lines just gain/lose surrounding whitespace), so
 * scaling ink with container width made it drift away from the words it
 * was drawn on. Keeping ink in fixed pixels means it stays exactly where
 * the user drew it - moving only if the text above it actually reflows,
 * same as the text itself.
 *
 * Rendered as two stacked canvases rather than one: a `base` layer holding
 * every committed stroke, repainted only when `strokes` actually changes,
 * and a `live` layer holding just the in-progress stroke, repainted on
 * every pointer sample while drawing. A single canvas would have to clear
 * and replay the *entire* stroke history on every pointer move to show the
 * new point - fine for a fresh note, but drawing latency grew with total
 * ink on the page, since every additional pointer sample cost O(all ink
 * ever drawn) instead of O(the one stroke currently being drawn).
 *
 * Both canvases size themselves off their PARENT element's measured box
 * (via ResizeObserver + getBoundingClientRect), not their own `inset-0`
 * box: a `position:absolute` element measuring its own rect while that
 * rect is itself defined by `inset:0` percentages is circular, and
 * WebKit's fallback for the unresolved case is a huge sentinel size
 * (2^25px) rather than 0 - which silently breaks the CSS-pixel/device-
 * pixel scale used for both rendering and pointer-coordinate conversion.
 * Measuring the parent (a normal-flow box with a real computed height)
 * avoids that entirely. */
export function SketchLayer({
  className,
  active,
  strokes,
  tool,
  color,
  width,
  onAddStroke,
  onEraseStrokes,
}: SketchLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const currentStrokeRef = useRef<SketchStroke | null>(null);
  const isDrawingRef = useRef(false);
  const isErasingRef = useRef(false);
  const erasedIdsRef = useRef<Set<string>>(new Set());

  function clearCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /** Repaints committed history - only needed when `strokes` changes, an
   * erase hits something, or the canvas is resized. */
  const redrawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    clearCanvas(canvas, ctx);
    for (const stroke of strokesRef.current) {
      if (erasedIdsRef.current.has(stroke.id)) continue;
      drawStroke(ctx, stroke);
    }
  }, []);

  /** Repaints just the in-progress stroke - called on every pointer sample
   * while drawing, so its cost is bounded by that one stroke's length. */
  const redrawLive = useCallback(() => {
    const canvas = liveCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    clearCanvas(canvas, ctx);
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current);
  }, []);

  const resizeAndRedraw = useCallback(
    (width: number, height: number) => {
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [baseCanvasRef.current, liveCanvasRef.current]) {
        if (!canvas) continue;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      redrawBase();
      redrawLive();
    },
    [redrawBase, redrawLive],
  );

  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      resizeAndRedraw(rect.width, rect.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [resizeAndRedraw]);

  useEffect(() => {
    redrawBase();
  }, [strokes, redrawBase]);

  function toLocalPoint(e: React.PointerEvent<HTMLCanvasElement>): SketchPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function eraseAt(point: SketchPoint) {
    const radius = width;
    let changed = false;
    for (const stroke of strokesRef.current) {
      if (erasedIdsRef.current.has(stroke.id)) continue;
      const pts = stroke.points;
      const hitRadius = radius + stroke.width / 2;
      let hit =
        pts.length === 1 && Math.hypot(point.x - pts[0].x, point.y - pts[0].y) < hitRadius;
      for (let i = 0; !hit && i < pts.length - 1; i++) {
        if (distanceToSegment(point, pts[i], pts[i + 1]) < hitRadius) hit = true;
      }
      if (hit) {
        erasedIdsRef.current.add(stroke.id);
        changed = true;
      }
    }
    if (changed) redrawBase();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = toLocalPoint(e);

    if (tool === "eraser") {
      isErasingRef.current = true;
      erasedIdsRef.current = new Set();
      eraseAt(point);
      return;
    }

    isDrawingRef.current = true;
    currentStrokeRef.current = {
      id: crypto.randomUUID(),
      tool,
      color,
      width,
      points: [point],
    };
    redrawLive();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    const point = toLocalPoint(e);
    if (isErasingRef.current) {
      eraseAt(point);
      return;
    }
    if (isDrawingRef.current && currentStrokeRef.current) {
      currentStrokeRef.current.points.push(point);
      redrawLive();
    }
  }

  function endGesture(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (isErasingRef.current) {
      isErasingRef.current = false;
      const ids = Array.from(erasedIdsRef.current);
      erasedIdsRef.current = new Set();
      if (ids.length > 0) onEraseStrokes(ids);
      return;
    }
    if (isDrawingRef.current && currentStrokeRef.current) {
      isDrawingRef.current = false;
      const stroke = currentStrokeRef.current;
      currentStrokeRef.current = null;
      onAddStroke(stroke);
      // onAddStroke may classify this as a text decoration and never commit
      // it into `strokes` (see Editor.tsx's handleAddStroke) - in that case
      // no prop change will trigger the base-layer redraw effect below, and
      // the just-finished raw stroke would stay rasterized on the live
      // layer until the next unrelated redraw. Clearing it here is a no-op
      // for the normal ink case (redrawBase() from the `strokes` effect
      // repaints the same pixels on the base layer moments later) but is
      // required for the decoration case.
      redrawLive();
    }
  }

  const cursor = tool === "eraser" ? "cell" : "crosshair";

  return (
    // pointerEvents "none" here, not just on the canvases: an ordinary div
    // defaults to "auto" and, positioned over the whole note, would swallow
    // every click/focus attempt into the editor underneath even while this
    // layer is otherwise fully transparent and inactive.
    <div ref={containerRef} className={className} style={{ pointerEvents: "none" }}>
      <canvas ref={baseCanvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <canvas
        ref={liveCanvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: active ? "auto" : "none",
          touchAction: active ? "none" : "auto",
          cursor,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
    </div>
  );
}
