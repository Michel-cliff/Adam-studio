import { cpus, freemem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { safeConcurrency } from "./lib/concurrency";
import { COMPOSITION_ID, type RenderProps } from "./props";

export const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

export async function bundleFor(publicDir: string): Promise<string> {
  return bundle({ entryPoint: ENTRY, publicDir });
}

export async function renderVideo(
  serveUrl: string,
  props: RenderProps,
  outFile: string,
  frameRange: number | [number, number] | [number, number][] | null = null,
): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  const videoSources = Object.values(props.media).reduce((n, m) => n + (m.video ? 1 : 0) + (m.subject ? 1 : 0), 0);
  const concurrency = safeConcurrency({
    freeBytes: freemem(), cores: cpus().length, width: composition.width, height: composition.height, fps: composition.fps, videoSources,
  });
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: outFile, inputProps: props, frameRange, concurrency });
}

export async function renderFrame(serveUrl: string, props: RenderProps, frame: number, outFile: string): Promise<void> {
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
  await renderStill({ composition, serveUrl, output: outFile, frame, inputProps: props, imageFormat: "png" });
}
