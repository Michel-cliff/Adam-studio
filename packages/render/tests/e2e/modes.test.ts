import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve } from "@adam-studio/model";
import { bundleWithMedia, renderFrame, renderVideo } from "../../src/engine";
import { planMedia } from "../../src/media";
import type { RenderProps } from "../../src/props";
import { projectInput } from "../unit/helpers";
import { makeSynthetic } from "./synthetic";

let dir: string;
let serveUrl: string;
let props: RenderProps;
let shots = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "adam modes-"));
  makeSynthetic(dir);
  // A full-frame magenta image in front of everything, frames 39 to 47.
  const front = { id: "front", kind: "image", anchor: { atMs: 1300 }, durationMs: 300, props: { asset: "m" } };
  const p = parseProject({ ...projectInput(), elements: [...(projectInput().elements ?? []), front] });
  const s = parseStyle(JSON.parse(readFileSync(join(dir, "style.json"), "utf8")));
  if (!p.ok || !s.ok) throw new Error("modes project is invalid");
  const timeline = resolve(p.value, s.value);
  const plan = planMedia(dir, p.value, timeline);
  serveUrl = await bundleWithMedia(plan, join(dir, "renders", ".bundle"));
  props = { timeline, media: plan.media, fonts: plan.fonts };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function rgba(p: RenderProps, frame: number, x: number, y: number): Promise<number[]> {
  const out = join(dir, `mode-${++shots}.png`);
  await renderFrame(serveUrl, p, frame, out);
  const png = PNG.sync.read(readFileSync(out));
  const i = (png.width * y + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

describe("render modes", () => {
  it("bake mode keeps the take and leaves out front elements", async () => {
    const full = await rgba(props, 40, 50, 50);
    const bake = await rgba({ ...props, mode: { kind: "bake" } }, 40, 50, 50);
    expect(full[0]! > 200 && full[1]! < 60 && full[2]! > 200, `full shows the front image, got ${full}`).toBe(true);
    expect(bake[0]! > 200 && bake[1]! < 60 && bake[2]! < 60, `bake shows the red take, got ${bake}`).toBe(true);
  });

  it("overlay mode draws only the listed elements, on a transparent background", async () => {
    const listed = await rgba({ ...props, mode: { kind: "overlay", elements: ["front"] } }, 40, 50, 50);
    const none = await rgba({ ...props, mode: { kind: "overlay", elements: [] } }, 40, 50, 50);
    expect(listed[3], `the listed element is opaque, got ${listed}`).toBe(255);
    expect(listed[0]! > 200 && listed[2]! > 200, `the listed element is magenta, got ${listed}`).toBe(true);
    expect(none[3], `nothing listed leaves the frame transparent, got ${none}`).toBe(0);
  });

  it("renders a transparent overlay as ProRes 4444 with alpha", async () => {
    const out = join(dir, "overlay.mov");
    await renderVideo(serveUrl, { ...props, mode: { kind: "overlay", elements: ["front"] } }, out, [39, 47], { transparent: true });
    const info = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name,pix_fmt", "-of", "json", out], { encoding: "utf8" }),
    ) as { streams: { codec_name: string; pix_fmt: string }[] };
    expect(info.streams[0]!.codec_name).toBe("prores");
    expect(info.streams[0]!.pix_fmt).toMatch(/^yuva444/);
  });
});
