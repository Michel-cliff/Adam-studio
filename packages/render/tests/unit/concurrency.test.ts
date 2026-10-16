import { describe, expect, it } from "vitest";
import { activeVideoSources, safeConcurrency } from "../../src/lib/concurrency";
import { projectInput, timelineOf } from "./helpers";

const GB = 2 ** 30;
const base = { width: 1080, height: 1920, fps: 30, videoSources: 2, cores: 12 };

describe("safeConcurrency", () => {
  it("keeps few tabs when free memory is low", () => {
    expect(safeConcurrency({ ...base, freeBytes: 2.5 * GB })).toBe(2);
  });
  it("uses up to half the cores when memory allows", () => {
    expect(safeConcurrency({ ...base, freeBytes: 16 * GB })).toBe(6);
  });
  it("never goes below one tab", () => {
    expect(safeConcurrency({ ...base, freeBytes: 0.2 * GB })).toBe(1);
  });
  it("counts at least one video source", () => {
    expect(safeConcurrency({ ...base, videoSources: 0, freeBytes: 2.5 * GB })).toBe(5);
  });
});

describe("activeVideoSources", () => {
  it("counts the take and its subject matte when a subject window is on the clip", () => {
    expect(activeVideoSources(timelineOf())).toBe(2);
  });
  it("counts one source for a clip without subject window", () => {
    expect(activeVideoSources(timelineOf({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 4000 }], elements: [] }))).toBe(1);
  });
  it("does not add up takes that never play at the same time", () => {
    const assets = [...projectInput().assets, { id: "t", kind: "video" as const, path: "cache/t/edit.mp4" }, { id: "u", kind: "video" as const, path: "cache/u/edit.mp4" }];
    const story = ["s", "t", "u"].map((asset, i) => ({ id: `c${i}`, asset, inMs: 0, outMs: 1000 + i }));
    expect(activeVideoSources(timelineOf({ assets, story, elements: [] }))).toBe(1);
  });
  it("counts the second take of a split clip", () => {
    const assets = [...projectInput().assets, { id: "t", kind: "video" as const, path: "cache/t/edit.mp4" }];
    const story = [{ id: "c1", asset: "s", inMs: 0, outMs: 4000, framing: { mode: "split" as const, asset: "t" } }];
    expect(activeVideoSources(timelineOf({ assets, story, elements: [] }))).toBe(2);
  });
});
