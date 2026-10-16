import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { capcutPrepCommand } from "../../src/commands/capcut";
import { makeSynthetic } from "./synthetic";

const ffprobe = (args: string[]) => execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8" }).trim();
const frames = (f: string) => Number(ffprobe(["-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", f]));
const pixFmt = (f: string) => ffprobe(["-select_streams", "v", "-show_entries", "stream=pix_fmt", "-of", "default=nw=1:nk=1", f]);
const hasAudio = (f: string) => ffprobe(["-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "default=nw=1:nk=1", f]) === "audio";

describe("adam capcut-prep", () => {
  it("renders baked stretches and overlays, and writes the plan for the exporter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam capcut-"));
    makeSynthetic(dir);
    const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    project.elements.push({
      id: "t1", kind: "title", anchor: { atMs: 2500 }, durationMs: 500,
      props: { phases: [{ startMs: 0, endMs: 500, lines: [{ text: "HELLO" }] }] },
    });
    writeFileSync(join(dir, "project.json"), JSON.stringify(project));

    // Titles are native by default; leaving them out of the native kinds exercises the overlay path.
    const out = await capcutPrepCommand(dir, { force: false, nativeKinds: ["image"] });
    expect(out).toBe(join(dir, "renders", "capcut"));
    const plan = JSON.parse(readFileSync(join(out, "capcut-plan.json"), "utf8"));
    expect(plan.bakes.map((b: { id: string; fromFrame: number; toFrame: number; file: string }) => [b.id, b.fromFrame, b.toFrame, b.file])).toEqual([
      ["b01", 9, 27, "bake/b01.mp4"],
      ["b02", 53, 71, "bake/b02.mp4"],
    ]);
    expect(plan.overlays).toEqual([{ elementId: "t1", fromFrame: 75, durationFrames: 15, file: "overlay/o01.mov" }]);
    expect(plan.entries.map((e: { id: string }) => e.id)).toEqual(["transition:c1", "behind", "t1"]);
    expect(frames(join(out, "bake", "b01.mp4"))).toBe(18);
    // Same color encoding as the takes (limited range, BT.709): no brightness jump at the bake edges in CapCut.
    expect(ffprobe(["-select_streams", "v", "-show_entries", "stream=pix_fmt,color_space", "-of", "default=nw=1:nk=1", join(out, "bake", "b01.mp4")]).split(/\r?\n/)).toEqual(["yuv420p", "bt709"]);
    expect(hasAudio(join(out, "bake", "b01.mp4"))).toBe(true);
    expect(pixFmt(join(out, "overlay", "o01.mov"))).toMatch(/^yuva444/);
    expect(existsSync(plan.sources.s.video)).toBe(true);
    expect(isAbsolute(plan.sources.m.file)).toBe(true);
    expect(existsSync(plan.fonts.caption.path)).toBe(true);
    expect(plan.fonts.caption.resourceId).toBeNull();
    expect(JSON.parse(readFileSync(join(out, "timeline.json"), "utf8")).durationFrames).toBe(120);
    rmSync(dir, { recursive: true, force: true });
  });

  it("never clears an --out folder that holds other files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam capcut-"));
    makeSynthetic(dir);
    const precious = join(dir, "precious");
    mkdirSync(precious);
    writeFileSync(join(precious, "keep.txt"), "x");
    await expect(capcutPrepCommand(dir, { force: false, out: precious })).rejects.toThrow("keep.txt");
    expect(readFileSync(join(precious, "keep.txt"), "utf8")).toBe("x");
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses while proposals are pending, unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam capcut-"));
    makeSynthetic(dir, { withProposal: true });
    await expect(capcutPrepCommand(dir, { force: false })).rejects.toThrow("Refusing to export");
    rmSync(dir, { recursive: true, force: true });
  });
});
