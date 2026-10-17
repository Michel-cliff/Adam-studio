import { describe, expect, it } from "vitest";
import type { Project } from "@adam-studio/model";
import { cutWords, tightenPauses } from "../../server/cuts";

const w = (i: number, startMs: number, endMs: number) => ({ id: `c01.w${i}`, text: `w${i}`, startMs, endMs });
const base = {
  story: [{ id: "s1", asset: "c01", inMs: 0, outMs: 5000, framing: { mode: "cover" }, zoom: { base: 1, driftPerSec: 0 }, transitionOut: { kind: "subjectSlide", durationMs: 600 }, volume: 1 }],
  transcript: { lang: "fr", words: { c01: [w(0, 100, 400), w(1, 500, 900), w(2, 1000, 1300), w(3, 2500, 2800), w(4, 2900, 3300)] } },
} as unknown as Project;
const spans = (p: Project) => p.story.map((c) => [c.id, c.inMs, c.outMs, c.transitionOut.kind]);

describe("cutWords", () => {
  it("removes the words and the pause after them, splitting the clip", () => {
    expect(spans(cutWords(base, ["c01.w1", "c01.w2"]))).toEqual([["s1", 0, 500, "cut"], ["s1b", 2500, 5000, "subjectSlide"]]);
  });
  it("cuts separate selections separately and keeps the start", () => {
    expect(spans(cutWords(base, ["c01.w0", "c01.w3"]))).toEqual([["s1", 0, 100, "cut"], ["s1b", 500, 2500, "cut"], ["s1c", 2900, 5000, "subjectSlide"]]);
  });
  it("cutting the last words drops the tail after them", () => {
    expect(spans(cutWords(base, ["c01.w4"]))).toEqual([["s1", 0, 2900, "subjectSlide"]]);
  });
  it("cuts a passage that spans two clips", () => {
    const two = { ...base, story: [{ ...base.story[0]!, id: "s1", outMs: 2000 }, { ...base.story[0]!, id: "s2", inMs: 2000, outMs: 5000 }] } as Project;
    expect(spans(cutWords(two, ["c01.w2", "c01.w3"]))).toEqual([["s1", 0, 1000, "subjectSlide"], ["s2", 2900, 5000, "subjectSlide"]]);
  });
  it("refuses unknown words and cutting everything", () => {
    expect(() => cutWords(base, ["c01.w9"])).toThrow(/unknown word/);
    expect(() => cutWords({ ...base, story: [{ ...base.story[0]!, inMs: 500, outMs: 900 }] } as Project, ["c01.w1"])).toThrow(/nothing left/);
  });
});

describe("tightenPauses", () => {
  it("shortens pauses longer than the threshold to the kept air", () => {
    expect(spans(tightenPauses(base, 600, 200))).toEqual([["s1", 0, 1400, "cut"], ["s1b", 2400, 5000, "subjectSlide"]]);
    expect(spans(tightenPauses(base, 2000, 200))).toEqual(spans(base));
  });
});
