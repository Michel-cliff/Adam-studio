import { describe, expect, it } from "vitest";
import { exportSchemas } from "../src/jsonschema";
import { parseProject, parseStyle } from "../src/parse";
import { resolve } from "../src/resolve";
import { cutWords, restoreWords } from "../src/transcript";
import { closeStep, decide, newWorkflow, WorkflowError } from "../src/workflow";
import { NUMBERS, makeProject, makeStyle, projectInput, styleInput, words } from "./helpers";

const ranges = (p: ReturnType<typeof makeProject>) => p.story.map((c) => [c.id, c.inMs, c.outMs]);

describe("finding 1: restoreWords never scrambles the story", () => {
  it("restores only the missing parts of a selection that mixes kept and cut words, in source order", () => {
    const p = makeProject({ story: [
      { id: "c1", asset: "a", inMs: 0, outMs: 2400 },
      { id: "c2", asset: "a", inMs: 3300, outMs: 4000 },
      { id: "c3", asset: "a", inMs: 5900, outMs: 10000 },
    ] });
    expect(ranges(restoreWords(p, ["a.w2", "a.w3", "a.w4", "a.w5"]))).toEqual([["c1", 0, 2400], ["c2", 2600, 5500], ["c3", 5900, 10000]]);
  });

  it("puts a restored word next to the clip that precedes it in source time", () => {
    const p = makeProject({ story: [
      { id: "c1", asset: "a", inMs: 0, outMs: 2000 },
      { id: "c2", asset: "a", inMs: 2200, outMs: 3600 },
      { id: "c3", asset: "a", inMs: 5000, outMs: 10000 },
    ] });
    expect(ranges(restoreWords(p, ["a.w3"]))).toEqual([["c1", 0, 2000], ["c2", 2200, 3900], ["c3", 5000, 10000]]);
  });

  it("does not merge into a neighbour with a different framing, zoom or volume", () => {
    const p = makeProject({ story: [
      { id: "c1", asset: "a", inMs: 0, outMs: 3400 },
      { id: "c2", asset: "a", inMs: 3900, outMs: 10000, framing: { mode: "crop", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }, zoom: { base: 1.2, driftPerSec: 0 }, volume: 0.5 },
    ] });
    const out = restoreWords(p, ["a.w3"]);
    expect(ranges(out)).toEqual([["c1", 0, 3900], ["c2", 3900, 10000]]);
    expect(out.story[1]!.framing.mode).toBe("crop");
    expect(out.story[1]!.zoom.base).toBe(1.2);
    expect(out.story[1]!.volume).toBe(0.5);
  });

  it("treats a word covered by two contiguous clips as already kept", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 3600 }, { id: "c2", asset: "a", inMs: 3600, outMs: 10000 }] });
    expect(restoreWords(p, ["a.w3"]).story).toEqual(p.story);
  });

  it("restores the rest of a word partly kept by a padded clip", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 920, outMs: 2660 }] });
    expect(ranges(restoreWords(p, ["a.w2"]))).toEqual([["c1", 920, 3100]]);
  });
});

describe("finding 2: no clip shorter than one frame", () => {
  it("cutWords absorbs a leftover piece shorter than 50 ms", () => {
    const p = makeProject({ transcript: { lang: "fr", words: { a: words("a", NUMBERS, 1000, 510, 500) } } });
    const twice = cutWords(cutWords(p, ["a.w3"]), ["a.w4"]);
    expect(ranges(twice)).toEqual([["c1", 0, 2530], ["c1~2", 3540, 10000]]);
  });

  it("resolve drops a clip that rounds to zero frames, with a warning", () => {
    const tl = resolve(makeProject({ story: [
      { id: "c1", asset: "a", inMs: 0, outMs: 2000 },
      { id: "tiny", asset: "a", inMs: 3000, outMs: 3010 },
      { id: "c3", asset: "a", inMs: 5000, outMs: 6000 },
    ] }), makeStyle());
    expect(tl.clips.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(tl.audio.map((a) => a.id)).toEqual(["clip:c1", "clip:c3"]);
    expect(tl.warnings).toContain('clip "tiny" is shorter than one frame and was dropped');
  });
});

describe("finding 3: an element clamped at the start keeps its sync", () => {
  it("starts a clamped sound later in its source and tells the renderer how much was cut", () => {
    const tl = resolve(makeProject({
      assets: [
        { id: "a", kind: "video", path: "a.mp4", meta: { durationMs: 30000 } },
        { id: "s", kind: "audio", path: "s.wav" },
      ],
      story: [{ id: "c1", asset: "a", inMs: 900, outMs: 16000 }],
      elements: [
        { id: "whoosh", kind: "sfx", anchor: { word: "a.w0", offsetMs: -400 }, durationMs: 800, props: { asset: "s" } },
        { id: "word", kind: "text.behindSubject", anchor: { word: "a.w0", offsetMs: -400 }, durationMs: 800, props: { text: "X" } },
      ],
    }), makeStyle());
    expect(tl.audio.find((a) => a.id === "whoosh")).toMatchObject({ fromFrame: 0, durationFrames: 15, sourceInMs: 300 });
    expect(tl.elements[0]).toMatchObject({ id: "word", fromFrame: 0, durationFrames: 15, trimStartMs: 300 });
  });
});

describe("finding 4: unknown keys are errors, not silently dropped", () => {
  it("rejects a misspelled clip field", () => {
    const r = parseProject(projectInput({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 1000, trasitionOut: { kind: "cut" } } as never] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual(expect.objectContaining({ path: "story[0]", message: expect.stringMatching(/trasitionOut/) }));
  });

  it("rejects a misspelled prop of an element kind", () => {
    const r = parseProject(projectInput({ elements: [{ id: "e1", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 500, props: { text: "X", colour: "#00FF00" } }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContainEqual(expect.objectContaining({ path: "elements[0].props", message: expect.stringMatching(/colour/) }));
  });

  it("rejects a misspelled style field", () => {
    const r = parseStyle({ ...styleInput, caption: { size: 0.05, maxCharsPerLin: 20 } });
    expect(r.ok).toBe(false);
  });
});

describe("finding 5: element kind schemas are exported for Python", () => {
  it("exports one JSON Schema per kind", () => {
    const out = exportSchemas() as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(out)).toEqual(expect.arrayContaining([
      "kinds/title.schema.json", "kinds/text.behindSubject.schema.json", "kinds/image.schema.json", "kinds/sfx.schema.json",
    ]));
    expect(Object.keys(out["kinds/title.schema.json"]!.properties!)).toContain("phases");
  });
});

function guided() {
  return makeProject({
    workflow: newWorkflow(),
    proposals: [
      { id: "p1", step: "cuts", variants: [
        { key: "A", label: "tight", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 5000 }] } },
        { key: "B", label: "loose", patch: { setStory: [{ id: "c1", asset: "a", inMs: 0, outMs: 9000 }] } },
      ] },
      { id: "p2", step: "visuals", variants: [
        { key: "A", label: "word", patch: { addElements: [{ id: "w", kind: "text.behindSubject", anchor: { atMs: 0 }, durationMs: 500, props: { text: "W" } }] } },
      ] },
    ],
  });
}

describe("finding 6: every decision and its note stay in history", () => {
  it("keeps a rejection with its note", () => {
    const h = decide(guided(), "p1", "reject", "too flashy").proposals[0]!.history;
    expect(h).toEqual([expect.objectContaining({ decision: "reject", note: "too flashy" })]);
    expect(h[0]!.variants.map((v) => v.key)).toEqual(["A", "B"]);
  });

  it("keeps an acceptance with its note", () => {
    const h = decide(guided(), "p1", "B", "best pace").proposals[0]!.history;
    expect(h).toEqual([expect.objectContaining({ decision: "B", note: "best pace" })]);
  });
});

describe("finding 7: a step with no proposals can be closed", () => {
  it("closes the current step and opens the next", () => {
    const p = closeStep(decide(guided(), "p1", "A"));
    expect(p.workflow).toMatchObject({ current: "captions", steps: { structure: "done", captions: "open" } });
  });

  it("lets the workflow reach a later step and decide there", () => {
    let p = decide(guided(), "p1", "A");
    for (let i = 0; i < 4; i++) p = closeStep(p); // structure, captions, hook, beats
    expect(p.workflow!.current).toBe("visuals");
    expect(decide(p, "p2", "A").elements.map((e) => e.id)).toEqual(["w"]);
  });

  it("refuses to close a step that still has pending proposals", () => {
    expect(() => closeStep(guided())).toThrow(WorkflowError);
    expect(() => closeStep(guided())).toThrow(/pending/);
  });
});
