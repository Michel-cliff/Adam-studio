import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";
import { TimelineSchema } from "../src/schema/timeline";
import type { ElementInput } from "../src/schema/project";
import { makeProject, makeStyle } from "./helpers";

const style = makeStyle();
const cut = { story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 10000 }] };
const word = (w: string, extra: Partial<ElementInput> = {}): ElementInput => ({
  id: "t", kind: "text.behindSubject", anchor: { word: w }, durationMs: 1000, props: { text: "HELLO" }, ...extra,
});

describe("resolve: clips", () => {
  it("places clips from accumulated milliseconds so rounding never drifts", () => {
    const tl = resolve(makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 1010 }, { id: "c2", asset: "a", inMs: 2000, outMs: 3010 }] }), style);
    expect(tl.clips.map((c) => [c.id, c.fromFrame, c.durationFrames])).toEqual([["c1", 0, 30], ["c2", 30, 31]]);
    expect(tl.durationFrames).toBe(61);
    expect(TimelineSchema.safeParse(tl).success).toBe(true);
  });

  it("sizes the canvas from the format", () => {
    const tl = resolve(makeProject({ canvas: { format: "16:9", fps: 30 } }), style);
    expect([tl.width, tl.height, tl.format]).toEqual([1920, 1080, "16:9"]);
  });
});

describe("resolve: elements", () => {
  it("follows the speech through a cut", () => {
    const tl = resolve(makeProject({ ...cut, elements: [word("a.w5")] }), style);
    expect(tl.elements[0]).toMatchObject({ id: "t", fromFrame: 60, durationFrames: 30, layer: "front" });
  });

  it("reports an element anchored to a cut word as an orphan", () => {
    const tl = resolve(makeProject({ ...cut, elements: [word("a.w3")] }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.orphans).toEqual(["t"]);
  });

  it("clamps an element that starts before 0", () => {
    const tl = resolve(makeProject({ elements: [word("a.w0", { anchor: { word: "a.w0", offsetMs: -2000 }, durationMs: 3000 })] }), style);
    expect(tl.elements[0]).toMatchObject({ fromFrame: 0, durationFrames: 60 });
  });

  it("drops and warns about an element with nothing visible", () => {
    const tl = resolve(makeProject({ elements: [word("a.w0", { anchor: { atMs: 20000 }, durationMs: 500 })] }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.warnings).toContain('element "t" has no visible duration and was dropped');
  });

  it("ends an element at a word or at the end", () => {
    const tl = resolve(makeProject({
      elements: [
        { id: "u", kind: "text.behindSubject", anchor: { word: "a.w0" }, untilWord: "a.w2", props: { text: "A" } },
        { id: "v", kind: "text.behindSubject", anchor: { atMs: 9000 }, untilEnd: true, props: { text: "B" } },
      ],
    }), style);
    expect(tl.elements.map((e) => [e.id, e.fromFrame, e.durationFrames])).toEqual([["u", 30, 63], ["v", 270, 30]]);
  });

  it("places elements by slot, by explicit position, and warns on an unknown slot", () => {
    const tl = resolve(makeProject({
      elements: [
        word("a.w0", { id: "s1", slot: "title" }),
        word("a.w0", { id: "s2", position: { x: 0.1, y: 0.9 } }),
        word("a.w0", { id: "s3", slot: "nowhere" }),
      ],
    }), style);
    expect(tl.elements.map((e) => [e.id, e.x, e.y])).toEqual([["s1", 0.5, 0.3], ["s2", 0.1, 0.9], ["s3", 0.5, 0.5]]);
    expect(tl.warnings).toContain('unknown slot "nowhere", placed at the center');
  });

  it("maps a source range used twice to its first occurrence", () => {
    const tl = resolve(makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3000 }, { id: "c2", asset: "a", inMs: 0, outMs: 3000 }],
      elements: [word("a.w1")],
    }), style);
    expect(tl.elements[0]!.fromFrame).toBe(54);
  });
});

describe("resolve: audio and style", () => {
  it("adds clip audio and turns sfx elements into audio items", () => {
    const tl = resolve(makeProject({
      assets: [
        { id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 30000, hasAudio: true } },
        { id: "s", kind: "audio", path: "s.wav" },
      ],
      elements: [{ id: "sfx1", kind: "sfx", anchor: { atMs: 500 }, durationMs: 400, props: { asset: "s", volume: 0.4 } }],
    }), style);
    expect(tl.elements).toEqual([]);
    expect(tl.audio).toEqual([
      { id: "clip:c1", asset: "a", fromFrame: 0, durationFrames: 300, sourceInMs: 0, volume: 1, fadeInMs: 0, fadeOutMs: 0 },
      { id: "sfx1", asset: "s", fromFrame: 15, durationFrames: 12, sourceInMs: 0, volume: 0.4, fadeInMs: 0, fadeOutMs: 0 },
    ]);
  });

  it("skips clip audio for a silent video", () => {
    const tl = resolve(makeProject({ assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { hasAudio: false } }] }), style);
    expect(tl.audio).toEqual([]);
  });

  it("applies project style overrides on top of the style", () => {
    const tl = resolve(makeProject({ styleOverrides: { colors: { highlight: "#00FF00" } } }), style);
    expect(tl.style.colors).toEqual({ text: "#FFFFFF", highlight: "#00FF00", accent: "#FF6B35", ink: "#0E0C0A" });
  });
});
