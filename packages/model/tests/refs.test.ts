import { describe, expect, it } from "vitest";
import { parseProject } from "../src/parse";
import { indexWords } from "../src/words";
import { makeProject, projectInput, words } from "./helpers";

function errorsOf(over: Parameters<typeof projectInput>[0]) {
  const r = parseProject(projectInput(over));
  if (r.ok) throw new Error("expected errors");
  return r.errors;
}

describe("indexWords", () => {
  it("indexes words by id with their asset and position", () => {
    const w = indexWords(makeProject()).get("a.w5");
    expect(w).toEqual({ id: "a.w5", asset: "a", index: 5, text: "cinq", startMs: 5000, endMs: 5500 });
  });
});

describe("parseProject cross-references", () => {
  it("rejects a clip on an unknown asset", () => {
    expect(errorsOf({ story: [{ id: "c1", asset: "nope", inMs: 0, outMs: 1000 }] }))
      .toContainEqual({ path: "story[0].asset", message: 'unknown asset "nope"' });
  });

  it("rejects an anchor on an unknown word", () => {
    expect(errorsOf({ elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w99" }, durationMs: 500, props: { text: "X" } }] }))
      .toContainEqual({ path: "elements[0].anchor.word", message: 'unknown word "a.w99"' });
  });

  it("accepts an anchor on a word that exists but was cut (a cut word is not a parse error)", () => {
    const r = parseProject(projectInput({
      story: [{ id: "c1", asset: "a", inMs: 0, outMs: 2000 }],
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w5" }, durationMs: 500, props: { text: "X" } }],
    }));
    expect(r.ok).toBe(true);
  });

  it("rejects a caption whose words come from two assets", () => {
    const errors = errorsOf({
      assets: [
        { id: "a", kind: "video", path: "a.mp4" },
        { id: "b", kind: "video", path: "b.mp4" },
      ],
      transcript: { lang: "fr", words: { a: words("a", ["un"]), b: words("b", ["deux"]) } },
      captions: [{ words: ["a.w0", "b.w0"], text: "un deux" }],
    });
    expect(errors).toContainEqual({ path: "captions[0].words", message: "a caption's first and last words must come from the same asset" });
  });

  it("rejects a caption whose last word comes before its first", () => {
    expect(errorsOf({ captions: [{ words: ["a.w4", "a.w2"], text: "x" }] }))
      .toContainEqual({ path: "captions[0].words", message: "the last word comes before the first word" });
  });

  it("rejects duplicate element ids", () => {
    const el = { id: "e1", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 500, props: { text: "X" } };
    expect(errorsOf({ elements: [el, el] })).toContainEqual({ path: "elements[1].id", message: 'duplicate id "e1"' });
  });

  it("rejects an image element pointing to an unknown asset", () => {
    expect(errorsOf({ elements: [{ id: "e1", kind: "image", anchor: { atMs: 0 }, durationMs: 500, props: { asset: "logo" } }] }))
      .toContainEqual({ path: "elements[0].props.asset", message: 'unknown asset "logo"' });
  });

  it("checks elements inside proposal variants", () => {
    const errors = errorsOf({
      proposals: [{
        id: "p1", step: "visuals",
        variants: [{ key: "A", label: "x", patch: { addElements: [{ id: "e9", kind: "laser", anchor: { atMs: 0 }, durationMs: 100 }] } }],
      }],
    });
    expect(errors).toContainEqual({ path: "proposals[0].variants[0].patch.addElements[0].kind", message: 'unknown kind "laser"' });
  });

  it("rejects a beat on an unknown word", () => {
    expect(errorsOf({ structure: { framework: "soar", beats: [{ role: "situation", from: "a.w0", to: "a.w42" }] } }))
      .toContainEqual({ path: "structure.beats[0].to", message: 'unknown word "a.w42"' });
  });

  it("rejects transcript words of an unknown asset and duplicate word ids", () => {
    const errors = errorsOf({
      transcript: { lang: "fr", words: { a: [...words("a", ["un"]), ...words("a", ["un"])], ghost: words("ghost", ["x"]) } },
    });
    expect(errors).toContainEqual({ path: "transcript.words.ghost", message: 'unknown asset "ghost"' });
    expect(errors).toContainEqual({ path: "transcript.words", message: "word ids must be unique across assets" });
  });
});
