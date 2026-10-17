import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProject, parseStyle, resolve, type Proposal } from "@adam-studio/model";
import { reviewWindow } from "../../src/commands/review";
import { fontFormat } from "../../src/fonts";
import { slideFilterId } from "../../src/lib/subject";
import { missingAnalysis } from "../../src/media";
import { projectInput, styleInput } from "./helpers";

function load(mutate: (input: any) => void = () => {}) {
  const input: any = projectInput();
  mutate(input);
  const p = parseProject(input);
  const s = parseStyle(styleInput);
  if (!p.ok || !s.ok) throw new Error("fixture");
  return { project: p.value, style: s.value };
}

describe("review window", () => {
  it("stays inside the edit when the anchor lies past its end or before its start", () => {
    const { project, style } = load();
    const tl = resolve(project, style);
    const last = tl.durationFrames - 1;
    for (const anchor of [{ atMs: 999999 }, { word: "s.w0", offsetMs: -999999 }]) {
      const w = reviewWindow(project, tl, { id: "p", step: "visuals", anchor, reason: "", variants: [], status: "pending", history: [] } as Proposal);
      for (const [a, b] of w.ranges) expect(a <= b && a >= 0 && b <= last, `${JSON.stringify(anchor)}: ${a}-${b}`).toBe(true);
      expect(w.still).toBeGreaterThanOrEqual(0);
      expect(w.still).toBeLessThanOrEqual(last);
    }
  });
});

describe("cache freshness", () => {
  it("asks for the edit again when the source changed since the analysis", () => {
    const dir = mkdtempSync(join(tmpdir(), "adam fresh-"));
    const source = join(dir, "take.mp4");
    writeFileSync(source, "v1");
    const { project, style } = load((i) => { i.assets = i.assets.map((a: any) => (a.id === "s" ? { ...a, path: source } : a)); });
    const cache = join(dir, "cache", "s");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "edit.mp4"), "x");
    const stamp = (size: number, mtimeMs: number) => writeFileSync(join(cache, "manifest.json"), JSON.stringify({ source: { path: source, size, mtimeMs }, steps: {} }));
    utimesSync(source, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    stamp(2, 1_700_000_000_000);
    const tl = resolve(project, style);
    expect(missingAnalysis(dir, project, tl).filter((m) => m.step === "edit")).toEqual([]);
    writeFileSync(source, "version two");
    expect(missingAnalysis(dir, project, tl).filter((m) => m.step === "edit")).toEqual([{ asset: "s", step: "edit" }]);
  });
});

describe("small renderer fixes", () => {
  it("gives fonts an explicit format, collections included", () => {
    expect(fontFormat("fonts/caption-1234.ttf")).toBe("truetype");
    expect(fontFormat("C:/Windows/Fonts/cambria.ttc")).toBe("collection");
    expect(fontFormat("a.OTF")).toBe("opentype");
    expect(fontFormat("a.woff2")).toBe("woff2");
    expect(fontFormat("no-extension")).toBe("truetype");
  });

  it("makes slide blur filter ids safe for ids with spaces and parentheses", () => {
    expect(slideFilterId("plan (2) final", 12)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(slideFilterId("a b", 1)).not.toBe(slideFilterId("a_b", 1));
  });
});

describe("decide", () => {
  it("refuses a variant whose style change is invalid, and leaves the project as it was", async () => {
    const { decideCommand } = await import("../../src/commands/decide");
    const { readFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "adam decide-"));
    const input: any = projectInput();
    input.proposals = [{ id: "p", step: "cuts", variants: [{ key: "A", label: "too warm", patch: { setStyle: { grade: { warmth: 5 } } } }] }];
    writeFileSync(join(dir, "project.json"), JSON.stringify(input));
    writeFileSync(join(dir, "style.json"), JSON.stringify(styleInput));
    const before = readFileSync(join(dir, "project.json"), "utf8");
    expect(() => decideCommand(dir, "p", "A")).toThrow(/cannot be applied/);
    expect(readFileSync(join(dir, "project.json"), "utf8")).toBe(before);
  });
});
