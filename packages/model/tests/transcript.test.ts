import { describe, expect, it } from "vitest";
import { EditError, cutWords, restoreWords, trimToWords } from "../src/transcript";
import { makeProject } from "./helpers";

const ranges = (p: ReturnType<typeof makeProject>) => p.story.map((c) => [c.id, c.inMs, c.outMs]);

describe("cutWords", () => {
  it("removes the span of consecutive words by splitting the clip", () => {
    const p = cutWords(makeProject(), ["a.w3", "a.w4"]);
    expect(ranges(p)).toEqual([["c1", 0, 3400], ["c1~2", 4700, 10000]]);
  });

  it("keeps the clip id when the cut is at its start", () => {
    const p = cutWords(makeProject({ story: [{ id: "c1", asset: "a", inMs: 1000, outMs: 10000 }] }), ["a.w0"]);
    expect(ranges(p)).toEqual([["c1", 1500, 10000]]);
  });

  it("moves the outgoing transition to the last piece", () => {
    const p = cutWords(makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 10000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }],
    }), ["a.w3"]);
    expect(p.story.map((c) => c.transitionOut.kind)).toEqual(["cut", "subjectSlide"]);
  });

  it("throws on an unknown word", () => {
    expect(() => cutWords(makeProject(), ["a.w99"])).toThrow(EditError);
  });
});

describe("restoreWords", () => {
  it("undoes a cut exactly, transition included", () => {
    const original = makeProject({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 10000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }],
    });
    const back = restoreWords(cutWords(original, ["a.w3", "a.w4"]), ["a.w3", "a.w4"]);
    expect(back.story).toEqual(original.story);
  });

  it("inserts a clip for words far from any kept range", () => {
    const p = restoreWords(makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }] }), ["a.w9"]);
    expect(ranges(p)).toEqual([["c1", 0, 2000], ["c1~2", 8200, 8700]]);
  });

  it("does nothing for words already kept", () => {
    const p = makeProject();
    expect(restoreWords(p, ["a.w2"]).story).toEqual(p.story);
  });

  it("refuses words of an asset that is not in the story", () => {
    const p = makeProject({
      assets: [{ id: "a", kind: "video", path: "a.mp4" }, { id: "b", kind: "video", path: "b.mp4" }],
      transcript: { lang: "fr", words: { a: [], b: [{ id: "b.w0", text: "x", startMs: 0, endMs: 100 }] } },
    });
    expect(() => restoreWords(p, ["b.w0"])).toThrow(/not in the story/);
  });
});

describe("trimToWords", () => {
  it("trims a clip to its words with padding", () => {
    const p = trimToWords(makeProject(), "c1", "a.w1", "a.w3");
    expect(ranges(p)).toEqual([["c1", 1720, 3960]]);
  });

  it("clamps to the asset duration", () => {
    const p = trimToWords(makeProject({ assets: [{ id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 8720 } }] }), "c1", "a.w8", "a.w9");
    expect(ranges(p)).toEqual([["c1", 7320, 8720]]);
  });

  it("throws on an unknown clip", () => {
    expect(() => trimToWords(makeProject(), "zz", "a.w1", "a.w3")).toThrow(EditError);
  });
});
