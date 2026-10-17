import { cameraWindows } from "./camera";
import type { Timeline } from "@adam-studio/model";
import { subjectWindows } from "./subject";

export type ReportStatus = "native" | "baked" | "skipped";
export type ReportEntry = { id: string; kind: string; status: ReportStatus; reason: string };
/** A stretch of the main track rendered by Remotion, frames [fromFrame, toFrame). */
export type CapcutBake = { id: string; fromFrame: number; toFrame: number };
export type CapcutOverlay = { elementId: string; fromFrame: number; durationFrames: number };
export type CapcutPlan = { bakes: CapcutBake[]; overlays: CapcutOverlay[]; entries: ReportEntry[] };

/** Front element kinds the Python exporter maps to native CapCut items; any other front kind becomes a transparent overlay. */
export const NATIVE_FRONT_KINDS: ReadonlySet<string> = new Set(["image", "title", "text.behindSubject"]);

/** What the CapCut exporter cannot do natively, and the report entries explaining it. */
export function planCapcut(timeline: Timeline, nativeKinds: ReadonlySet<string> = NATIVE_FRONT_KINDS): CapcutPlan {
  const entries: ReportEntry[] = [];
  const ranges: [number, number][] = [...subjectWindows(timeline).map((w): [number, number] => [w.fromFrame, w.toFrame]), ...cameraWindows(timeline)];
  for (const c of timeline.clips) {
    if (c.framing.mode === "split") {
      ranges.push([c.fromFrame, c.fromFrame + c.durationFrames]);
      entries.push({ id: `clip:${c.id}`, kind: "clip", status: "baked", reason: "split framing is rendered by Remotion" });
    }
    if (c.transitionOut.kind === "subjectSlide") {
      entries.push({ id: `transition:${c.id}`, kind: "subjectSlide", status: "baked", reason: "person-only slide, baked into the main track" });
    }
    if (c.transitionOut.kind === "flash" || c.transitionOut.kind === "whip" || c.transitionOut.kind === "zoom") {
      entries.push({ id: `transition:${c.id}`, kind: c.transitionOut.kind, status: "baked", reason: "transition effect, baked into the main track" });
    }
    if (c.transitionOut.kind === "crossfade") {
      entries.push({ id: `transition:${c.id}`, kind: "crossfade", status: "skipped", reason: "crossfades are added by hand in CapCut" });
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const bakes = merged.map(([fromFrame, toFrame], i) => ({ id: `b${String(i + 1).padStart(2, "0")}`, fromFrame, toFrame }));
  const overlays: CapcutOverlay[] = [];
  for (const e of timeline.elements) {
    if (e.layer === "behind-subject") {
      entries.push({ id: e.id, kind: e.kind, status: "baked", reason: "drawn behind the subject, baked into the main track" });
    } else if (e.kind === "sfx") {
      // Drawn as nothing: the exporter places it from the timeline's audio items.
    } else if (e.kind === "camera.zoom") {
      entries.push({ id: e.id, kind: e.kind, status: "baked", reason: "screen zoom, baked into the main track" });
    } else if (!nativeKinds.has(e.kind)) {
      overlays.push({ elementId: e.id, fromFrame: e.fromFrame, durationFrames: e.durationFrames });
      entries.push({ id: e.id, kind: e.kind, status: "baked", reason: "no native CapCut equivalent: transparent overlay (MOV ProRes 4444)" });
    }
  }
  for (const o of timeline.orphans) {
    entries.push({ id: o, kind: o.startsWith("caption:") ? "caption" : "element", status: "skipped", reason: "anchored to words cut from the edit: hidden" });
  }
  for (const w of timeline.warnings) {
    const m = /^clip "(.+)" is shorter than one frame and was dropped$/.exec(w);
    if (m) entries.push({ id: `clip:${m[1]}`, kind: "clip", status: "skipped", reason: "shorter than one frame: dropped" });
  }
  return { bakes, overlays, entries };
}
