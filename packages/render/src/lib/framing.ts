import type { Framing, Zoom } from "@adam-studio/model";

export type Rect = { x: number; y: number; w: number; h: number };
type CropFraming = Extract<Framing, { mode: "crop" }>;

export function zoomAt(zoom: Zoom, elapsedMs: number): number {
  return zoom.base + zoom.driftPerSec * (elapsedMs / 1000);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Crop rect at a source (asset) time: `rect` is the value at time 0, keyframes are source times, linear in between, held after the last. */
export function cropRectAt(framing: CropFraming, sourceMs: number): Rect {
  const points = [{ atMs: 0, rect: framing.rect }, ...framing.keyframes].sort((a, b) => a.atMs - b.atMs);
  let prev = points[0]!;
  for (const p of points.slice(1)) {
    if (sourceMs < p.atMs) {
      const t = Math.min(1, Math.max(0, (sourceMs - prev.atMs) / Math.max(1, p.atMs - prev.atMs)));
      return {
        x: lerp(prev.rect.x, p.rect.x, t),
        y: lerp(prev.rect.y, p.rect.y, t),
        w: lerp(prev.rect.w, p.rect.w, t),
        h: lerp(prev.rect.h, p.rect.h, t),
      };
    }
    prev = p;
  }
  return prev.rect;
}

export type Size = { width: number; height: number };
export type Box = { left: number; top: number; width: number; height: number };

/**
 * Where to draw the whole source (canvas pixels, no aspect distortion) so that `rect`, normalized to the
 * source frame, covers the canvas and is centered on it.
 */
export function cropBox(rect: Rect, source: Size, canvas: Size): Box {
  const scale = Math.max(canvas.width / (rect.w * source.width), canvas.height / (rect.h * source.height));
  const cx = (rect.x + rect.w / 2) * source.width * scale;
  const cy = (rect.y + rect.h / 2) * source.height * scale;
  return { left: canvas.width / 2 - cx, top: canvas.height / 2 - cy, width: source.width * scale, height: source.height * scale };
}
