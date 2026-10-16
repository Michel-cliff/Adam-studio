import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCommand } from "../../src/commands/render";
import { makeSynthetic } from "./synthetic";

const tempBundles = () => readdirSync(tmpdir()).filter((f) => f.startsWith("remotion-webpack-bundle-")).length;

function probe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
}

describe("adam render", () => {
  it("renders the synthetic project to a 1080x1920 MP4 with sound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam render-"));
    makeSynthetic(dir);
    const bundlesBefore = tempBundles();
    const out = await renderCommand(dir, { force: false });
    expect(existsSync(join(dir, "renders", "synthetic.timeline.json"))).toBe(true);
    // The bundle lives in the project and links the media: no copy is left in the temp folder.
    expect(tempBundles()).toBe(bundlesBefore);
    expect(statSync(join(dir, "renders", ".bundle", "public", "cache", "s", "edit.mp4")).nlink).toBe(2);
    const info = probe(out);
    const video = info.streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(Math.abs(Number(info.format.duration) - 4)).toBeLessThan(0.15);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to render while proposals are pending, unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam render-"));
    makeSynthetic(dir, { withProposal: true });
    await expect(renderCommand(dir, { force: false })).rejects.toThrow("Refusing to render");
    rmSync(dir, { recursive: true, force: true });
  });
});
