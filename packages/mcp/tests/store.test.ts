import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeSynthetic } from "../../render/tests/e2e/synthetic";
import { closeCurrentStep, decideProposal, patchProject, projectDir, propose, setValue, undo, updateItem } from "@adam-studio/web/server/store";
import { projectSummary, transcriptText } from "../src/view";

let dir: string;
const read = () => JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
const magenta = { id: "m1", kind: "image", anchor: { word: "s.w1" }, durationMs: 400, props: { asset: "m" } };

let template: string;
beforeAll(() => { template = mkdtempSync(join(tmpdir(), "adam mcp-tpl-")); makeSynthetic(template, { withProposal: true }); }, 120000);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "adam mcp-")); cpSync(template, dir, { recursive: true }); });

describe("store", () => {
  it("finds projects by name or path, never outside the root", () => {
    const root = join(dir, "..");
    expect(projectDir(dir, "/nowhere")).toBe(dir);
    expect(projectDir(basename(dir), root)).toBe(join(root, basename(dir)));
    expect(() => projectDir("../x", root)).toThrow(/no project/);
  });

  it("applies patches, updates items and sets values, with lint and duration", () => {
    const r = patchProject(dir, { addElements: [magenta] });
    expect(r.durationMs).toBeGreaterThan(0);
    expect(read().elements.map((e: { id: string }) => e.id)).toContain("m1");
    updateItem(dir, "elements", "m1", { durationMs: 800, props: { fit: "contain" } });
    expect(read().elements.find((e: { id: string }) => e.id === "m1")).toMatchObject({ durationMs: 800, props: { asset: "m", fit: "contain" } });
    setValue(dir, "/name", "renamed");
    expect(read().name).toBe("renamed");
    setValue(dir, "/elements/-", { ...magenta, id: "m2" });
    expect(read().elements.at(-1).id).toBe("m2");
    setValue(dir, `/elements/${read().elements.length - 1}`, undefined);
    expect(read().elements.map((e: { id: string }) => e.id)).not.toContain("m2");
  });

  it("refuses writes that would break the project, and leaves the file as it was", () => {
    const before = readFileSync(join(dir, "project.json"), "utf8");
    expect(() => patchProject(dir, { addElements: [{ ...magenta, durationMs: undefined }] })).toThrow(/durationMs/);
    expect(() => patchProject(dir, { bogus: 1 })).toThrow(/not a valid patch/);
    expect(() => updateItem(dir, "story", "nope", { inMs: 0 })).toThrow(/no clip "nope"/);
    expect(() => updateItem(dir, "elements", "x", { id: "y" })).toThrow(/cannot be changed/);
    expect(() => setValue(dir, "/canvas/fps", "fast")).toThrow(/invalid/);
    expect(() => setValue(dir, "/missing/x", 1)).toThrow(/nothing at/);
    expect(() => patchProject(dir, { addElements: [{ ...magenta, anchor: { word: "s.w99" } }] })).toThrow();
    expect(readFileSync(join(dir, "project.json"), "utf8")).toBe(before);
  });

  it("undoes changes one by one", () => {
    const original = read();
    setValue(dir, "/name", "one");
    setValue(dir, "/name", "two");
    undo(dir);
    expect(read().name).toBe("one");
    undo(dir);
    expect(read()).toEqual(original);
    expect(() => undo(dir)).toThrow(/nothing to undo/);
  });

  it("proposes, decides, and refills a proposal sent back with more", () => {
    const variant = (key: string) => ({ key, label: `v${key}`, patch: { addElements: [{ ...magenta, id: `m${key}` }] } });
    propose(dir, { id: "p2", step: "visuals", reason: "test", variants: [variant("A"), variant("B")] });
    expect(() => propose(dir, { id: "p2", step: "visuals", variants: [variant("A")] })).toThrow(/waiting for a decision/);
    decideProposal(dir, "p2", "more", "bigger");
    propose(dir, { id: "p2", step: "visuals", variants: [variant("C")] });
    const p2 = read().proposals.find((p: { id: string }) => p.id === "p2");
    expect(p2.variants.map((v: { key: string }) => v.key)).toEqual(["C"]);
    expect(p2.history[0].note).toBe("bigger");
    decideProposal(dir, "p2", "C");
    expect(read().elements.map((e: { id: string }) => e.id)).toContain("mC");
    expect(() => decideProposal(dir, "p2", "A")).toThrow(/already decided/);
    expect(() => propose(dir, { id: "p3", step: "visuals", variants: [] })).toThrow(/one to three/);
    expect(() => closeCurrentStep(dir)).toThrow();
  });
});

describe("view", () => {
  it("summarises without the words and lists words with pauses", () => {
    const s = JSON.parse(projectSummary(dir));
    expect(s.transcript.words.s).toMatch(/words/);
    expect(s.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(s.lint)).toBe(true);
    const t = transcriptText(dir, { fromMs: 900, toMs: 1500 });
    expect(t).toContain("s.w1 1.00-1.40 blue");
    expect(t).not.toContain("red");
    expect(() => transcriptText(dir, { asset: "zz" })).toThrow(/no transcript/);
  });
});
