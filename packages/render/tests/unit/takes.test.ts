import { describe, expect, it } from "vitest";
import { parseProject } from "@adam-studio/model";
import { addTakes, nextAssetIds, takeClip, type Take } from "../../src/takes";

const take = (path: string, words: [string, number, number][] = [["bonjour", 400, 800], ["tout", 900, 1200]], durationMs = 3000): Take => ({
  path,
  probe: { durationMs, width: 1080, height: 1920, hasAudio: true },
  transcript: { lang: "fr", words: words.map(([text, startMs, endMs]) => ({ text, startMs, endMs })) },
});

const empty = { version: 1 as const, name: "demo", canvas: { format: "9:16" as const, fps: 30 }, style: "style.json", assets: [], story: [] };

describe("nextAssetIds", () => {
  it("continues after the highest cNN", () => {
    expect(nextAssetIds([], 2)).toEqual(["c01", "c02"]);
    expect(nextAssetIds(["c01", "c07", "hud_frame"], 2)).toEqual(["c08", "c09"]);
  });
});

describe("takeClip", () => {
  it("runs from 150 ms before the first word to 250 ms after the last", () => {
    expect(takeClip("c01", [{ startMs: 400, endMs: 800 }, { startMs: 900, endMs: 1200 }], 3000)).toEqual({ id: "c01", asset: "c01", inMs: 250, outMs: 1450 });
  });
  it("covers the whole take without words, and stays inside it", () => {
    expect(takeClip("c02", [], 3000)).toEqual({ id: "c02", asset: "c02", inMs: 0, outMs: 3000 });
    expect(takeClip("c03", [{ startMs: 50, endMs: 2900 }], 3000)).toEqual({ id: "c03", asset: "c03", inMs: 0, outMs: 3000 });
  });
});

describe("addTakes", () => {
  it("adds assets, word ids and story clips, and the result is a valid project", () => {
    const p = addTakes(empty, [take("C:/rushes/a é.mp4"), take("C:/rushes/b.mp4", [])]);
    expect(p.assets!.map((a) => [a.id, a.path, a.meta])).toEqual([
      ["c01", "C:/rushes/a é.mp4", { durationMs: 3000, width: 1080, height: 1920, hasAudio: true }],
      ["c02", "C:/rushes/b.mp4", { durationMs: 3000, width: 1080, height: 1920, hasAudio: true }],
    ]);
    expect(p.transcript!.words!.c01).toEqual([
      { id: "c01.w0", text: "bonjour", startMs: 400, endMs: 800 },
      { id: "c01.w1", text: "tout", startMs: 900, endMs: 1200 },
    ]);
    expect(p.story.map((c) => c.id)).toEqual(["c01", "c02"]);
    expect(parseProject(p).ok).toBe(true);
  });
  it("skips a video already in the project", () => {
    const once = addTakes(empty, [take("C:/rushes/a.mp4")]);
    expect(addTakes(once, [take("C:/rushes/a.mp4")]).assets).toHaveLength(1);
  });
});
