import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatch, newWorkflow, parseProject, parseStyle, resolve, type Project } from "@adam-studio/model";
import { decideCommand } from "../../src/commands/decide";
import { reviewTargets, reviewWindow, sheetLabel } from "../../src/commands/review";
import { projectInput, styleInput } from "./helpers";

function load(over: Parameters<typeof projectInput>[0] = {}) {
  const p = parseProject(projectInput(over));
  const s = parseStyle(styleInput);
  if (!p.ok || !s.ok) throw new Error("bad fixture");
  return { project: p.value, style: s.value };
}

const proposal = (id: string, step: "cuts" | "visuals", anchor?: { word: string }) => ({
  id, step, reason: "r", ...(anchor ? { anchor } : {}),
  variants: [{ key: "A" as const, label: "a", patch: {} }, { key: "B" as const, label: "b", patch: {} }],
});

describe("reviewTargets", () => {
  it("takes the pending proposals of the current step", () => {
    const { project } = load({ workflow: newWorkflow(), proposals: [proposal("p1", "cuts"), proposal("p2", "visuals")] });
    expect(reviewTargets(project).map((p) => p.id)).toEqual(["p1"]);
    expect(reviewTargets(project, "visuals").map((p) => p.id)).toEqual(["p2"]);
  });
  it("takes every pending proposal without a workflow", () => {
    const { project } = load({ proposals: [proposal("p1", "cuts"), proposal("p2", "visuals")] });
    expect(reviewTargets(project).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("reviewWindow", () => {
  it("centers 3 seconds on the anchor word, still just after it", () => {
    const { project, style } = load({ proposals: [proposal("p1", "visuals", { word: "s.w2" })] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[21, 111]], still: 71 });
  });
  it("uses three 1-second samples for a proposal without anchor", () => {
    const { project, style } = load({ proposals: [proposal("p1", "cuts")] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[15, 44], [45, 74], [75, 104]], still: 60 });
  });
  it("merges samples that overlap in a short edit", () => {
    const { project, style } = load({ story: [{ id: "c1", asset: "s", inMs: 0, outMs: 1000 }], proposals: [proposal("p1", "cuts")] });
    const tl = resolve(project, style);
    expect(reviewWindow(project, tl, project.proposals[0]!)).toEqual({ ranges: [[0, 29]], still: 15 });
  });
  it("follows the timing of the variant being previewed", () => {
    const { project, style } = load({
      proposals: [{
        id: "p1", step: "cuts", anchor: { word: "s.w2" }, reason: "r",
        variants: [{ key: "A", label: "trim the start", patch: { setStory: [{ id: "c1", asset: "s", inMs: 1000, outMs: 4000 }] } }],
      }],
    });
    const p = project.proposals[0]!;
    const tl = resolve(project, style, { apply: { proposal: "p1", variant: "A" } });
    expect(reviewWindow(applyPatch(project, p.variants[0]!.patch), tl, p)).toEqual({ ranges: [[0, 81]], still: 41 });
  });
});

describe("sheetLabel", () => {
  it("keeps letters, accents, digits, spaces and punctuation", () => {
    expect(sheetLabel("A", "magenta in front, élan: oui")).toBe("A  magenta in front, élan: oui");
  });
  it("wraps long labels on up to three lines instead of cutting them", () => {
    const lines = sheetLabel("B", "HUD window with a capture of the site, slow glitch intro and a counter").split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(30);
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain("counter");
  });
});

describe("decideCommand", () => {
  it("records the decision in project.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam decide-"));
    const variants = [{ key: "A", label: "add", patch: { addElements: [{ id: "x", kind: "image", anchor: { atMs: 0 }, durationMs: 300, props: { asset: "m" } }] } }];
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...projectInput(), proposals: [{ id: "p1", step: "visuals", variants }] }));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    decideCommand(dir, "p1", "A", "nice");
    const saved = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as Project;
    expect(saved.elements.map((e) => e.id)).toContain("x");
    expect(saved.proposals[0]!.status).toEqual({ accepted: "A" });
    expect(saved.proposals[0]!.history[0]).toMatchObject({ decision: "A", note: "nice" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an unknown decision word", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam decide-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify(projectInput()));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    expect(() => decideCommand(dir, "p1", "maybe")).toThrow('decision must be A, B, C, reject or more, got "maybe"');
    rmSync(dir, { recursive: true, force: true });
  });
});
