import type { Timeline } from "@adam-studio/model";
import { subjectWindows } from "./subject";

/**
 * Most video files decoded at the same moment: a clip's take, the second take of a split, and the subject
 * matte when a subject window is on the clip. Clips play one after another, so their sources never add up.
 */
export function activeVideoSources(timeline: Timeline): number {
  const withSubject = new Set(subjectWindows(timeline).map((w) => w.clipId));
  return Math.max(1, ...timeline.clips.map((c) => 1 + (c.framing.mode === "split" ? 1 : 0) + (withSubject.has(c.id) ? 1 : 0)));
}

/**
 * Browser tabs for a render, so that Remotion's OffthreadVideo frame cache (half the free memory by default)
 * holds one second of decoded frames per video source for every tab. Beyond that, frames are evicted before
 * use and the render fails with "No frame found at position".
 */
export function safeConcurrency(o: { freeBytes: number; cores: number; width: number; height: number; fps: number; videoSources: number }): number {
  const cacheFrames = o.freeBytes / 2 / (o.width * o.height * 4);
  const perTab = Math.max(1, o.videoSources) * o.fps;
  return Math.max(1, Math.min(Math.floor(o.cores / 2), Math.floor(cacheFrames / perTab)));
}
