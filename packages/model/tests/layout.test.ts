import { describe, expect, it } from "vitest";
import { layoutStory, sourceToOutputMs, wordOutput } from "../src/layout";
import { indexWords } from "../src/words";
import { makeProject } from "./helpers";

const cut = () =>
  makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 10000 }] });

describe("layoutStory", () => {
  it("lays clips end to end in milliseconds", () => {
    const { clips, totalMs } = layoutStory(cut());
    expect(clips.map((l) => [l.clip.id, l.outStartMs, l.outEndMs])).toEqual([["c1", 0, 2000], ["c2", 2000, 7000]]);
    expect(totalMs).toBe(7000);
  });
});

describe("sourceToOutputMs", () => {
  it("maps a kept moment through the cut", () => {
    const { clips } = layoutStory(cut());
    expect(sourceToOutputMs(clips, "a", 500)).toBe(500);
    expect(sourceToOutputMs(clips, "a", 5200)).toBe(2200);
  });
  it("returns null for a cut moment or another asset", () => {
    const { clips } = layoutStory(cut());
    expect(sourceToOutputMs(clips, "a", 3000)).toBeNull();
    expect(sourceToOutputMs(clips, "b", 500)).toBeNull();
  });
  it("maps a source range used twice to its first occurrence", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3000 }, { id: "c2", asset: "a", inMs: 0, outMs: 3000 }] });
    expect(sourceToOutputMs(layoutStory(p).clips, "a", 1800)).toBe(1800);
  });
});

describe("wordOutput", () => {
  it("maps a kept word and clips its end at the clip boundary", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 5200 }, { id: "c2", asset: "a", inMs: 7000, outMs: 9000 }] });
    const { clips } = layoutStory(p);
    const w = indexWords(p);
    expect(wordOutput(clips, w.get("a.w2")!)).toEqual({ startMs: 2600, endMs: 3100 });
    expect(wordOutput(clips, w.get("a.w5")!)).toEqual({ startMs: 5000, endMs: 5200 });
    expect(wordOutput(clips, w.get("a.w6")!)).toBeNull();
  });
});
