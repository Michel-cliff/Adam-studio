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
