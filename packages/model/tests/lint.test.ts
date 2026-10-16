import { describe, expect, it } from "vitest";
import { lint, type LintOptions } from "../src/lint";
import { resolve } from "../src/resolve";
import type { ProjectInput } from "../src/schema/project";
import { makeProject, makeStyle, words } from "./helpers";

const style = makeStyle();
/** 15.1 s, speech at 100 ms, 300 ms gaps, a caption at the start: lint-clean. */
const clean: Partial<ProjectInput> = {
  story: [{ id: "c1", asset: "a", inMs: 900, outMs: 16000 }],
  captions: [{ words: ["a.w0", "a.w1"], text: "zero un" }],
};
function run(over: Partial<ProjectInput> = {}, opts: LintOptions = {}) {
  const p = makeProject({ ...clean, ...over });
  return lint(p, resolve(p, style), opts);
}
const rules = (ws: ReturnType<typeof run>) => ws.map((w) => w.rule);

describe("lint", () => {
  it("passes a clean project", () => {
    expect(run()).toEqual([]);
  });

  it("flags speech that starts after 500 ms", () => {
    const ws = run({ story: [{ id: "c1", asset: "a", inMs: 0, outMs: 16000 }] });
    expect(ws).toContainEqual({ rule: "hook.first3s", severity: "warning", message: "Speech starts at 1000 ms (more than 500 ms)", ids: ["a.w0"] });
  });

  it("flags a missing text hook in the first 3 seconds", () => {
    expect(rules(run({ captions: [] }))).toContain("hook.first3s");
  });

  it("flags pauses longer than the style limit", () => {
    const ws = run({ styleOverrides: { lint: { "9:16": { maxPauseMs: 200 } } } });
    expect(ws.filter((w) => w.rule === "pace.pauses")).toHaveLength(9);
  });

  it("flags single and two-word fillers that were kept", () => {
    const ws = run({ transcript: { lang: "fr", words: { a: words("a", ["euh", "un", "du", "coup", "quatre", "cinq", "six", "sept", "huit", "neuf"]) } } });
    const fillers = ws.filter((w) => w.rule === "pace.fillers");
    expect(fillers.map((w) => w.ids)).toEqual([["a.w0"], ["a.w2", "a.w3"]]);
  });

  it("flags a duration outside the format range", () => {
    expect(rules(run({ story: [{ id: "c1", asset: "a", inMs: 900, outMs: 5000 }] }))).toContain("duration.range");
  });

  it("checks beats against the framework", () => {
    const missing = run({ structure: { framework: "soar", beats: [{ role: "situation", from: "a.w0", to: "a.w2" }] } });
    expect(missing).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Missing beats for soar: obstacle, action, results" }));
    const unknown = run({ structure: { framework: "xyz", beats: [] } });
    expect(unknown).toContainEqual(expect.objectContaining({ rule: "structure.beats", severity: "error" }));
    const disordered = run({ structure: { framework: "bab", beats: [
      { role: "after", from: "a.w0", to: "a.w2" }, { role: "before", from: "a.w3", to: "a.w5" }, { role: "bridge", from: "a.w6", to: "a.w9" },
    ] } });
    expect(disordered).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Beats are not in the order of bab" }));
  });

  it("flags a hook beat longer than its limit", () => {
    const ws = run({ structure: { framework: "hrst", beats: [
      { role: "hook", from: "a.w0", to: "a.w5" }, { role: "relatable", from: "a.w6", to: "a.w6" },
      { role: "show", from: "a.w7", to: "a.w7" }, { role: "takeaway", from: "a.w8", to: "a.w9" },
    ] } });
    expect(ws).toContainEqual(expect.objectContaining({ rule: "structure.beats", message: "Beat hook lasts 4500 ms (limit 3000 ms)" }));
  });

  it("reports orphans", () => {
    const ws = run({ story: [{ id: "c1", asset: "a", inMs: 900, outMs: 2000 }, { id: "c2", asset: "a", inMs: 5000, outMs: 19000 }],
      elements: [{ id: "e1", kind: "text.behindSubject", anchor: { word: "a.w3" }, durationMs: 500, props: { text: "X" } }] });
    expect(ws).toContainEqual(expect.objectContaining({ rule: "elements.orphans", ids: ["e1"] }));
  });

  it("checks files with Windows paths and names the analysis step", () => {
    const exists = new Set(["C:\\media\\a.mp4", "D:/p/cache/a/edit.mp4"]);
    const ws = run(
      { assets: [{ id: "a", kind: "video", path: "C:\\media\\a.mp4", meta: { durationMs: 30000 } }],
        story: [{ id: "c1", asset: "a", inMs: 900, outMs: 16000, transitionOut: { kind: "subjectSlide", durationMs: 540 } }] },
      { projectDir: "D:/p", fileExists: (f) => exists.has(f) },
    );
    const missing = ws.filter((w) => w.rule === "assets.missing").map((w) => w.message);
    expect(missing).toEqual([
      'Missing subject.webm for asset "a": run the matting analysis step',
      'Missing plate.png for asset "a": run the clean plate analysis step',
    ]);
  });

  it("blocks export while proposals are pending", () => {
    const ws = run({ proposals: [{ id: "p1", step: "cuts", variants: [] }] });
    expect(ws).toContainEqual({ rule: "proposals.pending", severity: "error", message: "1 proposal(s) still pending", ids: ["p1"] });
  });
});
