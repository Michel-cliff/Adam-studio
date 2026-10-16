import type { TimelineAudio } from "@adam-studio/model";

/** Volume at `frame` (relative to the item start), with linear fades, capped at 1 for HTML5 audio. */
export function audioVolume(item: TimelineAudio, frame: number, fps: number): number {
  const ms = (frame * 1000) / fps;
  const totalMs = (item.durationFrames * 1000) / fps;
  let v = item.volume;
  if (item.fadeInMs > 0) v *= Math.min(1, ms / item.fadeInMs);
  if (item.fadeOutMs > 0) v *= Math.min(1, Math.max(0, totalMs - ms) / item.fadeOutMs);
  return Math.min(1, Math.max(0, v));
}
