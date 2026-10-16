import { msToFrame, type Timeline } from "@adam-studio/model";

export const SLIDE_OUT_SHARE = 0.4;
const SLIDE_DISTANCE = 1.1; // x canvas width
const MAX_BLUR_PX = 90;

export type SlideWindow = { clipId: string; kind: "out" | "in"; fromFrame: number; toFrame: number };
export type SubjectWindow = { clipId: string; asset: string; fromFrame: number; toFrame: number };

/** Person-only slide windows: the end of a clip with transitionOut subjectSlide, then the start of the next clip. */
export function slideWindows(timeline: Timeline): SlideWindow[] {
  const out: SlideWindow[] = [];
  timeline.clips.forEach((c, i) => {
    if (c.transitionOut.kind !== "subjectSlide") return;
    const total = msToFrame(c.transitionOut.durationMs, timeline.fps);
    const outFrames = Math.min(c.durationFrames, Math.round(total * SLIDE_OUT_SHARE));
    const end = c.fromFrame + c.durationFrames;
    out.push({ clipId: c.id, kind: "out", fromFrame: end - outFrames, toFrame: end });
    const next = timeline.clips[i + 1];
    if (next) {
      const inFrames = Math.min(next.durationFrames, total - outFrames);
      out.push({ clipId: next.id, kind: "in", fromFrame: next.fromFrame, toFrame: next.fromFrame + inFrames });
    }
  });
  return out.filter((w) => w.toFrame > w.fromFrame);
}

/** Frames where the transparent subject must be drawn on top: behind-subject elements and slides, merged per clip. */
export function subjectWindows(timeline: Timeline): SubjectWindow[] {
  const slides = slideWindows(timeline);
  const behind = timeline.elements.filter((e) => e.layer === "behind-subject");
  const out: SubjectWindow[] = [];
  for (const c of timeline.clips) {
    const start = c.fromFrame;
    const end = c.fromFrame + c.durationFrames;
    const ranges: [number, number][] = [];
    for (const e of behind) {
      const a = Math.max(start, e.fromFrame);
      const b = Math.min(end, e.fromFrame + e.durationFrames);
      if (b > a) ranges.push([a, b]);
    }
    for (const s of slides) if (s.clipId === c.id) ranges.push([s.fromFrame, s.toFrame]);
    ranges.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    for (const [a, b] of merged) out.push({ clipId: c.id, asset: c.asset, fromFrame: a, toFrame: b });
  }
  return out;
}

/** Horizontal offset and directional blur of the subject during a slide, at an absolute frame. */
export function slideOffset(w: SlideWindow, frame: number, width: number): { dx: number; blurPx: number } {
  const n = w.toFrame - w.fromFrame;
  const dist = width * SLIDE_DISTANCE;
  if (w.kind === "out") {
    const p = Math.min(1, Math.max(0, (frame - w.fromFrame + 1) / n));
    const speed = (dist * 3 * p * p) / n;
    return { dx: -dist * p ** 3, blurPx: Math.min(MAX_BLUR_PX, 0.55 * speed) };
  }
  const p = Math.min(1, Math.max(0, (frame - w.fromFrame) / n));
  const speed = (dist * 3 * (1 - p) ** 2) / n;
  return { dx: dist * (1 - p) ** 3, blurPx: Math.min(MAX_BLUR_PX, 0.55 * speed) };
}
