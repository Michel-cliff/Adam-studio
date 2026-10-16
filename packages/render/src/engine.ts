import { rmSync } from "node:fs";
import { cpus, freemem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { activeVideoSources, safeConcurrency } from "./lib/concurrency";
import { prepareMedia, type MediaPlan } from "./media";
import { COMPOSITION_ID, type RenderProps } from "./props";

export const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

/**
 * Bundles into `outDir` (replaced each time; Remotion's default is a new %TEMP% folder that is never removed)
 * and hard-links the planned media into its public folder. That folder does not exist while bundling, so
 * Remotion copies nothing.
 */
export async function bundleWithMedia(plan: MediaPlan, outDir: string): Promise<string> {
  rmSync(outDir, { recursive: true, force: true });
  const publicDir = join(outDir, "public");
  const serveUrl = await bundle({ entryPoint: ENTRY, outDir, publicDir });
  prepareMedia(plan, publicDir);
  return serveUrl;
}

export async function renderVideo(
  serveUrl: string,
  props: RenderProps,
  outFile: string,
  frameRange: number | [number, number] | [number, number][] | null = null,
  opts: { transparent?: boolean } = {},
): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  const concurrency = safeConcurrency({
    freeBytes: freemem(), cores: cpus().length, width: composition.width, height: composition.height, fps: composition.fps,
    videoSources: activeVideoSources(props.timeline),
  });
  // Decision 0001: CapCut keeps the alpha of MOV ProRes 4444 (and ignores it in WebM).
  const output = opts.transparent
    ? ({ codec: "prores", proResProfile: "4444", pixelFormat: "yuva444p10le", imageFormat: "png", muted: true } as const)
    : // BT.709 limited range, like the takes: Remotion's default (full-range BT.601) shifts brightness in CapCut.
      ({ codec: "h264", colorSpace: "bt709" } as const);
  await renderMedia({ composition, serveUrl, outputLocation: outFile, inputProps: props, frameRange, concurrency, ...output });
}

export async function renderFrame(serveUrl: string, props: RenderProps, frame: number, outFile: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  await renderStill({ composition, serveUrl, output: outFile, frame, inputProps: props, imageFormat: "png" });
}
