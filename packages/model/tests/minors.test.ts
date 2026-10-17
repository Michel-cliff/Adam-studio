import { describe, expect, it } from "vitest";
import { lint } from "../src/lint";
import { parseProject } from "../src/parse";
import { resolve } from "../src/resolve";
import { findHighlights } from "../src/text";
import { makeProject, makeStyle, projectInput } from "./helpers";

const errors = (over: object) => { const r = parseProject(projectInput(over as never)); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };

describe("validation gaps", () => {
  it("refuses duplicate variant keys and duplicate clip ids in setStory", () => {
    const v = (key: string, patch: object) => ({ key, label: key, patch });
    expect(errors({ proposals: [{ id: "p", step: "cuts", variants: [v("A", {}), v("A", {})] }] }).join()).toMatch(/variants.*duplicate|duplicate.*A/);
    const story = [{ id: "x", asset: "a", inMs: 0, outMs: 1000 }, { id: "x", asset: "a", inMs: 2000, outMs: 3000 }];
    expect(errors({ proposals: [{ id: "p", step: "cuts", variants: [v("A", { setStory: story })] }] }).join()).toMatch(/setStory.*duplicate|duplicate.*"x"/);
  });

  it("refuses a beat that ends before it starts", () => {
    expect(errors({ structure: { framework: "custom", beats: [{ role: "hook", from: "a.w5", to: "a.w2" }] } }).join()).toMatch(/before/);
    expect(errors({ structure: { framework: "custom", beats: [{ role: "hook", from: "a.w2", to: "a.w5" }] } })).toEqual([]);
  });

  it("warns when a clip runs past the end of its take", () => {
    const p = makeProject({ story: [{ id: "c1", asset: "a", inMs: 25000, outMs: 32000 }] });
    expect(lint(p, resolve(p, makeStyle())).map((w) => w.rule)).toContain("story.pastEnd");
  });
});

describe("captions", () => {
  it("highlights whole words only and ignores empty phrases", () => {
    expect(findHighlights("le marché de mars", ["mar"])).toEqual({ ranges: [], missing: ["mar"] });
    expect(findHighlights("le marché de mars", ["mars"]).ranges).toEqual([[13, 17]]);
    expect(findHighlights("élan, oui", ["élan"]).ranges).toEqual([[0, 4]]);
    expect(findHighlights("abc", ["  "])).toEqual({ ranges: [], missing: [] });
  });

  it("warns when a caption is too long for two lines", () => {
    const long = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize";
    const p = makeProject({ captions: [{ words: ["a.w0", "a.w9"], text: long }] } as never);
    expect(resolve(p, makeStyle()).warnings.join()).toMatch(/too long/);
  });
});

describe("filler words", () => {
  it("follow the transcript language, unless the format sets its own", () => {
    const en = makeProject({ transcript: { lang: "en", words: { a: [{ id: "a.w0", text: "um", startMs: 1000, endMs: 1300 }, { id: "a.w1", text: "euh", startMs: 1400, endMs: 1700 }] } } } as never);
    const rules = (p: typeof en, style = makeStyle()) => lint(p, resolve(p, style)).filter((w) => w.rule === "pace.fillers").map((w) => w.message);
    expect(rules(en).join()).toMatch(/"um"/);
    expect(rules(en).join()).not.toMatch(/"euh"/);
    const fr = makeProject();
    expect(makeStyle().fillers.fr).toContain("euh");
    const own = makeStyle({ lint: { "9:16": { minDurationMs: 0, maxDurationMs: 60000, fillers: ["un"] }, "16:9": { minDurationMs: 0, maxDurationMs: 60000 } } } as never);
    expect(rules(fr, own).join()).toMatch(/"un"/);
  });
});
