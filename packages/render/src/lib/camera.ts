import type { CameraZoomProps, Timeline } from "@adam-studio/model";

export type Camera = { transform?: string; origin?: string; filter?: string; flash: number };

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Moves of the main track at an absolute frame: punch-in zooms (camera.zoom elements) and the whip and zoom
 * transitions, plus the white of flash transitions. Effect durations stretch when the style's motion speed is below 1.
 */
export function cameraAt(timeline: Timeline, frame: number): Camera {
  const { fps, width } = timeline;
  const speed = timeline.style.motion?.speed ?? 1;
  let scale = 1;
  let origin: string | undefined;
  let shift = 0;
  let blur = 0;
  let flash = 0;
  for (const e of timeline.elements) {
    if (e.kind !== "camera.zoom" || frame < e.fromFrame || frame >= e.fromFrame + e.durationFrames) continue;
    const p = e.props as CameraZoomProps;
    const ease = Math.max(1, ((p.easeMs ?? 300) / speed / 1000) * fps);
    const env = smooth(Math.min((frame - e.fromFrame) / ease, (e.fromFrame + e.durationFrames - frame) / ease));
    const s = 1 + ((p.scale ?? 1.3) - 1) * env;
    if (s > scale) { scale = s; origin = `${(p.x ?? 0.5) * 100}% ${(p.y ?? 0.4) * 100}%`; }
  }
  for (const c of timeline.clips) {
    const t = c.transitionOut;
    if (t.kind !== "flash" && t.kind !== "whip" && t.kind !== "zoom") continue;
    const cut = c.fromFrame + c.durationFrames;
    const half = Math.max(1, ((t.durationMs / 2 / speed) * fps) / 1000);
    const u = (frame - cut) / half; // -1 .. 1 around the cut
    if (u < -1 || u > 1) continue;
    const near = 1 - Math.abs(u);
    if (t.kind === "flash") flash = Math.max(flash, near ** 1.5);
    if (t.kind === "whip") { shift = (u < 0 ? -(1 + u) : 1 - u) * width * 0.18; blur = Math.max(blur, near * 28); }
    if (t.kind === "zoom") { const s = 1 + 0.4 * near * near; if (s > scale) { scale = s; origin = "50% 45%"; } }
  }
  const parts = [shift ? `translateX(${shift.toFixed(1)}px)` : "", scale !== 1 ? `scale(${scale.toFixed(4)})` : ""].filter(Boolean);
  return { transform: parts.join(" ") || undefined, origin, filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined, flash };
}

/** Frame ranges the camera changes, for the CapCut bake (the main track is rendered there). */
export function cameraWindows(timeline: Timeline): [number, number][] {
  const speed = timeline.style.motion?.speed ?? 1;
  const out: [number, number][] = timeline.elements.filter((e) => e.kind === "camera.zoom").map((e) => [e.fromFrame, e.fromFrame + e.durationFrames]);
  for (const c of timeline.clips) {
    const t = c.transitionOut;
    if (t.kind !== "flash" && t.kind !== "whip" && t.kind !== "zoom") continue;
    const cut = c.fromFrame + c.durationFrames;
    const half = Math.ceil(((t.durationMs / 2 / speed) * timeline.fps) / 1000);
    out.push([Math.max(0, cut - half), Math.min(timeline.durationFrames, cut + half)]);
  }
  return out;
}
